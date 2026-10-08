import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VISION_AUDIT_ACTIONS, VisionAuditService } from "../audit/vision-audit.service";
import { PROVISION_KEY_HEADER, PROVISION_KEY_PROVIDERS, isProvisionKey, provisionKeyFor } from "./provision-key";
import { WorkerCapacityService } from "./worker-capacity.service";
import { WorkerProvisionController } from "./worker-provision.controller";
import { WorkerProvisionGuard } from "./worker-provision.guard";

const OPERATOR = "an-example-operator-key";
/** `printf 'vision-worker-provision-v1:%s' an-example-operator-key | sha256sum`, computed outside this code. */
const DERIVED = "4ef4561b24fb6bf73e63f8aa3dc88c6dbe2a87ec0a6a10a0293b5ffa21294541";

describe("the provision key", () => {
  it("is the sha256 of a fixed context and the operator key: the answer the deploy and CI compute too", () => {
    expect(provisionKeyFor(OPERATOR)).toBe(DERIVED);
    // The operator key as the server reads it: trimmed.
    expect(provisionKeyFor(`  ${OPERATOR}\n`)).toBe(DERIVED);
  });

  it("is not the operator key, and differs for every operator key", () => {
    expect(provisionKeyFor(OPERATOR)).not.toContain(OPERATOR);
    expect(provisionKeyFor("another-key")).not.toBe(DERIVED);
  });

  it("does not exist when there is no operator key", () => {
    for (const none of [undefined, null, "", "   "]) expect(provisionKeyFor(none)).toBeNull();
  });

  it("is recognised exactly, and nothing else is", () => {
    expect(isProvisionKey(DERIVED, OPERATOR)).toBe(true);
    expect(isProvisionKey(` ${DERIVED} `, OPERATOR)).toBe(true);
    // The operator key itself is not the provision key: it has its own header and its own guard.
    for (const wrong of [OPERATOR, DERIVED.slice(0, -1), `${DERIVED}0`, DERIVED.toUpperCase(), "", undefined, null]) {
      expect(isProvisionKey(wrong, OPERATOR), String(wrong)).toBe(false);
    }
    // With no operator key configured, nothing is the provision key: not even the hash of an empty one.
    expect(isProvisionKey(provisionKeyFor("x"), undefined)).toBe(false);
    expect(isProvisionKey("", "")).toBe(false);
  });

  it("is derived the same way where the deploy writes the worker's environment, and in CI", () => {
    const root = join(__dirname, "../../../../..");
    const template = readFileSync(join(root, "infra/ansible/roles/deploy/templates/staging.env.j2"), "utf8");
    expect(template).toContain("VISION_PROVISION_KEY={{ ('vision-worker-provision-v1:' ~ (app_creds.ADMIN_API_KEY | trim)) | hash('sha256') }}");
    const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain(`printf 'vision-worker-provision-v1:%s' "$ADMIN_API_KEY" | sha256sum | cut -d' ' -f1`);
  });

  it("is what the worker's container is given, and the operator key is not", () => {
    const compose = readFileSync(join(__dirname, "../../../../../infra/docker-compose.staging.yml"), "utf8");
    const worker = compose.slice(compose.indexOf("\n  worker:"));
    expect(worker).toContain("VISION_PROVISION_KEY: ${VISION_PROVISION_KEY:?");
    // The whole point: the container that decodes outside footage does not hold every permission.
    expect(worker).not.toContain("ADMIN_API_KEY");
    expect(worker).not.toContain("VISION_PROVISION_API_KEY");
  });
});

describe("the door to provisioning", () => {
  const admin = { canActivate: vi.fn() };
  const permissions = { canActivate: vi.fn() };
  const guard = new WorkerProvisionGuard(admin as never, permissions as never);
  const context = (headers: Record<string, unknown>) => {
    const req = { headers } as Record<string, unknown>;
    return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as never };
  };
  const before = process.env.ADMIN_API_KEY;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = OPERATOR;
    admin.canActivate.mockResolvedValue(true);
    permissions.canActivate.mockReturnValue(true);
  });
  afterEach(() => {
    process.env.ADMIN_API_KEY = before;
  });

  it("opens to the provision key, without asking the admin guards anything", async () => {
    const { req, ctx } = context({ [PROVISION_KEY_HEADER]: DERIVED });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.provisionKey).toBe(true);
    expect(admin.canActivate).not.toHaveBeenCalled();
  });

  it("refuses a wrong key there, and does not fall through to the admin check", async () => {
    for (const wrong of ["nope", OPERATOR, "", ["a", "b"]]) {
      // Even with an admin key beside it: a request that presents the header is judged on it.
      const { req, ctx } = context({ [PROVISION_KEY_HEADER]: wrong, "x-admin-api-key": OPERATOR });
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 401, response: { error: "ProvisionKeyInvalid", remediation: expect.any(String) } });
      expect(req.provisionKey).toBeUndefined();
    }
    expect(admin.canActivate).not.toHaveBeenCalled();
  });

  it("refuses every key when the server has no operator key", async () => {
    delete process.env.ADMIN_API_KEY;
    const { ctx } = context({ [PROVISION_KEY_HEADER]: DERIVED });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 401 });
  });

  it("sends a request without the header through the admin guards, both of them", async () => {
    const { req, ctx } = context({ "x-admin-api-key": OPERATOR });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(admin.canActivate).toHaveBeenCalledTimes(1);
    expect(permissions.canActivate).toHaveBeenCalledTimes(1);
    expect(req.provisionKey).toBeUndefined();

    permissions.canActivate.mockReturnValueOnce(false);
    await expect(guard.canActivate(context({}).ctx)).resolves.toBe(false);
    admin.canActivate.mockResolvedValueOnce(false);
    await expect(guard.canActivate(context({}).ctx)).resolves.toBe(false);
  });
});

describe("what the provision key may do past the door", () => {
  const prisma = { visionWorker: { update: vi.fn(), findUnique: vi.fn() } };
  const tokens = { mintBootstrap: vi.fn(), retire: vi.fn() };
  const launch = vi.fn();
  const terminate = vi.fn();
  const compute = { get: vi.fn(() => ({ capabilities: () => ({ resourceClasses: ["cpu_small", "gpu_24gb"] }), launch, terminate })) };
  const config = { compute: { defaultProvider: "runpod", workerImage: "img:1", hostedWorkerCallbackUrl: "https://api.example.test/api/v1/vision/worker" as string | null }, jobs: { defaultBudgetSeconds: 600, defaultBudgetUsdCents: 100 } };
  const audit = { record: vi.fn() };
  const capacity = new WorkerCapacityService(prisma as never, tokens as never, compute as never, audit as never);
  const controller = new WorkerProvisionController(prisma as never, tokens as never, compute as never, config as never, audit as never, capacity);
  const withKey = { headers: {}, provisionKey: true };
  const asAdmin = { headers: {}, adminAuth: { method: "jwt", userId: "u-1", roleSlug: "vision_admin", roleName: null, permissions: [] } };

  beforeEach(() => {
    vi.clearAllMocks();
    tokens.mintBootstrap.mockResolvedValue({ workerId: "w-1", bootstrapToken: "boot", expiresAt: new Date("2026-10-05T00:00:00Z") });
    launch.mockResolvedValue({ providerRef: "ref-1" });
    prisma.visionWorker.update.mockResolvedValue({});
  });

  it("provisions the box's own worker", async () => {
    const out = await controller.provisionWorker({ resourceClass: "cpu_small", providerId: "local" } as never, withKey as never);
    expect(out).toMatchObject({ workerId: "w-1", providerId: "local", bootstrapToken: "boot", requestedBy: "provision_key" });
    expect(tokens.mintBootstrap).toHaveBeenCalledWith({ providerId: "local", resourceClass: "cpu_small", image: "img:1" });
    // On the audit trail as what it was: the provision key, not a person and not the operator key.
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      { action: "worker.provisioned", targetKind: "vision_worker", targetId: "w-1", data: { providerId: "local", providerRef: "ref-1", resourceClass: "cpu_small", image: "img:1", bootstrapExpiresAt: "2026-10-05T00:00:00.000Z" } },
      { method: "provision_key" }
    );
    // The token is shown to the caller once and written nowhere, the audit row included.
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('"boot"');
  });

  it("cannot start a hosted worker, named or by default: nothing is minted and nothing launched", async () => {
    expect(PROVISION_KEY_PROVIDERS).toEqual(["local"]);
    // Named.
    await expect(controller.provisionWorker({ resourceClass: "gpu_24gb", providerId: "runpod" } as never, withKey as never)).rejects.toMatchObject({ status: 403, response: { error: "ProvisionKeyScope" } });
    // Left out, on a server whose default provider is a hosted one.
    await expect(controller.provisionWorker({ resourceClass: "cpu_small" } as never, withKey as never)).rejects.toMatchObject({ status: 403, response: { error: "ProvisionKeyScope" } });
    expect(tokens.mintBootstrap).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    // Nothing happened, so nothing is recorded as having happened.
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("leaves an admin free to provision any provider", async () => {
    const out = await controller.provisionWorker({ resourceClass: "gpu_24gb", providerId: "runpod" } as never, asAdmin as never);
    expect(out).toMatchObject({ providerId: "runpod", requestedBy: "u-1" });
    expect(launch).toHaveBeenCalledTimes(1);
    // A pod on the provider's network is told the public URL, not the box's relative path.
    expect(launch.mock.calls[0][0].env.VISION_WORKER_CALLBACK_URL).toBe("https://api.example.test/api/v1/vision/worker");
    // The admin is the actor, whole: the audit service reads the id, email and method from it.
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "worker.provisioned", targetId: "w-1" }), asAdmin.adminAuth);
  });

  it("refuses a hosted launch with no reachable callback before minting or buying anything", async () => {
    config.compute.hostedWorkerCallbackUrl = null;
    try {
      await expect(controller.provisionWorker({ resourceClass: "gpu_24gb", providerId: "runpod" } as never, asAdmin as never)).rejects.toMatchObject({ status: 409, response: { error: "WorkerCallbackUrlMissing" } });
      expect(tokens.mintBootstrap).not.toHaveBeenCalled(); expect(launch).not.toHaveBeenCalled(); expect(audit.record).not.toHaveBeenCalled();
      // The box's worker and the mock provider still get the relative path: their host is the operator's to name.
      for (const providerId of ["local", "mock"]) {
        await controller.provisionWorker({ resourceClass: "cpu_small", providerId } as never, asAdmin as never);
        expect(launch.mock.calls.at(-1)![0].env.VISION_WORKER_CALLBACK_URL).toBe("/api/v1/vision/worker");
      }
    } finally { config.compute.hostedWorkerCallbackUrl = "https://api.example.test/api/v1/vision/worker"; }
  });

  it("records nothing for a worker that was never started", async () => {
    // A class the provider does not offer: refused before a token is minted.
    await expect(controller.provisionWorker({ resourceClass: "gpu_48gb", providerId: "runpod" } as never, asAdmin as never)).rejects.toMatchObject({ status: 404 });
    // A launch that fails: no worker runs, and the row does not claim one does.
    launch.mockRejectedValueOnce(new Error("the provider is down"));
    await expect(controller.provisionWorker({ resourceClass: "gpu_24gb", providerId: "runpod" } as never, asAdmin as never)).rejects.toThrow("the provider is down");
    expect(audit.record).not.toHaveBeenCalled();
    // The row minted for it does not keep a live bootstrap token for a pod that does not exist.
    expect(tokens.retire).toHaveBeenCalledWith("w-1");
    // A retire that fails too still reports the launch failure, not its own.
    launch.mockRejectedValueOnce(new Error("the provider is down"));
    tokens.retire.mockRejectedValueOnce(new Error("db blip"));
    await expect(controller.provisionWorker({ resourceClass: "gpu_24gb", providerId: "runpod" } as never, asAdmin as never)).rejects.toThrow("the provider is down");
  });

  it("retires the box's own worker, and not a hosted one", async () => {
    prisma.visionWorker.findUnique.mockResolvedValue({ id: "w-1", providerId: "local", providerRef: "ref-1", resourceClass: "cpu_small", retiredAt: null });
    await expect(controller.retireWorker("w-1", withKey as never)).resolves.toEqual({ ok: true, terminated: false });
    expect(terminate).not.toHaveBeenCalled();
    expect(tokens.retire).toHaveBeenCalledWith("w-1");
    expect(audit.record).toHaveBeenCalledWith(
      { action: "worker.retired", targetKind: "vision_worker", targetId: "w-1", data: { providerId: "local", resourceClass: "cpu_small", alreadyRetired: false, reason: "operator", terminated: false } },
      { method: "provision_key" }
    );

    tokens.retire.mockClear();
    audit.record.mockClear();
    prisma.visionWorker.findUnique.mockResolvedValue({ id: "w-2", providerId: "runpod", providerRef: "pod-9", resourceClass: "gpu_24gb", retiredAt: new Date("2026-10-04T00:00:00Z") });
    await expect(controller.retireWorker("w-2", withKey as never)).rejects.toMatchObject({ status: 403, response: { error: "ProvisionKeyScope" } });
    expect(tokens.retire).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    // An admin may. Retiring a retired worker rotates its token again, and the row says it was a repeat.
    // Its pod is terminated too, even on a repeat: a retired worker's pod may still be running.
    expect(terminate).not.toHaveBeenCalled();
    await expect(controller.retireWorker("w-2", asAdmin as never)).resolves.toEqual({ ok: true, terminated: true });
    expect(terminate).toHaveBeenCalledWith("pod-9");
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "worker.retired", targetId: "w-2", data: expect.objectContaining({ alreadyRetired: true }) }), asAdmin.adminAuth);
  });

  it("answers 404 for a worker that does not exist, whoever asks", async () => {
    prisma.visionWorker.findUnique.mockResolvedValue(null);
    for (const who of [withKey, asAdmin]) {
      await expect(controller.retireWorker("gone", who as never)).rejects.toMatchObject({ status: 404, response: { error: "NotFound" } });
    }
    expect(tokens.retire).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("writes the row with the provision key as the method and nobody as the person", async () => {
    const create = vi.fn();
    const real = new VisionAuditService({ visionAuditLog: { create } } as never);
    await real.record({ action: "worker.provisioned", targetKind: "vision_worker", targetId: "w-1" }, { method: "provision_key" });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "worker.provisioned", targetKind: "vision_worker", targetId: "w-1", actorId: null, actorEmail: null, actorMethod: "provision_key" }) });
    expect(VISION_AUDIT_ACTIONS).toEqual(expect.arrayContaining(["worker.provisioned", "worker.retired"]));
  });
});

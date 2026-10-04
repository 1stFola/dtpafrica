import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVISION_KEY_HEADER, PROVISION_KEY_PROVIDERS, isProvisionKey, provisionKeyFor } from "./provision-key";
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
  const compute = { get: vi.fn(() => ({ capabilities: () => ({ resourceClasses: ["cpu_small", "gpu_24gb"] }), launch })) };
  const config = { compute: { defaultProvider: "runpod", workerImage: "img:1" }, jobs: { defaultBudgetSeconds: 600, defaultBudgetUsdCents: 100 } };
  const controller = new WorkerProvisionController(prisma as never, tokens as never, compute as never, config as never);
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
  });

  it("cannot start a hosted worker, named or by default: nothing is minted and nothing launched", async () => {
    expect(PROVISION_KEY_PROVIDERS).toEqual(["local"]);
    // Named.
    await expect(controller.provisionWorker({ resourceClass: "gpu_24gb", providerId: "runpod" } as never, withKey as never)).rejects.toMatchObject({ status: 403, response: { error: "ProvisionKeyScope" } });
    // Left out, on a server whose default provider is a hosted one.
    await expect(controller.provisionWorker({ resourceClass: "cpu_small" } as never, withKey as never)).rejects.toMatchObject({ status: 403, response: { error: "ProvisionKeyScope" } });
    expect(tokens.mintBootstrap).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it("leaves an admin free to provision any provider", async () => {
    const out = await controller.provisionWorker({ resourceClass: "gpu_24gb", providerId: "runpod" } as never, asAdmin as never);
    expect(out).toMatchObject({ providerId: "runpod", requestedBy: "u-1" });
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("retires the box's own worker, and not a hosted one", async () => {
    prisma.visionWorker.findUnique.mockResolvedValue({ id: "w-1", providerId: "local" });
    await expect(controller.retireWorker("w-1", withKey as never)).resolves.toEqual({ ok: true });
    expect(tokens.retire).toHaveBeenCalledWith("w-1");

    tokens.retire.mockClear();
    prisma.visionWorker.findUnique.mockResolvedValue({ id: "w-2", providerId: "runpod" });
    await expect(controller.retireWorker("w-2", withKey as never)).rejects.toMatchObject({ status: 403, response: { error: "ProvisionKeyScope" } });
    expect(tokens.retire).not.toHaveBeenCalled();
    // An admin may.
    await expect(controller.retireWorker("w-2", asAdmin as never)).resolves.toEqual({ ok: true });
  });

  it("answers 404 for a worker that does not exist, whoever asks", async () => {
    prisma.visionWorker.findUnique.mockResolvedValue(null);
    for (const who of [withKey, asAdmin]) {
      await expect(controller.retireWorker("gone", who as never)).rejects.toMatchObject({ status: 404, response: { error: "NotFound" } });
    }
    expect(tokens.retire).not.toHaveBeenCalled();
  });
});

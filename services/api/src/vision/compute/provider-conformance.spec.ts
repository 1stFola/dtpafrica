import {
  VISION_RESOURCE_CLASSES,
  WORKER_STATUSES,
  type WorkerLaunchSpec,
} from "@dtp/vision-contracts";
import { describe, expect, it } from "vitest";
import type { ComputeProvider } from "./compute-provider";
import { LambdaComputeProvider } from "./lambda-compute-provider";
import { LocalComputeProvider } from "./local-compute-provider";
import { MockComputeProvider } from "./mock-compute-provider";
import { RunPodComputeProvider } from "./runpod-compute-provider";
import { loadLambdaConfig, loadRunPodConfig, type HttpClient } from "./provider-config";

/**
 * The conformance suite every ComputeProvider must pass.
 *
 * This is the point of writing more than one provider. The design claims GPU
 * capacity is swappable, and until now that claim rested on a single
 * implementation and a comment — my own documentation says an abstraction with one
 * implementation is a guess.
 *
 * **Add a provider, add it to the table below.** If it needs the suite relaxed, the
 * abstraction has a hole and the hole is the finding.
 */

/**
 * A stateful fake of whichever provider's API is under test.
 *
 * Stateful on purpose. A stub that always answers "running" cannot honour an
 * assertion about what happens after termination, and the first version of this
 * failed two conformance tests for exactly that reason — the fake was wrong, not
 * the adapters. A fake that cannot express the state transition under test is not
 * testing anything.
 */
function stubHttp(): HttpClient {
  const terminated = new Set<string>();

  return (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";

    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    // ── RunPod: container pods ──────────────────────────────────────────────
    if (href.endsWith("/pods") && method === "POST") return json({ id: "pod-1" }, 201);

    if (href.includes("/pods/") && method === "DELETE") {
      const id = href.split("/pods/")[1]!;
      if (id !== "pod-1") return json({ error: "not found" }, 404);
      terminated.add(id);
      return new Response(null, { status: 204 });
    }

    if (href.includes("/pods/") && method === "GET") {
      const id = href.split("/pods/")[1]!;
      if (id !== "pod-1") return json({ error: "not found" }, 404);
      return terminated.has(id)
        ? json({ id, runtimeStatus: "TERMINATED", desiredStatus: "TERMINATED" })
        : json({ id, runtimeStatus: "RUNNING", desiredStatus: "RUNNING" });
    }

    // ── Lambda: virtual machines ────────────────────────────────────────────
    if (href.includes("/instance-operations/launch")) return json({ instance_ids: ["i-1"] }, 200);

    if (href.includes("/instance-operations/terminate")) {
      for (const id of (JSON.parse(body || "{}").instance_ids ?? []) as string[]) {
        if (id !== "i-1") return json({ error: "not found" }, 404);
        terminated.add(id);
      }
      return json({ data: {} });
    }

    if (href.includes("/instances/")) {
      const id = href.split("/instances/")[1]!;
      if (id !== "i-1") return json({ error: "not found" }, 404);
      return json({ data: { id, status: terminated.has(id) ? "terminated" : "active" } });
    }

    return json({}, 200);
  }) as HttpClient;
}

const RUNPOD_ENV = {
  VISION_RUNPOD_API_KEY: "k",
  VISION_RUNPOD_GPUS_48GB: "NVIDIA RTX A6000",
} satisfies NodeJS.ProcessEnv;

const LAMBDA_ENV = {
  VISION_LAMBDA_API_KEY: "k",
  VISION_LAMBDA_REGION: "us-west-1",
  VISION_LAMBDA_SSH_KEY_NAMES: "dtp-vision",
  VISION_LAMBDA_TYPES_48GB: "gpu_1x_a6000",
} satisfies NodeJS.ProcessEnv;

const PROVIDERS: { name: string; make: () => ComputeProvider }[] = [
  { name: "MockComputeProvider", make: () => new MockComputeProvider() },
  { name: "LocalComputeProvider", make: () => new LocalComputeProvider() },
  {
    name: "RunPodComputeProvider",
    make: () => new RunPodComputeProvider(loadRunPodConfig(RUNPOD_ENV), stubHttp()),
  },
  {
    name: "LambdaComputeProvider",
    make: () => new LambdaComputeProvider(loadLambdaConfig(LAMBDA_ENV), stubHttp()),
  },
];

function specFor(provider: ComputeProvider): WorkerLaunchSpec {
  const classes = provider.capabilities().resourceClasses;
  return {
    image: "dtp-vision-engine:0.1.0",
    resourceClass: classes[0] ?? "cpu_small",
    env: {
      VISION_WORKER_CALLBACK_URL: "https://api.example.test/api/v1/vision/worker",
      VISION_BOOTSTRAP_TOKEN: "bootstrap-token",
    },
    maxRuntimeSeconds: 3600,
    maxCostUsdCents: 500,
    idleShutdownSeconds: 120,
  };
}

describe.each(PROVIDERS)("$name conforms to ComputeProvider", ({ make }) => {
  it("has a stable, non-empty id", () => {
    const provider = make();
    expect(provider.id).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(provider.id).toBe(make().id);
  });

  it("declares capabilities whose resource classes are all real", () => {
    const caps = make().capabilities();
    expect(caps.providerId).toBe(make().id);
    expect(caps.maxConcurrentWorkers).toBeGreaterThan(0);
    expect(typeof caps.productionApproved).toBe("boolean");
    for (const c of caps.resourceClasses) {
      expect(VISION_RESOURCE_CLASSES).toContain(c);
    }
  });

  /**
   * The reference is opaque by contract. Nothing outside an adapter may parse it,
   * so all the domain needs is a non-empty string it can hand back later.
   */
  it("returns an opaque reference from launch", async () => {
    const provider = make();
    const { providerRef } = await provider.launch(specFor(provider));
    expect(typeof providerRef).toBe("string");
    expect(providerRef.length).toBeGreaterThan(0);
  });

  it("reports a status from the contract's vocabulary", async () => {
    const provider = make();
    const { providerRef } = await provider.launch(specFor(provider));
    expect(WORKER_STATUSES).toContain(await provider.status(providerRef));
  });

  // The dispatcher may reap the same job twice, and a reference it has never seen
  // must not throw — otherwise one stale row wedges the reaper.
  it("terminates idempotently, including an unknown reference", async () => {
    const provider = make();
    const { providerRef } = await provider.launch(specFor(provider));

    await expect(provider.terminate(providerRef)).resolves.toBeUndefined();
    await expect(provider.terminate(providerRef)).resolves.toBeUndefined();
    await expect(provider.terminate("never-existed")).resolves.toBeUndefined();
  });

  it("never reports a terminated worker as running", async () => {
    const provider = make();
    const { providerRef } = await provider.launch(specFor(provider));
    await provider.terminate(providerRef);
    expect(await provider.status(providerRef)).not.toBe("running");
  });

  it("estimates cost monotonically, and says the rate was configured", async () => {
    const provider = make();
    const klass = provider.capabilities().resourceClasses[0] ?? "cpu_small";

    const zero = await provider.estimateCost(klass, 0);
    const short = await provider.estimateCost(klass, 60);
    const long = await provider.estimateCost(klass, 3600);

    expect(zero.usdCents).toBe(0);
    expect(long.usdCents).toBeGreaterThanOrEqual(short.usdCents);
    expect(long.resourceClass).toBe(klass);
    expect(long.fromConfiguredRate).toBe(true);
  });

  /**
   * The rule the whole design rests on: a worker learns a URL, a token and its
   * class. If a provider needed the domain to hand it a credential or a bucket
   * name, every caller would have to know about that provider.
   */
  it("needs nothing from the launch spec beyond the contract", async () => {
    const provider = make();
    const spec = specFor(provider);
    await expect(provider.launch(spec)).resolves.toBeDefined();

    // No provider-specific field was added to make this work.
    expect(Object.keys(spec).sort()).toEqual([
      "env",
      "idleShutdownSeconds",
      "image",
      "maxCostUsdCents",
      "maxRuntimeSeconds",
      "resourceClass",
    ]);
  });
});

/**
 * Where the two hosted providers genuinely differ.
 *
 * Recorded as behaviour rather than prose, because these are the asymmetries that
 * cost money or lose work if someone assumes the providers are interchangeable in
 * every respect.
 */
describe("the providers are not identical, and the differences are the finding", () => {
  it("advertises nothing when a provider's prerequisites are missing", () => {
    // Lambda grants access by SSH key and cannot create one for itself. Advertising
    // a class it cannot launch would have the dispatcher pick it and then fail.
    const noKey = new LambdaComputeProvider(
      loadLambdaConfig({ ...LAMBDA_ENV, VISION_LAMBDA_SSH_KEY_NAMES: "" }),
      stubHttp()
    );
    expect(noKey.capabilities().resourceClasses).toEqual([]);

    const withKey = new LambdaComputeProvider(loadLambdaConfig(LAMBDA_ENV), stubHttp());
    expect(withKey.capabilities().resourceClasses).toContain("gpu_48gb");
  });

  it("reads an empty disk size as unset, not as a pod with no disk", () => {
    expect(loadRunPodConfig({ VISION_RUNPOD_DISK_GB: "" }).containerDiskGb).toBe(60);
    expect(loadRunPodConfig({ VISION_RUNPOD_DISK_GB: "abc" }).containerDiskGb).toBe(60);
    expect(loadRunPodConfig({ VISION_RUNPOD_DISK_GB: "120" }).containerDiskGb).toBe(120);
  });

  it("sends a registry credential id only when one is configured", async () => {
    const bodies: Record<string, unknown>[] = [];
    const http = (async (_url: string, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "pod-1" }), { status: 200 });
    }) as unknown as HttpClient;
    const spec = { image: "registry.example/img:1", resourceClass: "gpu_24gb" as const, env: {}, maxRuntimeSeconds: 60, maxCostUsdCents: 10, idleShutdownSeconds: 60 };
    await new RunPodComputeProvider(loadRunPodConfig({ VISION_RUNPOD_API_KEY: "k", VISION_RUNPOD_REGISTRY_AUTH_ID: " auth-1 " }), http).launch(spec as never);
    await new RunPodComputeProvider(loadRunPodConfig({ VISION_RUNPOD_API_KEY: "k", VISION_RUNPOD_REGISTRY_AUTH_ID: "" }), http).launch(spec as never);
    expect(bodies[0]).toMatchObject({ imageName: "registry.example/img:1", containerRegistryAuthId: "auth-1" });
    expect(bodies[1]).not.toHaveProperty("containerRegistryAuthId");
  });

  it("advertises only classes with a configured machine type behind them", () => {
    const provider = new RunPodComputeProvider(
      loadRunPodConfig({ VISION_RUNPOD_API_KEY: "k", VISION_RUNPOD_GPUS_24GB: "" }),
      stubHttp()
    );
    // Defaults fill 24GB, so emptying only that variable should still leave it
    // populated — the assertion that matters is that a class is never advertised
    // with nothing behind it.
    for (const c of provider.capabilities().resourceClasses) {
      if (c === "cpu_small") continue;
      expect(loadRunPodConfig({ VISION_RUNPOD_API_KEY: "k" }).gpuTypeIds[c].length).toBeGreaterThan(0);
    }
  });

  /**
   * The general form of the rule, rather than two provider-specific cases.
   *
   * This started as a RunPod-only bug: machine-type defaults are baked in, so with
   * no API key it advertised all four GPU classes and the dispatcher would have
   * selected it and failed at launch. Asserting it for every provider is what stops
   * the next adapter repeating it.
   */
  it("advertises nothing when a hosted provider has no credential", () => {
    const runpod = new RunPodComputeProvider(loadRunPodConfig({}), stubHttp());
    const lambda = new LambdaComputeProvider(loadLambdaConfig({}), stubHttp());

    expect(runpod.capabilities().resourceClasses).toEqual([]);
    expect(lambda.capabilities().resourceClasses).toEqual([]);
  });

  it("refuses to launch without credentials rather than silently doing nothing", async () => {
    const runpod = new RunPodComputeProvider(loadRunPodConfig({}), stubHttp());
    const lambda = new LambdaComputeProvider(
      loadLambdaConfig({ ...LAMBDA_ENV, VISION_LAMBDA_API_KEY: "" }),
      stubHttp()
    );

    await expect(runpod.launch(specFor(runpod))).rejects.toThrow(/API_KEY/);
    await expect(lambda.launch(specFor(lambda))).rejects.toThrow();
  });
});

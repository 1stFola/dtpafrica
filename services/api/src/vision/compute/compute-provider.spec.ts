import {
  DEFAULT_RESOURCE_CLASS,
  JOB_TYPE_PREREQUISITES,
  VISION_CONTRACT_VERSION,
  VISION_JOB_TYPES,
  type VisionJobSpec,
  type WorkerLaunchSpec,
} from "@dtp/vision-contracts";
import { describe, expect, it } from "vitest";
import {
  ComputeProviderRegistry,
  ProviderNotProductionApprovedError,
} from "./compute-provider";
import { LocalComputeProvider } from "./local-compute-provider";
import { MockComputeProvider } from "./mock-compute-provider";
import { estimateUsdCents, parseRateOverrides } from "./resource-rates";

function registry() {
  return new ComputeProviderRegistry([new MockComputeProvider(), new LocalComputeProvider()]);
}

describe("ComputeProviderRegistry", () => {
  it("resolves a registered provider", () => {
    expect(registry().get("mock").id).toBe("mock");
  });

  it("names what is registered when asked for something unknown", () => {
    expect(() => registry().get("runpod")).toThrow(/Registered: mock, local/);
  });

  it("filters by resource class", () => {
    // The local provider declares CPU-only by default, so it must not be
    // offered for GPU work.
    const gpuCapable = registry().supporting("gpu_48gb");
    expect(gpuCapable.map((p) => p.id)).toEqual(["mock"]);
  });

  // Experiment-only capacity must never produce a dataset member or a published
  // fact. Phase 0 has no production-approved provider at all, which is correct:
  // RunPod and Lambda arrive in Phase 1.
  it("refuses experiment-only capacity for durable work", () => {
    expect(() => registry().getForProductionWork("mock")).toThrow(
      ProviderNotProductionApprovedError
    );
  });
});

describe("the job spec is provider-neutral", () => {
  // The Phase 0 gate: a job spec targets a mock provider with no
  // provider-specific field anywhere in it.
  const spec: VisionJobSpec = {
    contractVersion: VISION_CONTRACT_VERSION,
    jobId: "job-1",
    type: "transcode",
    resourceClass: DEFAULT_RESOURCE_CLASS.transcode,
    attemptNumber: 1,
    inputs: { videoAssetId: "asset-1" },
    outputPrefix: "proxies/asset-1/",
    budget: { maxRuntimeSeconds: 3600, maxCostUsdCents: 200 },
    callbackBaseUrl: "https://api.example.test/api/v1/vision/worker",
    heartbeatIntervalSeconds: 30,
  };

  it("carries no provider name in any key or value", () => {
    const serialised = JSON.stringify(spec).toLowerCase();
    for (const forbidden of ["runpod", "lambda", "vast", "cloudflare", "r2.", "aws", "s3"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("launches on the mock provider unchanged", async () => {
    const provider = new MockComputeProvider();
    const launch: WorkerLaunchSpec = {
      image: "dtp-vision-engine:0.1.0",
      resourceClass: spec.resourceClass,
      env: { VISION_JOB_CALLBACK: spec.callbackBaseUrl, VISION_BOOTSTRAP_TOKEN: "t" },
      maxRuntimeSeconds: spec.budget.maxRuntimeSeconds,
      maxCostUsdCents: spec.budget.maxCostUsdCents,
      idleShutdownSeconds: 120,
    };

    const { providerRef } = await provider.launch(launch);
    expect(await provider.status(providerRef)).toBe("running");

    await provider.terminate(providerRef);
    expect(await provider.status(providerRef)).toBe("stopped");
  });

  it("tells the worker only a URL, a token and its resource class", async () => {
    const provider = new MockComputeProvider();
    await provider.launch({
      image: "dtp-vision-engine:0.1.0",
      resourceClass: "cpu_small",
      env: { VISION_JOB_CALLBACK: "https://x/api/v1/vision/worker", VISION_BOOTSTRAP_TOKEN: "t" },
      maxRuntimeSeconds: 60,
      maxCostUsdCents: 10,
      idleShutdownSeconds: 30,
    });

    // No provider SDK config, no storage credentials.
    const env = provider.launches[0].env;
    expect(Object.keys(env).sort()).toEqual(["VISION_BOOTSTRAP_TOKEN", "VISION_JOB_CALLBACK"]);
  });

  it("surfaces a capacity failure rather than silently succeeding", async () => {
    const provider = new MockComputeProvider({ capacityAvailable: false });
    await expect(
      provider.launch({
        image: "i",
        resourceClass: "gpu_48gb",
        env: {},
        maxRuntimeSeconds: 60,
        maxCostUsdCents: 10,
        idleShutdownSeconds: 30,
      })
    ).rejects.toThrow(/no capacity/);
  });
});

describe("job routing", () => {
  // Routing FFmpeg to a GPU pod means paying GPU rates for work that does not
  // touch the GPU. Neither source document specified this.
  it("keeps transcode, clip and fingerprint work on CPU", () => {
    expect(DEFAULT_RESOURCE_CLASS.transcode).toBe("cpu_small");
    expect(DEFAULT_RESOURCE_CLASS.clip).toBe("cpu_small");
    expect(DEFAULT_RESOURCE_CLASS.fingerprint).toBe("cpu_small");
    expect(DEFAULT_RESOURCE_CLASS.probe).toBe("cpu_small");
  });

  it("assigns every job type a resource class and a prerequisite list", () => {
    for (const type of VISION_JOB_TYPES) {
      expect(DEFAULT_RESOURCE_CLASS[type]).toBeDefined();
      expect(JOB_TYPE_PREREQUISITES[type]).toBeDefined();
    }
  });

  it("declares the stage order the dispatcher enforces", () => {
    expect(JOB_TYPE_PREREQUISITES.detect).toContain("transcode");
    expect(JOB_TYPE_PREREQUISITES.track).toContain("detect");
    // Calibration is a person's row per camera segment, not a stage: gamestate
    // follows track, and the control plane refuses NoCalibration at enqueue.
    expect(JOB_TYPE_PREREQUISITES.gamestate).toEqual(["track"]);
    expect(JOB_TYPE_PREREQUISITES.probe).toEqual([]);
  });
});

describe("cost estimation", () => {
  it("rounds up, so a budget check cannot let a job slip past its cap", () => {
    // 1 second of CPU is a fraction of a cent; rounding down would report zero.
    expect(estimateUsdCents("cpu_small", 1)).toBe(1);
  });

  it("returns zero for no work", () => {
    expect(estimateUsdCents("gpu_48gb", 0)).toBe(0);
  });

  it("scales with time and hardware", () => {
    const cpu = estimateUsdCents("cpu_small", 3600);
    const gpu80 = estimateUsdCents("gpu_80gb", 3600);
    expect(gpu80).toBeGreaterThan(cpu);
  });

  it("marks an estimate as coming from a configured rate, not a live quote", async () => {
    const estimate = await new MockComputeProvider().estimateCost("gpu_24gb", 600);
    expect(estimate.fromConfiguredRate).toBe(true);
  });

  it("accepts a configured hourly override", () => {
    const overrides = parseRateOverrides({ VISION_RATE_GPU_48GB_USD_PER_HOUR: "0.72" });
    expect(overrides.gpu_48gb?.usdCentsPerSecond).toBeCloseTo(0.02, 4);
    expect(overrides.gpu_48gb?.basis).toContain("0.72");
  });

  it("ignores a nonsense override rather than producing a negative cost", () => {
    expect(parseRateOverrides({ VISION_RATE_CPU_SMALL_USD_PER_HOUR: "-5" }).cpu_small).toBeUndefined();
    expect(parseRateOverrides({ VISION_RATE_CPU_SMALL_USD_PER_HOUR: "abc" }).cpu_small).toBeUndefined();
  });
});

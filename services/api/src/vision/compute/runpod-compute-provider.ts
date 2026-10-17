import {
  VISION_RESOURCE_CLASSES,
  type CostEstimate,
  type ProviderCapabilities,
  type VisionResourceClass,
  type WorkerLaunchSpec,
  type WorkerStatus,
} from "@dtp/vision-contracts";
import type { ComputeProvider } from "./compute-provider";
import { ProviderCapacityUnavailableError } from "./compute-provider";
import { isTimeout, ProviderTimeoutError, requestWithTimeout, type HttpClient, type RunPodConfig } from "./provider-config";
import { estimateUsdCents, parseRateOverrides } from "./resource-rates";

/**
 * RunPod, via its control REST API.
 *
 * Container-native: the API takes an image name and an environment, which maps
 * onto `WorkerLaunchSpec` almost exactly. That is why it was the easy one to write
 * first, and why it told us nothing about whether the abstraction holds.
 *
 * Vendor names are permitted in this file and in configuration, nowhere else.
 */

type RunPodPod = {
  id: string;
  desiredStatus?: string;
  /** What the pod is actually doing, as opposed to what was asked for. */
  runtimeStatus?: string;
  costPerHr?: number;
};

export class RunPodComputeProvider implements ComputeProvider {
  readonly id = "runpod";

  private readonly rateOverrides = parseRateOverrides(process.env);

  constructor(
    private readonly config: RunPodConfig,
    private readonly http: HttpClient = fetch
  ) {}

  capabilities(): ProviderCapabilities {
    // No credential, nothing on offer. Machine-type defaults are baked in, so
    // without this the provider advertised every class and the dispatcher would
    // select it and fail at launch — exactly the failure the filter below exists
    // to prevent. Found by reading what the running API actually reported.
    const usable = this.config.apiKey
      ? VISION_RESOURCE_CLASSES.filter(
          (c) => c === "cpu_small" || this.config.gpuTypeIds[c].length > 0
        )
      : [];

    return {
      providerId: this.id,
      resourceClasses: usable,
      maxConcurrentWorkers: 8,
      productionApproved: true,
    };
  }

  async launch(spec: WorkerLaunchSpec): Promise<{ providerRef: string }> {
    const gpuTypeIds = this.config.gpuTypeIds[spec.resourceClass];
    const isCpu = spec.resourceClass === "cpu_small";

    if (!isCpu && gpuTypeIds.length === 0) {
      throw new ProviderCapacityUnavailableError(this.id, spec.resourceClass);
    }

    const body: Record<string, unknown> = {
      name: `dtp-vision-${spec.resourceClass}-${Date.now()}`,
      imageName: spec.image,
      env: spec.env,
      containerDiskInGb: this.config.containerDiskGb,
      computeType: isCpu ? "CPU" : "GPU",
      cloudType: this.config.cloudType,
      ...(this.config.registryAuthId ? { containerRegistryAuthId: this.config.registryAuthId } : {}),
      // Several ids so the scheduler can fall back when one is out of stock.
      ...(isCpu ? {} : { gpuTypeIds, gpuCount: 1 }),
    };

    const pod = await this.request<RunPodPod>("POST", "/pods", body);
    if (!pod?.id) {
      throw new ProviderCapacityUnavailableError(this.id, spec.resourceClass);
    }
    return { providerRef: pod.id };
  }

  /**
   * Maps the provider's state onto the contract's.
   *
   * Reads `runtimeStatus`, not `desiredStatus`: `desiredStatus` reports RUNNING
   * while the image is still pulling, which would have the dispatcher believe a
   * worker was live minutes before it could claim anything.
   */
  async status(providerRef: string): Promise<WorkerStatus> {
    const pod = await this.request<RunPodPod>("GET", `/pods/${providerRef}`).catch(() => null);
    if (!pod) return "unknown";

    const runtime = (pod.runtimeStatus ?? "").toUpperCase();
    const desired = (pod.desiredStatus ?? "").toUpperCase();

    if (runtime === "RUNNING") return "running";
    // "unknown" from the provider means the lookup failed, not that the pod is
    // down — so it must not be reported as stopped.
    if (runtime === "UNKNOWN" || runtime === "") {
      if (desired === "TERMINATED" || desired === "EXITED") return "stopped";
      return desired === "RUNNING" ? "pending" : "unknown";
    }
    if (runtime === "TERMINATED" || runtime === "EXITED") return "stopped";
    if (runtime.includes("FAIL") || runtime.includes("ERROR")) return "failed";
    return "pending";
  }

  /** Idempotent: terminating an already-gone pod is a success, not an error. */
  async terminate(providerRef: string): Promise<void> {
    await this.request("DELETE", `/pods/${providerRef}`).catch((error: unknown) => {
      if (isNotFound(error)) return;
      throw error;
    });
  }

  async estimateCost(
    resourceClass: VisionResourceClass,
    seconds: number
  ): Promise<CostEstimate> {
    // Deliberately configured rather than quoted live. A cost figure that changes
    // under us makes the cost-per-match trend — the number decisions are made on —
    // incomparable between runs. `fromConfiguredRate` says which it was.
    return {
      resourceClass,
      seconds,
      usdCents: estimateUsdCents(resourceClass, seconds, this.rateOverrides),
      fromConfiguredRate: true,
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    if (!this.config.apiKey) {
      throw new Error(
        "VISION_RUNPOD_API_KEY is not configured; this provider cannot launch capacity"
      );
    }

    const label = { method, path };
    const timeoutMs = this.config.requestTimeoutMs;
    const res = await requestWithTimeout(
      this.http,
      `${this.config.baseUrl}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      timeoutMs,
      label
    );
    // The deadline covers the body too, so a stalled body is reported as a timeout.
    const text = await res.text().catch((error: unknown) => {
      throw isTimeout(error) ? new ProviderTimeoutError(method, path, timeoutMs, { cause: error }) : error;
    });

    if (res.status === 404) throw new ProviderHttpError(404, "not found");
    if (!res.ok) {
      throw new ProviderHttpError(res.status, text.slice(0, 500));
    }
    if (res.status === 204) return null;

    return text ? (JSON.parse(text) as T) : null;
  }
}

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(`provider responded ${status}: ${message}`);
    this.name = "ProviderHttpError";
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof ProviderHttpError && error.status === 404;
}

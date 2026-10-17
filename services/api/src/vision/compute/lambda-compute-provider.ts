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
import { isTimeout, ProviderTimeoutError, requestWithTimeout, type HttpClient, type LambdaConfig } from "./provider-config";
import { ProviderHttpError } from "./runpod-compute-provider";
import { estimateUsdCents, parseRateOverrides } from "./resource-rates";

/**
 * Lambda Cloud, via its public cloud API.
 *
 * **This is the provider that tested the abstraction, and it did not fit for
 * free.** Lambda launches a *virtual machine* — `instance_type_name`,
 * `ssh_key_names`, `user_data` — and has no concept of a container at all. The
 * launch spec's `image` and `env` have nowhere to go.
 *
 * Two things had to give, and both are recorded rather than hidden:
 *
 * 1. **The image is honoured through cloud-init.** `user_data` installs Docker,
 *    pulls the OCI image and runs it with the environment. The domain still says
 *    "run this image with this env at this resource class"; how that happens on a
 *    bare VM is the adapter's problem, which is the boundary working.
 *
 * 2. **An SSH key is a prerequisite this provider cannot invent.** Lambda requires
 *    one and no other provider has the concept, so it comes from configuration,
 *    not from the spec. Adding `sshKeyNames` to `WorkerLaunchSpec` would have put
 *    one vendor's requirement into every caller.
 *
 * The dangerous asymmetry: **nothing on Lambda reaps a VM whose container has
 * exited.** RunPod can terminate a pod for you; here the instance keeps billing
 * after the work is done. So the cloud-init powers the machine off when the
 * container exits, and the dispatcher terminates as well. Belt and braces, because
 * a forgotten GPU VM is expensive and silent.
 */

type LambdaInstance = {
  id: string;
  status?: string;
};

export class LambdaComputeProvider implements ComputeProvider {
  readonly id = "lambda";

  private readonly rateOverrides = parseRateOverrides(process.env);

  constructor(
    private readonly config: LambdaConfig,
    private readonly http: HttpClient = fetch
  ) {}

  capabilities(): ProviderCapabilities {
    const configured = VISION_RESOURCE_CLASSES.filter(
      (c) => this.config.instanceTypes[c].length > 0
    );
    // Two prerequisites, both fatal: a credential, and an SSH key this provider
    // cannot create for itself. Advertising a class it cannot launch would have
    // the dispatcher pick it and fail.
    const ready = Boolean(this.config.apiKey) && this.config.sshKeyNames.length > 0;

    return {
      providerId: this.id,
      resourceClasses: ready ? configured : [],
      maxConcurrentWorkers: 4,
      productionApproved: true,
    };
  }

  async launch(spec: WorkerLaunchSpec): Promise<{ providerRef: string }> {
    const instanceTypes = this.config.instanceTypes[spec.resourceClass];
    if (!instanceTypes.length || !this.config.sshKeyNames.length) {
      throw new ProviderCapacityUnavailableError(this.id, spec.resourceClass);
    }
    if (!this.config.region) {
      throw new Error("VISION_LAMBDA_REGION is required: launch is region-scoped here");
    }

    // One attempt per configured instance type: this API launches an exact type,
    // so a class with three options means three tries, not one request with a list.
    let lastError: unknown = null;
    for (const instanceType of instanceTypes) {
      try {
        const res = await this.request<{ instance_ids?: string[] }>(
          "POST",
          "/instance-operations/launch",
          {
            region_name: this.config.region,
            instance_type_name: instanceType,
            ssh_key_names: this.config.sshKeyNames,
            name: `dtp-vision-${spec.resourceClass}`,
            user_data: this.cloudInit(spec),
            ...(this.config.filesystemNames.length
              ? { file_system_names: this.config.filesystemNames }
              : {}),
          }
        );
        const id = res?.instance_ids?.[0];
        if (id) return { providerRef: id };
      } catch (error) {
        // A launch that timed out may have started a VM all the same. Trying the next type
        // could start a second, so stop here; the first reaps itself (cloudInit, below).
        if (error instanceof ProviderTimeoutError) throw error;
        lastError = error;
      }
    }

    if (lastError instanceof Error && !(lastError instanceof ProviderHttpError)) {
      throw lastError;
    }
    throw new ProviderCapacityUnavailableError(this.id, spec.resourceClass);
  }

  async status(providerRef: string): Promise<WorkerStatus> {
    const res = await this.request<{ data?: LambdaInstance }>(
      "GET",
      `/instances/${providerRef}`
    ).catch(() => null);

    const status = (res?.data?.status ?? "").toLowerCase();
    if (!status) return "unknown";

    // Mapped explicitly rather than by prefix: "terminating" and "terminated" mean
    // different things to a dispatcher deciding whether to launch a replacement.
    switch (status) {
      case "active":
        return "running";
      case "booting":
        return "pending";
      case "terminating":
      case "terminated":
        return "stopped";
      case "unhealthy":
        return "failed";
      // A pre-empted spot instance is gone and will not come back on its own. It is
      // a failure from the caller's side, not a graceful stop.
      case "preempted":
        return "failed";
      default:
        return "unknown";
    }
  }

  async terminate(providerRef: string): Promise<void> {
    await this.request("POST", "/instance-operations/terminate", {
      instance_ids: [providerRef],
    }).catch((error: unknown) => {
      if (error instanceof ProviderHttpError && error.status === 404) return;
      throw error;
    });
  }

  async estimateCost(
    resourceClass: VisionResourceClass,
    seconds: number
  ): Promise<CostEstimate> {
    return {
      resourceClass,
      seconds,
      usdCents: estimateUsdCents(resourceClass, seconds, this.rateOverrides),
      fromConfiguredRate: true,
    };
  }

  /**
   * Turns a container launch spec into something a bare VM can act on.
   *
   * The `poweroff` is the important line: without it the instance outlives the
   * container and bills until somebody notices.
   */
  private cloudInit(spec: WorkerLaunchSpec): string {
    const envFlags = Object.entries(spec.env)
      .map(([key, value]) => `-e ${shellQuote(key)}=${shellQuote(value)}`)
      .join(" ");

    return [
      "#!/bin/bash",
      "set -euo pipefail",
      "# Docker is present on Lambda's ML images; install it if this is a plain one.",
      "command -v docker >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq docker.io)",
      `timeout ${spec.maxRuntimeSeconds}s docker run --rm --gpus all --network host \\`,
      `  ${envFlags} \\`,
      `  ${shellQuote(spec.image)} || true`,
      "# Nothing here reaps a VM whose container has exited, so it reaps itself.",
      "poweroff",
      "",
    ].join("\n");
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    if (!this.config.apiKey) {
      throw new Error(
        "VISION_LAMBDA_API_KEY is not configured; this provider cannot launch capacity"
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
    if (!res.ok) throw new ProviderHttpError(res.status, text.slice(0, 500));
    if (res.status === 204) return null;

    return text ? (JSON.parse(text) as T) : null;
  }
}

/** Single-quote for a POSIX shell: the env values reach a command line. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

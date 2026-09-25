import {
  type CostEstimate,
  type ProviderCapabilities,
  type VisionResourceClass,
  type WorkerLaunchSpec,
  type WorkerStatus,
} from "@dtp/vision-contracts";
import type { ComputeProvider } from "./compute-provider";
import { estimateUsdCents, parseRateOverrides } from "./resource-rates";

/**
 * A developer's own machine, or a self-hosted CUDA box.
 *
 * It does not start anything: the developer runs the worker container by hand
 * and it claims work over the same worker API as any hosted worker. That is the
 * portability requirement in practice — the same image, the same contract, no
 * provider SDK inside it.
 *
 * `launch` therefore returns a reference for a worker the caller is expected to
 * start themselves, and `status` reports "pending" until it registers.
 */
export class LocalComputeProvider implements ComputeProvider {
  readonly id = "local";

  private counter = 0;
  private readonly expected = new Map<string, WorkerLaunchSpec>();
  private readonly rateOverrides = parseRateOverrides(process.env);

  constructor(
    private readonly options: {
      /** What the local machine can actually run. Default: CPU work only. */
      resourceClasses?: readonly VisionResourceClass[];
    } = {}
  ) {}

  capabilities(): ProviderCapabilities {
    return {
      providerId: this.id,
      resourceClasses: this.options.resourceClasses ?? ["cpu_small"],
      maxConcurrentWorkers: 1,
      // Local runs are for development. Output must not reach a dataset or a
      // published fact without being reproduced on approved capacity.
      productionApproved: false,
    };
  }

  async launch(spec: WorkerLaunchSpec) {
    const providerRef = `local-${++this.counter}`;
    this.expected.set(providerRef, spec);
    return { providerRef };
  }

  async status(providerRef: string): Promise<WorkerStatus> {
    return this.expected.has(providerRef) ? "pending" : "unknown";
  }

  async terminate(providerRef: string) {
    this.expected.delete(providerRef);
  }

  async estimateCost(
    resourceClass: VisionResourceClass,
    seconds: number
  ): Promise<CostEstimate> {
    return {
      resourceClass,
      seconds,
      // Local hardware is already paid for, but reporting zero would make the
      // cost-per-match trend jump when work moves to hosted capacity.
      usdCents: estimateUsdCents(resourceClass, seconds, this.rateOverrides),
      fromConfiguredRate: true,
    };
  }
}

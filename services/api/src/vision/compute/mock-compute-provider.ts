import {
  VISION_RESOURCE_CLASSES,
  type CostEstimate,
  type ProviderCapabilities,
  type VisionResourceClass,
  type WorkerLaunchSpec,
  type WorkerStatus,
} from "@dtp/vision-contracts";
import type { ComputeProvider } from "./compute-provider";
import { estimateUsdCents } from "./resource-rates";

/**
 * In-process compute provider for tests and for local development.
 *
 * Its existence is the point: an abstraction with one implementation is a guess.
 * The Phase 0 gate is that a job spec can target this provider with no
 * provider-specific field anywhere in a domain API.
 */
export class MockComputeProvider implements ComputeProvider {
  readonly id = "mock";

  private counter = 0;
  private readonly workers = new Map<string, { status: WorkerStatus; spec: WorkerLaunchSpec }>();

  readonly launches: WorkerLaunchSpec[] = [];

  constructor(
    private readonly options: {
      maxConcurrentWorkers?: number;
      /** Set to fail launches, so failover handling can be tested. */
      capacityAvailable?: boolean;
    } = {}
  ) {}

  capabilities(): ProviderCapabilities {
    return {
      providerId: this.id,
      resourceClasses: VISION_RESOURCE_CLASSES,
      maxConcurrentWorkers: this.options.maxConcurrentWorkers ?? 4,
      productionApproved: false,
    };
  }

  async launch(spec: WorkerLaunchSpec) {
    if (this.options.capacityAvailable === false) {
      throw new Error("mock provider has no capacity");
    }
    const providerRef = `mock-worker-${++this.counter}`;
    this.workers.set(providerRef, { status: "running", spec });
    this.launches.push(spec);
    return { providerRef };
  }

  async status(providerRef: string): Promise<WorkerStatus> {
    return this.workers.get(providerRef)?.status ?? "unknown";
  }

  async terminate(providerRef: string) {
    const worker = this.workers.get(providerRef);
    if (worker) worker.status = "stopped";
  }

  async estimateCost(
    resourceClass: VisionResourceClass,
    seconds: number
  ): Promise<CostEstimate> {
    return {
      resourceClass,
      seconds,
      usdCents: estimateUsdCents(resourceClass, seconds),
      fromConfiguredRate: true,
    };
  }
}

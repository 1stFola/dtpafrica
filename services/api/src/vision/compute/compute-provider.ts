import type {
  CostEstimate,
  ProviderCapabilities,
  VisionResourceClass,
  WorkerLaunchSpec,
  WorkerStatus,
} from "@dtp/vision-contracts";

/**
 * The compute port.
 *
 * GPU capacity is temporary and replaceable. Domain code launches a portable
 * OCI workload through this interface and never learns whose hardware ran it —
 * `providerRef` is opaque and nothing outside an adapter may parse it. See
 * docs/vision/06-JOBS-AND-COMPUTE.md.
 */
export interface ComputeProvider {
  readonly id: string;

  capabilities(): ProviderCapabilities;

  launch(spec: WorkerLaunchSpec): Promise<{ providerRef: string }>;
  status(providerRef: string): Promise<WorkerStatus>;
  terminate(providerRef: string): Promise<void>;

  estimateCost(resourceClass: VisionResourceClass, seconds: number): Promise<CostEstimate>;
}

export const COMPUTE_PROVIDER = Symbol("COMPUTE_PROVIDER");
export const COMPUTE_PROVIDER_REGISTRY = Symbol("COMPUTE_PROVIDER_REGISTRY");

export class ProviderCapacityUnavailableError extends Error {
  constructor(
    readonly providerId: string,
    readonly resourceClass: VisionResourceClass
  ) {
    super(`No ${resourceClass} capacity available from ${providerId}`);
    this.name = "ProviderCapacityUnavailableError";
  }
}

export class ProviderNotProductionApprovedError extends Error {
  constructor(providerId: string) {
    super(
      `${providerId} is approved for experiments only. A job whose output can ` +
        `enter a dataset or a published fact may not run there.`
    );
    this.name = "ProviderNotProductionApprovedError";
  }
}

/**
 * Chooses a provider by id, and refuses an experiment-only provider for work
 * that produces durable output.
 *
 * Failover is deliberately manual in V1: an operator switches the active
 * provider by configuration, because DTP will not have a trustworthy health
 * signal from a provider on day one.
 */
export class ComputeProviderRegistry {
  private readonly byId = new Map<string, ComputeProvider>();

  constructor(providers: ComputeProvider[]) {
    for (const provider of providers) {
      this.byId.set(provider.id, provider);
    }
  }

  get(id: string): ComputeProvider {
    const provider = this.byId.get(id);
    if (!provider) {
      const known = [...this.byId.keys()].join(", ") || "none registered";
      throw new Error(`Unknown compute provider "${id}". Registered: ${known}`);
    }
    return provider;
  }

  /** For durable work — anything whose output may reach a dataset or a published fact. */
  getForProductionWork(id: string): ComputeProvider {
    const provider = this.get(id);
    if (!provider.capabilities().productionApproved) {
      throw new ProviderNotProductionApprovedError(id);
    }
    return provider;
  }

  list(): ComputeProvider[] {
    return [...this.byId.values()];
  }

  supporting(resourceClass: VisionResourceClass): ComputeProvider[] {
    return this.list().filter((p) => p.capabilities().resourceClasses.includes(resourceClass));
  }
}

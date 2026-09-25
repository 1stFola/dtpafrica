import { ComputeProviderRegistry, type ComputeProvider } from "./compute-provider";
import { LambdaComputeProvider } from "./lambda-compute-provider";
import { LocalComputeProvider } from "./local-compute-provider";
import { MockComputeProvider } from "./mock-compute-provider";
import { RunPodComputeProvider } from "./runpod-compute-provider";
import { loadLambdaConfig, loadRunPodConfig } from "./provider-config";

/**
 * Builds the registry of available compute providers.
 *
 * This exists so the composition root does not have to name a vendor. The module
 * asks for "the compute registry"; which providers are in it is a decision that
 * belongs here, beside the adapters, where `vision-boundaries.spec.ts` permits
 * vendor names.
 *
 * That test forced this file into existence, which is the third time it has caught
 * a leak. Wiring vendor classes in `vision.module.ts` would have worked perfectly
 * well and quietly made the module the one place that knows every provider by name.
 *
 * Both hosted providers are registered whether or not they are configured. An
 * unconfigured provider advertises no resource classes and refuses to launch, so
 * the dispatcher never selects it — and `GET /vision/status` shows an operator which
 * credentials are missing, rather than the provider simply being absent.
 */
export function buildComputeProviderRegistry(
  env: NodeJS.ProcessEnv = process.env
): ComputeProviderRegistry {
  const providers: ComputeProvider[] = [
    new RunPodComputeProvider(loadRunPodConfig(env)),
    new LambdaComputeProvider(loadLambdaConfig(env)),
    // Experiment-only, and the registry refuses them for durable work.
    new MockComputeProvider(),
    new LocalComputeProvider(),
  ];
  return new ComputeProviderRegistry(providers);
}

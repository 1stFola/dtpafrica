import type { VisionResourceClass } from "@dtp/vision-contracts";

/**
 * Provider credentials and resource-class mappings.
 *
 * Lives inside `compute/` on purpose. Vendor names are permitted in an adapter and
 * in configuration and nowhere else — `vision-boundaries.spec.ts` enforces that, so
 * putting `VISION_RUNPOD_*` in the shared config file would fail the build. The
 * adapter owning its own configuration is the abstraction working, not a
 * workaround.
 */

export type HttpClient = typeof fetch;

export type RunPodConfig = {
  apiKey: string | null;
  baseUrl: string;
  /**
   * Resource class to the provider's own GPU identifiers.
   *
   * Several ids per class because availability moves: a class that names only one
   * GPU fails the moment that GPU is out of stock in every data centre.
   */
  gpuTypeIds: Record<VisionResourceClass, string[]>;
  containerDiskGb: number;
  cloudType: "SECURE" | "COMMUNITY";
  /**
   * The provider's id for a stored registry credential, so a pod can pull DTP's private
   * image. The credential itself is created in the provider's console and never passes
   * through this API; null pulls anonymously, which only a public image allows.
   */
  registryAuthId: string | null;
};

export type LambdaConfig = {
  apiKey: string | null;
  baseUrl: string;
  region: string | null;
  /**
   * Required by the provider, and a prerequisite it cannot create for itself.
   *
   * Lambda launches a VM and grants access by SSH key, so a key must already exist
   * in the account. There is nothing equivalent in the domain's launch spec,
   * because no other provider needs it.
   */
  sshKeyNames: string[];
  instanceTypes: Record<VisionResourceClass, string[]>;
  filesystemNames: string[];
};

const DEFAULT_RUNPOD_GPUS: Record<VisionResourceClass, string[]> = {
  cpu_small: [],
  gpu_24gb: ["NVIDIA L4", "NVIDIA GeForce RTX 4090", "NVIDIA RTX A5000"],
  gpu_48gb: ["NVIDIA RTX A6000", "NVIDIA RTX 6000 Ada Generation", "NVIDIA L40S"],
  gpu_80gb: ["NVIDIA A100 80GB PCIe", "NVIDIA H100 PCIe"],
};

const DEFAULT_LAMBDA_TYPES: Record<VisionResourceClass, string[]> = {
  cpu_small: [],
  gpu_24gb: ["gpu_1x_a10"],
  gpu_48gb: ["gpu_1x_a6000"],
  gpu_80gb: ["gpu_1x_a100_sxm4", "gpu_1x_h100_pcie"],
};

function list(raw: string | undefined, fallback: string[]): string[] {
  const parsed = (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim() || NaN);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadRunPodConfig(env: NodeJS.ProcessEnv = process.env): RunPodConfig {
  return {
    apiKey: env.VISION_RUNPOD_API_KEY?.trim() || null,
    // The control API is v1-only; v2 on this host just redirects to documentation.
    baseUrl: env.VISION_RUNPOD_BASE_URL?.trim() || "https://rest.runpod.io/v1",
    gpuTypeIds: {
      cpu_small: [],
      gpu_24gb: list(env.VISION_RUNPOD_GPUS_24GB, DEFAULT_RUNPOD_GPUS.gpu_24gb),
      gpu_48gb: list(env.VISION_RUNPOD_GPUS_48GB, DEFAULT_RUNPOD_GPUS.gpu_48gb),
      gpu_80gb: list(env.VISION_RUNPOD_GPUS_80GB, DEFAULT_RUNPOD_GPUS.gpu_80gb),
    },
    // Empty is unset (#205's class): `Number("")` is 0, a pod with no disk.
    containerDiskGb: positiveNumber(env.VISION_RUNPOD_DISK_GB, 60),
    cloudType: env.VISION_RUNPOD_CLOUD_TYPE?.trim() === "COMMUNITY" ? "COMMUNITY" : "SECURE",
    registryAuthId: env.VISION_RUNPOD_REGISTRY_AUTH_ID?.trim() || null,
  };
}

export function loadLambdaConfig(env: NodeJS.ProcessEnv = process.env): LambdaConfig {
  return {
    apiKey: env.VISION_LAMBDA_API_KEY?.trim() || null,
    baseUrl: env.VISION_LAMBDA_BASE_URL?.trim() || "https://cloud.lambda.ai/api/v1",
    region: env.VISION_LAMBDA_REGION?.trim() || null,
    sshKeyNames: list(env.VISION_LAMBDA_SSH_KEY_NAMES, []),
    instanceTypes: {
      cpu_small: [],
      gpu_24gb: list(env.VISION_LAMBDA_TYPES_24GB, DEFAULT_LAMBDA_TYPES.gpu_24gb),
      gpu_48gb: list(env.VISION_LAMBDA_TYPES_48GB, DEFAULT_LAMBDA_TYPES.gpu_48gb),
      gpu_80gb: list(env.VISION_LAMBDA_TYPES_80GB, DEFAULT_LAMBDA_TYPES.gpu_80gb),
    },
    filesystemNames: list(env.VISION_LAMBDA_FILESYSTEMS, []),
  };
}

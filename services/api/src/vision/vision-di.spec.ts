import { Test, type TestingModule } from "@nestjs/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../prisma/prisma.service";
import { VisionAuditService } from "./audit/vision-audit.service";
import { VisionDatasetsController } from "./datasets/datasets.controller";
import { VisionDatasetsService } from "./datasets/datasets.service";
import { VisionAnnotationController } from "./annotation/annotation.controller";
import { VisionAnnotationService } from "./annotation/annotation.service";
import { VisionUploadService } from "./assets/upload.service";
import { VisionUploadsController } from "./assets/uploads.controller";
import { VisionPartnerUploadsController } from "./assets/partner-uploads.controller";
import { VisionSourcesController } from "./sources/sources.controller";
import { VisionSourcesService } from "./sources/sources.service";
import { COMPUTE_PROVIDER_REGISTRY } from "./compute/compute-provider";
import { VISION_CONFIG } from "./config/vision.config";
import { VisionJobDispatcher } from "./jobs/job-dispatcher.service";
import { JOB_QUEUE } from "./jobs/job-queue";
import { VisionJobsController } from "./jobs/jobs.controller";
import { VisionStageResultsService } from "./jobs/stage-results.service";
import { VisionJobsService } from "./jobs/vision-jobs.service";
import { VisionModelsController } from "./models/models.controller";
import { VisionModelsService } from "./models/models.service";
import { RightsPolicyService } from "./rights/rights-policy.service";
import { OBJECT_STORE } from "./storage/object-store";
import { VisionModule } from "./vision.module";
import { VisionStatusController } from "./vision-status.controller";
import { VisionWorkerController } from "./worker/worker.controller";
import { WorkerTokenService } from "./worker/worker-token.service";

/**
 * Dependency-injection smoke test.
 *
 * This exists because of a bug every other test missed, twice. Services and
 * controllers are unit-tested by constructing them directly —
 * `new VisionJobsController(a, b, c, …)` — which proves the *logic* and says
 * nothing about whether Nest can build them. Both times the symptom was the same:
 * every test passing, and the first HTTP request returning 500.
 *
 * The cause: in a constructor that uses `@Inject()` for any parameter, every
 * parameter left to a reflected type resolves to `undefined`. So every Vision
 * constructor is fully explicit, and this compiles the real module and checks it.
 *
 * The lists below were originally maintained by hand, under a comment asking the
 * next person to remember. "Coverage is complete" and "someone remembered" are not
 * the same claim, so the last two tests derive the expectation from the module's own
 * metadata: a provider or controller added to `VisionModule` and not listed here
 * fails this file rather than being silently skipped.
 */

const PROVIDERS = [
  VISION_CONFIG,
  OBJECT_STORE,
  COMPUTE_PROVIDER_REGISTRY,
  JOB_QUEUE,
  RightsPolicyService,
  VisionAuditService,
  VisionJobsService,
  VisionStageResultsService,
  VisionUploadService,
  VisionJobDispatcher,
  VisionSourcesService,
  VisionDatasetsService,
  VisionAnnotationService,
  VisionModelsService,
  WorkerTokenService,
] as const;

const CONTROLLERS = [
  VisionStatusController,
  VisionJobsController,
  VisionWorkerController,
  VisionUploadsController,
  VisionPartnerUploadsController,
  VisionSourcesController,
  VisionDatasetsController,
  VisionAnnotationController,
  VisionModelsController,
] as const;

const SERVICES = [
  VisionJobsService,
  VisionStageResultsService,
  VisionUploadService,
  VisionJobDispatcher,
  VisionSourcesService,
  RightsPolicyService,
  VisionAuditService,
  VisionDatasetsService,
  VisionAnnotationService,
  VisionModelsService,
  WorkerTokenService,
] as const;

/**
 * Properties that are legitimately empty and are NOT dependencies.
 *
 * Kept explicit and short: an unexplained entry here would hide the very bug this
 * file exists to catch, so each one says why it is nullable.
 */
const NULLABLE_STATE: Record<string, readonly string[]> = {
  // Set only once the timer starts, and it does not start while Vision is off.
  VisionJobDispatcher: ["timer"],
};

/** Properties that look like an unresolved dependency rather than empty state. */
function undefinedDependencies(className: string, instance: Record<string, unknown>): string[] {
  const allowed = NULLABLE_STATE[className] ?? [];
  return Object.entries(instance)
    .filter(([key, value]) => (value === undefined || value === null) && !allowed.includes(key))
    .map(([key]) => key);
}

describe("VisionModule resolves through the container", () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [VisionModule] })
      // The only thing stubbed is the database connection. Everything else is the
      // real wiring, because the wiring is what is under test.
      .overrideProvider(PrismaService)
      .useValue({ $connect: async () => undefined, $disconnect: async () => undefined })
      .compile();
  });

  it("compiles", () => {
    expect(moduleRef).toBeDefined();
  });

  /**
   * Guards the guard. Without these two, adding a controller and forgetting to list
   * it above leaves this file passing while covering nothing new — which is how a
   * DI bug reached production twice already.
   */
  it("checks every controller the module declares", () => {
    const declared = (Reflect.getMetadata("controllers", VisionModule) ?? []) as { name: string }[];
    const covered = new Set(CONTROLLERS.map((c) => c.name));
    expect(declared.map((c) => c.name).filter((n) => !covered.has(n))).toEqual([]);
  });

  it("checks every class provider the module declares", () => {
    const declared = (Reflect.getMetadata("providers", VisionModule) ?? []) as unknown[];
    // Factory and value providers are objects with a `provide` token; their tokens
    // are covered by PROVIDERS instead.
    const classes = declared.filter(
      (entry): entry is { name: string } =>
        typeof entry === "function" && typeof (entry as { name?: string }).name === "string"
    );
    const covered = new Set<string>([
      ...PROVIDERS.filter((t) => typeof t === "function").map((t) => (t as { name: string }).name),
      ...SERVICES.map((s) => s.name),
      // Guards are exercised through the controllers that mount them.
      "AdminAuthGuard",
      "PermissionsGuard",
      "AdminAuthService",
      "PartnerUploadGuard",
      "VisionWorkerGuard",
      "VisionWorkerBootstrapGuard",
    ]);
    expect(classes.map((c) => c.name).filter((n) => !covered.has(n))).toEqual([]);
  });

  it.each(PROVIDERS.map((token) => [String(token.toString()).slice(0, 48), token] as const))(
    "provides %s",
    (_label, token) => {
      expect(moduleRef.get(token as never, { strict: false })).toBeDefined();
    }
  );

  /**
   * The assertion that would have caught the original bug. A controller whose
   * dependencies are `undefined` still constructs, so fetching it is not enough —
   * every declared dependency has to be checked for presence.
   */
  it.each(CONTROLLERS.map((c) => [c.name, c] as const))(
    "%s has every dependency populated",
    (name, ControllerClass) => {
      const instance = moduleRef.get(ControllerClass, { strict: false }) as Record<string, unknown>;
      expect(instance).toBeDefined();
      expect(undefinedDependencies(name, instance)).toEqual([]);
    }
  );

  it.each(SERVICES.map((s) => [s.name, s] as const))(
    "%s has every dependency populated",
    (name, ServiceClass) => {
      const instance = moduleRef.get(ServiceClass, { strict: false }) as Record<string, unknown>;
      expect(undefinedDependencies(name, instance)).toEqual([]);
    }
  );
});

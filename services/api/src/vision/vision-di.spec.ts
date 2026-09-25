import { Test, type TestingModule } from "@nestjs/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../prisma/prisma.service";
import { VisionAuditService } from "./audit/vision-audit.service";
import { VisionUploadService } from "./assets/upload.service";
import { VisionUploadsController } from "./assets/uploads.controller";
import { COMPUTE_PROVIDER_REGISTRY } from "./compute/compute-provider";
import { VISION_CONFIG } from "./config/vision.config";
import { VisionJobDispatcher } from "./jobs/job-dispatcher.service";
import { JOB_QUEUE } from "./jobs/job-queue";
import { VisionJobsController } from "./jobs/jobs.controller";
import { VisionStageResultsService } from "./jobs/stage-results.service";
import { VisionJobsService } from "./jobs/vision-jobs.service";
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
 * **If you add a provider or controller, add it here.**
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
  WorkerTokenService,
] as const;

const CONTROLLERS = [
  VisionStatusController,
  VisionJobsController,
  VisionWorkerController,
  VisionUploadsController,
] as const;

const SERVICES = [
  VisionJobsService,
  VisionStageResultsService,
  VisionUploadService,
  VisionJobDispatcher,
  RightsPolicyService,
  VisionAuditService,
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

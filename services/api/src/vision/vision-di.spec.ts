import { Test } from "@nestjs/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../prisma/prisma.service";
import { COMPUTE_PROVIDER_REGISTRY } from "./compute/compute-provider";
import { VISION_CONFIG } from "./config/vision.config";
import { JOB_QUEUE } from "./jobs/job-queue";
import { VisionJobsController } from "./jobs/jobs.controller";
import { VisionStageResultsService } from "./jobs/stage-results.service";
import { VisionJobsService } from "./jobs/vision-jobs.service";
import { RightsPolicyService } from "./rights/rights-policy.service";
import { VisionAuditService } from "./audit/vision-audit.service";
import { OBJECT_STORE } from "./storage/object-store";
import { VisionModule } from "./vision.module";
import { VisionStatusController } from "./vision-status.controller";
import { VisionWorkerController } from "./worker/worker.controller";
import { WorkerTokenService } from "./worker/worker-token.service";

/**
 * Dependency-injection smoke test.
 *
 * This exists because of a bug that every other test missed. Services and
 * controllers are unit-tested by constructing them directly —
 * `new VisionJobsController(a, b, c, …)` — which proves the *logic* but says
 * nothing about whether Nest can build them. Two rounds of "207 tests pass,
 * first HTTP request 500s" came from exactly that gap.
 *
 * The cause: in a constructor that uses `@Inject()` for some parameters, the
 * parameters left to reflected types resolve to `undefined`. So every Vision
 * constructor is fully explicit, and this test compiles the real module and
 * resolves every provider to prove it.
 *
 * If you add a provider, add it here.
 */

const EXPECTED = [
  VISION_CONFIG,
  OBJECT_STORE,
  COMPUTE_PROVIDER_REGISTRY,
  JOB_QUEUE,
  RightsPolicyService,
  VisionAuditService,
  VisionJobsService,
  VisionStageResultsService,
  WorkerTokenService,
] as const;

const CONTROLLERS = [VisionStatusController, VisionJobsController, VisionWorkerController] as const;

describe("VisionModule resolves through the container", () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [VisionModule] })
      // The only thing stubbed is the database connection. Everything else is
      // the real wiring, because the wiring is what is under test.
      .overrideProvider(PrismaService)
      .useValue({ $connect: async () => undefined, $disconnect: async () => undefined })
      .compile();
  });

  it("compiles", () => {
    expect(moduleRef).toBeDefined();
  });

  it.each(EXPECTED.map((token) => [String(token.toString().slice(0, 48)), token] as const))(
    "provides %s",
    (_label, token) => {
      expect(moduleRef.get(token as never, { strict: false })).toBeDefined();
    }
  );

  /**
   * The assertion that would have caught the original bug: a controller whose
   * dependencies are `undefined` still constructs, so it is not enough to fetch
   * it — every declared dependency has to be checked for presence.
   */
  it.each(CONTROLLERS.map((c) => [c.name, c] as const))(
    "%s has every dependency populated",
    (_name, ControllerClass) => {
      const instance = moduleRef.get(ControllerClass, { strict: false }) as Record<string, unknown>;
      expect(instance).toBeDefined();

      const missing = Object.entries(instance)
        .filter(([, value]) => value === undefined || value === null)
        .map(([key]) => key);

      expect(missing).toEqual([]);
    }
  );

  it.each([VisionJobsService, VisionStageResultsService, RightsPolicyService, VisionAuditService, WorkerTokenService].map(
    (s) => [s.name, s] as const
  ))("%s has every dependency populated", (_name, ServiceClass) => {
    const instance = moduleRef.get(ServiceClass, { strict: false }) as Record<string, unknown>;
    const missing = Object.entries(instance)
      .filter(([, value]) => value === undefined || value === null)
      .map(([key]) => key);

    expect(missing).toEqual([]);
  });
});

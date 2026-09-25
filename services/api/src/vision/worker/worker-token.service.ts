import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { VisionResourceClass } from "@dtp/vision-contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { VISION_CONFIG, type VisionConfig } from "../config/vision.config";

/**
 * Worker credentials.
 *
 * Workers run on ephemeral third-party hardware, so they get the least the job
 * allows: a token that is hashed at rest, expires, and only ever lets its holder
 * act on the single job it currently holds. See
 * docs/vision/06-JOBS-AND-COMPUTE.md.
 *
 * Two stages, deliberately:
 *
 *   bootstrap  minted when capacity is launched, valid for one `register` call
 *   worker     issued by `register`, valid for claiming and running jobs
 *
 * The bootstrap token is what the provider adapter injects into the container's
 * environment. It is short-lived so that a launch spec captured from provider
 * logs is worthless within the hour.
 */

export type WorkerIdentity = {
  workerId: string;
  resourceClasses: VisionResourceClass[];
  providerId: string;
};

function hash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time compare, so a token cannot be recovered by timing the failure. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

@Injectable()
export class WorkerTokenService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VISION_CONFIG) private readonly config: VisionConfig
  ) {}

  /**
   * Creates the worker record and its one-shot bootstrap token.
   *
   * Returns the plaintext exactly once — only the hash is stored, so a leaked
   * database gives an attacker nothing they can present.
   */
  async mintBootstrap(params: {
    providerId: string;
    providerRef?: string | null;
    resourceClass: VisionResourceClass;
    image: string;
  }): Promise<{ workerId: string; bootstrapToken: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const worker = await this.prisma.visionWorker.create({
      data: {
        providerId: params.providerId,
        providerRef: params.providerRef ?? null,
        resourceClass: params.resourceClass,
        image: params.image,
        tokenHash: hash(token),
        tokenExpiresAt: expiresAt,
      },
      select: { id: true },
    });

    return { workerId: worker.id, bootstrapToken: token, expiresAt };
  }

  /**
   * Exchanges a bootstrap token for a worker token.
   *
   * The bootstrap token stops working the moment this succeeds: the stored hash
   * is replaced, so it cannot be replayed to register a second worker.
   */
  async register(bootstrapToken: string): Promise<{ identity: WorkerIdentity; workerToken: string; expiresAt: Date }> {
    const worker = await this.findByToken(bootstrapToken);
    if (worker.retiredAt) throw new UnauthorizedException("Worker has been retired");

    const workerToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(
      Date.now() + this.config.jobs.workerTokenTtlHours * 60 * 60 * 1000
    );

    await this.prisma.visionWorker.update({
      where: { id: worker.id },
      data: { tokenHash: hash(workerToken), tokenExpiresAt: expiresAt },
    });

    return {
      identity: {
        workerId: worker.id,
        resourceClasses: [worker.resourceClass as VisionResourceClass],
        providerId: worker.providerId,
      },
      workerToken,
      expiresAt,
    };
  }

  /** Verifies a worker token and returns who it belongs to. */
  async verify(token: string): Promise<WorkerIdentity> {
    const worker = await this.findByToken(token);
    if (worker.retiredAt) throw new UnauthorizedException("Worker has been retired");
    return {
      workerId: worker.id,
      resourceClasses: [worker.resourceClass as VisionResourceClass],
      providerId: worker.providerId,
    };
  }

  async retire(workerId: string): Promise<void> {
    await this.prisma.visionWorker.update({
      where: { id: workerId },
      // Rotating the hash to an unguessable value means a token already in
      // flight stops working, not merely that the row is flagged.
      data: { retiredAt: new Date(), tokenHash: hash(randomBytes(32).toString("hex")) },
    });
  }

  private async findByToken(token: string) {
    const trimmed = token.trim();
    if (!trimmed) throw new UnauthorizedException("Worker token required");

    const candidate = hash(trimmed);
    const worker = await this.prisma.visionWorker.findUnique({
      where: { tokenHash: candidate },
      select: {
        id: true,
        providerId: true,
        resourceClass: true,
        tokenHash: true,
        tokenExpiresAt: true,
        retiredAt: true,
      },
    });

    // Unknown token and expired token give the same message: a worker has no
    // business learning which of the two it was.
    if (!worker || !hashesMatch(worker.tokenHash, candidate)) {
      throw new UnauthorizedException("Invalid worker token");
    }
    if (worker.tokenExpiresAt <= new Date()) {
      throw new UnauthorizedException("Invalid worker token");
    }
    return worker;
  }
}

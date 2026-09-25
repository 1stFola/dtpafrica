import { IsIn } from "class-validator";

/**
 * Inputs are requested by ROLE, never by key.
 *
 * The control plane resolves the role to an object key from the job's own asset,
 * so a worker cannot name an input path any more than it can name an output one.
 */
export const WORKER_INPUT_ROLES = ["source", "proxy"] as const;
export type WorkerInputRole = (typeof WORKER_INPUT_ROLES)[number];

export class InputUrlDto {
  @IsIn(WORKER_INPUT_ROLES as unknown as string[])
  role!: WorkerInputRole;
}

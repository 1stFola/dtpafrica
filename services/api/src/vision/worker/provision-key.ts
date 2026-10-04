/**
 * The key a worker beside the API provisions itself with, and nothing else.
 *
 * A worker in the compose stack has no provider to hand it a bootstrap token, so
 * it asks the API for one. It used to ask with the operator key: the full
 * `ADMIN_API_KEY`, which is every permission in the system, sitting in the
 * environment of the container that decodes footage from outside
 * (docs/vision/50, appendix E).
 *
 * This key is derived from the operator key and is not it:
 *
 *     sha256("vision-worker-provision-v1:" + ADMIN_API_KEY), in hex
 *
 * - It cannot be turned back into the operator key.
 * - It opens two routes, provisioning and retiring, and only for a provider that
 *   launches nothing (`PROVISION_KEY_PROVIDERS`). It cannot start a paid pod,
 *   retire a hosted worker, or read anything.
 * - There is no new secret to create or to forget to rotate: the deploy derives
 *   it where it writes the worker's environment, and rotating the operator key
 *   rotates it.
 *
 * The same derivation is in `infra/ansible/roles/deploy/templates/staging.env.j2`
 * and in the CI workflow; `provision-key.spec.ts` pins it with a known answer.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const PROVISION_KEY_HEADER = "x-vision-provision-key";
export const PROVISION_KEY_CONTEXT = "vision-worker-provision-v1";

/** Providers the provision key may act for: the ones that start nothing and cost nothing. */
export const PROVISION_KEY_PROVIDERS: readonly string[] = ["local"];

/** The provision key for an operator key, or null when there is no operator key to derive it from. */
export function provisionKeyFor(adminApiKey: string | undefined | null): string | null {
  const key = adminApiKey?.trim();
  if (!key) return null;
  return createHash("sha256").update(`${PROVISION_KEY_CONTEXT}:${key}`, "utf8").digest("hex");
}

/** Whether `presented` is the provision key for this operator key. Constant time in the key's length. */
export function isProvisionKey(presented: string | undefined | null, adminApiKey: string | undefined | null): boolean {
  const expected = provisionKeyFor(adminApiKey);
  const given = presented?.trim();
  if (!expected || !given) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

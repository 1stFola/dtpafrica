# 67 — QA fix 17: a provision-only key for the worker

The worker on the box asks the API for its own bootstrap token when it starts, and
retires its row when it stops ([46](./46-WORKER-ON-THE-BOX.md)). It asked with
`ADMIN_API_KEY`, the operator key, which carries every permission in the system.
[51](./51-QA-FIX-1-SECRETS.md) took that key out of FFmpeg's environment and left the
rest in the backlog: the container that decodes outside footage still held it. It no
longer does. The worker holds a key that provisions and retires the box's own worker and
does nothing else.

---

## The key

`VISION_PROVISION_KEY` is the SHA-256, in hex, of `vision-worker-provision-v1:` followed
by the operator key (trimmed). It is sent in its own header, `x-vision-provision-key`.

It is derived, not a new secret, for three reasons:

- There is nothing new to store, hand out or forget. The deploy computes it where it
  writes the worker's environment, and the API computes it to recognise it.
- It cannot be turned back into the operator key.
- Rotating the operator key rotates it, on the same deploy.

The API compares in constant time. With no operator key configured there is no provision
key, and every one presented is refused.

## What it may do

| Request | With the provision key |
|---|---|
| `POST /vision/workers/provision`, provider `local` | allowed |
| `POST /vision/workers/provision`, any other provider, named or by the server's default | `403 ProvisionKeyScope`; nothing is minted, nothing launched |
| `POST /vision/workers/:id/retire`, a `local` worker | allowed |
| `POST /vision/workers/:id/retire`, any other provider's worker | `403 ProvisionKeyScope` |
| Any other route | `401`: no other guard knows the header |
| The key sent as `x-admin-api-key` | `401`: it is not the operator key |
| The operator key sent as `x-vision-provision-key` | `401 ProvisionKeyInvalid` |

`local` launches nothing: provisioning it writes a worker row and returns a one-time
token. So the worst a stolen provision key does is mint bootstrap tokens for CPU workers
that can claim CPU jobs, and retire the box's own workers. It cannot start a paid pod,
read footage, or touch a person's record.

An admin with `vision.jobs.run` may still do both for any provider, as before.

## How it is built

- **`worker/provision-key.ts`** derives and compares the key.
- **`worker/worker-provision.guard.ts`** is the door. A request that presents the header
  is judged on the key alone: a wrong one is refused there and never falls through to the
  admin check. A request without the header goes through the admin guards unchanged.
- **`worker/worker-provision.controller.ts`** holds the two routes, moved out of the jobs
  controller, and limits what the key may do past the door.
- **`bootstrap.py`** reads `VISION_PROVISION_KEY` and sends the new header. The old
  variable, `VISION_PROVISION_API_KEY`, is no longer read. If it is set and the new one
  is not, the worker says how to fix it and exits 2; either way it is removed from the
  environment before any stage runs.
- **`docker-compose.staging.yml`** gives the worker `VISION_PROVISION_KEY` and nothing
  from `ADMIN_API_KEY`.
- **`staging.env.j2`** derives the key with Ansible's `hash('sha256')`.

One fix came with the move: retiring a worker that does not exist answered 500. It
answers `404 NotFound`.

## Three places compute the key

The API, the deploy template and a shell line in CI. If they drift, the worker on the
box cannot start. So:

- the API's derivation is pinned by a test with a known answer computed outside the code;
- the same test holds the template's line and the workflow's line to their exact text;
- a new step in CI's `verify` job renders the template's own line with Ansible, for a key
  made up on the spot, and compares it with the shell's answer.

## Tests and checks

| Check | Result |
|---|---|
| API suite | 1,539 passed (was 1,523); typecheck clean |
| Worker suite | 332 passed (was 328) |
| Mutation runner | 22 of 22 killed: the derivation, the comparison, the guard's fall-through, the controller's limits, the compose file, the template, and the worker's handling of both variables |
| `vision:trackcheck` | 67 of 67, twice. Nine new checks against a running API: the key provisions and retires a `local` worker; refused for another provider, for a wrong key, for the operator key in its header, on another route, and under the operator's header; retire of an unknown worker is 404 |
| Nineteen other gates | all pass. `vision:r2check` was not run locally: it talks to the store and to no route; CI runs it |
| `vision:e2echeck`, image rebuilt | 38 of 38 |
| The real bootstrap against a running API | with the derived key: provisioned, registered, drained, retired, exit 0. With only the old variable: exit 2, the key not printed. With the operator key in the new variable: refused 401 |
| The template, rendered by ansible-core in a container | equals the API's known answer |
| The new CI step, run in a Linux container | passes |
| The compose file, rendered | `VISION_PROVISION_KEY` on the worker; `ADMIN_API_KEY` on the API only |
| Gate litter | none |

## What is not done

| Item | Why |
|---|---|
| **Rotating the operator key** | Still Fola's ([51](./51-QA-FIX-1-SECRETS.md)). It now rotates the provision key with it. |
| **A key per worker** | One box, one worker. If there are ever several boxes, each wants its own. |
| **An audit row per provision** | The response names `provision_key` as the requester; nothing is written to the audit log for either caller. |
| **Hosted workers** | Unchanged. A provider hands them a bootstrap token; they never held either key. |

## After merge

Nothing to add to the secret store. The deploy writes `VISION_PROVISION_KEY` into
`infra/.env.staging` from the template, and compose refuses to start the worker without
it, so the worker comes up with the new key on the deploy that carries this change. The
API and the worker must be on this change together, which a deploy does; a worker image
from before it would send the old header and be refused.

Watch the first deploy: `docker compose ... logs worker` should show the worker
provisioned and registered.

# 90 — A hosted worker needs a URL it can reach, and what else a RunPod run needs

8 October 2026. Fola chose a RunPod GPU run, within the $4 ceiling, for the pilot's
next missing stage (detect, see [89](./89-PHASE-6-INCREMENT-18.md)). Reading the
provisioning path end to end before buying anything turned up a code fault and
three things outside the code.

## The fault, fixed here

`POST /vision/workers/provision` gave every provider the worker callback
`VISION_WORKER_CALLBACK_URL: "/api/v1/vision/worker"`, a relative path. That works
for the `local` provider, whose operator starts the container and names the host.
A pod on a hosted provider's network has no host to resolve the path against. It
would boot, fail its bootstrap (the worker requires an absolute URL ending in the
worker path), and keep billing until its idle shutdown. No hosted worker has run
since the provider was written, so nothing showed it.

**What changed:**

- **New config key.** `VISION_HOSTED_WORKER_CALLBACK_URL` becomes
  `compute.hostedWorkerCallbackUrl`. It is checked at boot:
  - It must be https, or http only to `localhost`, `127.0.0.1` or `[::1]`, because
    the bootstrap token travels to it.
  - It must end in `/api/v1/vision/worker`.
  - It must have no query, fragment or credentials.
  - Blank means unset, so a deploy without the key still boots.

  It is deliberately not `VISION_WORKER_CALLBACK_URL`, which is the box worker's own
  setting and names `api:3000` on the compose network.
- **Provisioning.** The `local` and `mock` providers keep the relative path. Any
  other provider gets the configured URL. If none is set, provisioning is refused
  with `409 WorkerCallbackUrlMissing`, before a token is minted or a pod bought.
  The order of the existing checks (provision-key scope, offered resource class) is
  unchanged.
- **Deploy files.** The staging compose file passes the key to the API container,
  and `infra/.env.example` documents it.

**QA:**

- **Tests:** API 1,847 of 1,848 pass. The one failure is the local CRLF checkout
  issue in `scripts/gates.spec.ts` described in doc 89, in an untouched file. The
  API typecheck passes, and `docker compose config` interpolates the new key.
- **Mutation testing:** six mutants killed: refusal removed, relative path always,
  every provider treated as self-started, http allowed anywhere, any path accepted,
  credentials accepted.
- **Live:** a second API on port 3100 held only a dummy RunPod key, so a faulty
  guard could not have bought a pod. Provisioning `runpod`/`gpu_24gb` through it
  returned the 409. Worker and audit row counts were unchanged (2 and 25), and no
  pod was launched.

## What a RunPod detect run still needs

None of these is code, and each is Fola's to decide or do.

1. **The FFmpeg licence condition.** `docs/licenses/OSS_REGISTER.md` approves the
   worker's GPL FFmpeg "for use inside DTP's own worker only" and asks for review
   before "the worker is run by a hosted GPU provider". Choosing RunPod is not by
   itself that review. It needs a ruling recorded in the register: whether running
   DTP's own image on rented hardware counts as giving it to someone outside DTP.
2. **An image RunPod can pull.** Provisioning sends `VISION_WORKER_IMAGE`, locally
   `dtp-vision-engine:0.1.0`, which exists only on this machine. Detect needs the
   GPU image (`Dockerfile.gpu`, torch and torchvision). CD builds and pushes only the
   CPU image, to private ECR. RunPod would need either registry credentials for ECR
   or a different registry. Pushing an image is publishing it, so it waits on item 1.
3. **A control plane the pod can reach.** The pilot lives in this machine's local
   database, and a pod cannot reach `localhost`. The options are:
   - run the pilot on staging, which means setting this key and the RunPod key in
     `dtp/staging/app` (staging's compose file does not pass `VISION_RUNPOD_API_KEY`
     to the API today), then re-uploading the clip and repeating its rights and
     calibration steps there; or
   - expose this machine's API through an https tunnel for the length of the run.

   The tunnel is quicker. It also publishes an admin-guarded API to the internet for
   that time.

The cost estimate is unchanged by any of this: about 1,244 frames at 25 fps on a
24 GB card is minutes, well inside $4, plus image pull time on a cold pod.

# 104 — A scratch rehearsal, freeze to train

29 October 2026. While labelling is under way, the pipeline from a frozen dataset to a
benchmarked version was rehearsed end to end on the laptop. The aim was to find what
breaks before the first real run costs money. It reached training and stopped there:
register, detect with the trained weights, and the benchmark are still to rehearse.
What it found is below, most important first.

## How it ran

- **Nothing real was touched.**
  - A scratch database, `dtp_rehearsal`, was a copy of the local dev database.
  - A scratch API on port 3250 ran from a detached `main` worktree. Its `.env` refused
    to run unless `DATABASE_URL` named `dtp_rehearsal`.
  - SeaweedFS stood in for R2 (MinIO's image could not be pulled). Its buckets
    carried the staging names, and 50 objects were copied in from the dev store.
  - The RunPod key was a dummy and the provider was `mock`, so nothing could launch.
  - Two local workers (`gpu_24gb` and `cpu_small`) ran from the
    `dtp-vision-engine:gpu-339d467` image with the worktree's worker code mounted.
- **The data.**
  - Four 1XCup clips, one per match. Clip A carried the labellers' 37 real
    submissions.
  - The other three got the detector's own boxes as stand-in labels, in the scratch
    copy only.
  - Two scratch reviewers, both signed in as themselves, met the two-person gold rule.
- **Steps that passed:** the dataset, splits grouped by match, freeze, and export.
  The export held 4 samples and 62 label windows: 8 gold, 46 train and 8 val.

## Findings

1. **Presigned uploads carried an empty-body checksum. Fixed on this branch.**
   - The S3 SDK's default flexible checksums signed
     `x-amz-checksum-crc32=AAAAAA==` into every presigned `PUT` and `UploadPart` URL.
     That is the CRC32 of an empty body, because the URL is made before the body
     exists.
   - SeaweedFS checks it, and refused the 166 MB `weights.pt` with HTTP 400 after a
     complete training epoch.
   - R2 does not check it today, which is why production uploads work. Any store that
     does check would refuse every worker upload: MinIO, AWS S3, or R2 if Cloudflare
     starts checking.
   - The client now computes checksums only where the API requires one
     (`requestChecksumCalculation: "WHEN_REQUIRED"`), as Cloudflare advises for R2.
     `r2-presign.spec.ts` covers both URL kinds.
2. **A job's budget is per attempt.**
   - The reaper and the worker both measure from the latest claim, and a job gets up to
     three attempts. So a job whose worker keeps dying can spend up to three times its
     budget.
   - One rehearsal run had three attempts, of 18, 21 and 6 minutes.
   - For training, the monthly cap on `feat/vision-monthly-training-cap` counts every
     attempt. Other job types are still bounded only per attempt.
3. **The monthly GPU cap is not enforced.**
   - `VISION_MONTHLY_BUDGET_USD_CENTS` ($200) appears on `/vision/status`, and doc 12
     says the dispatcher refuses capacity past it. No code does.
   - The env example said it "caps new capacity". The cap branch corrects that.
4. **Run nothing on `::1` on this laptop.**
   - WSL's relay (`wslrelay.exe`) listens on `[::1]:5432` and `[::1]:9100`, alongside
     Docker's `0.0.0.0` and `[::]`. `[::1]` is the more specific address, so a client
     that tries IPv6 localhost first reaches the relay and is refused.
   - Prisma over `[::1]:5432` failed every time, in about 50 ms. Over `127.0.0.1` it
     worked every time.
   - Symptoms:
     - "Can't reach database server at `::1:5432`" on and off for hours;
     - an API that exits at start;
     - heartbeats answered with HTTP 500;
     - storage reads cut off part-way.
   - **Local `.env` files should name `127.0.0.1`**, not `localhost` or `[::1]`. That
     includes the labelling API's.
5. **The reaper cannot reap without its database.**
   - With the database link down, one run sat in `running` for six hours after its
     worker had gone.
   - A healthy API ended it as `budget_exceeded` at 22,085 s, and the cap counted it to
     that moment.
   - On a hosted provider the pod would have kept billing for those six hours.
   - The backstop was the worker itself: it shut down after two hours of failed claims.
     The control plane alone does not bound that.
6. **The base weights download at run time.**
   - torchvision fetches `fasterrcnn_resnet50_fpn_coco-258fb6c6.pth` (160 MB) from
     `download.pytorch.org` into `/tmp/dtp-vision/torch` on every fresh worker.
   - So a pod needs outbound internet, pays the download each time, and depends on a
     third-party host at the start of every run.
   - Baking the file into the GPU image, next to its pinned hash, removes all three.
7. **The cost cap works.**
   - A run given 1 cent was stopped as `budget_exceeded` 112 seconds in, on a mock
     worker that costs nothing. The job's own estimate is what stops it.
8. **Training on the laptop's CPU starves Docker.**
   - Docker has 4 CPUs and 3.9 GB here, and one CPU epoch took about 16 minutes using
     all four.
   - Capping the worker with `docker update --cpus 2` helped. Even so, do not train on
     the laptop while labellers are working: they share its Postgres.
9. **Rehearsal traps, not product bugs.**
   - The old GPU image runs its own baked-in worker (contract 1.21) unless the container
     starts with `-w /src`. Before that it never claimed `train`.
   - Detect has no time-window parameter, so the stand-in labels' detect scanned whole
     185 s clips.

The benchmark's gold-only scoring ([102](102-TRAIN-STAGE.md), PR #312) was found the
same way, by the step before this one.

## Still to rehearse

Train to success, register, detect with the trained weights, and benchmark. That needs
the upload fix above, a quiet laptop (no other session's containers, labelling not
live) and `127.0.0.1` throughout. The scratch database, worktree, containers and token
files stay until then, and are removed afterwards.

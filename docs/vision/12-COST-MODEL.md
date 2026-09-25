# 12 — Cost model

## The number that matters

> "A 96-minute Nigerian match takes **X minutes** to process and costs DTP **$Y** on the selected GPU."

Everything in this document exists to make that sentence true, measured, and repeatable. It is
the input to DTP's pricing, competition proposals, and investor planning — so it has to come from
instrumentation, not estimation.

---

## Cost per match — the formula

Recorded in `VisionJobCost` per job, rolled up per `SbMatch`:

```
match_cost_usd =
    Σ over jobs [ gpu_seconds × provider_rate_per_second(resource_class) ]
  + Σ over jobs [ cpu_seconds × provider_rate_per_second(cpu_class) ]
  + r2_storage_gb_month × r2_storage_rate
  + (class_a_ops × r2_class_a_rate) + (class_b_ops × r2_class_b_rate)
  + vlm_api_cost_usd
  + transcode_seconds × cpu_rate
```

Deliberately excluded: R2 **egress**, which is zero — the reason R2 was chosen over S3 for a
workload that reads the same proxy on every re-run.

Every term is measured, not modelled:

| Term | Source |
|---|---|
| `gpu_seconds`, `cpu_seconds` | Worker reports actual runtime on `complete` |
| `provider_rate_per_second` | `ComputeProvider.estimateCost`, from configured current rates |
| `bytes_read` / `bytes_written`, op counts | Worker instruments its own `ObjectStore` calls |
| `vlm_api_cost_usd` | Returned by the VLM adapter per call |
| Storage | Computed from asset and artifact sizes at month end |

The admin dashboard surfaces cost per match as a **trend**, because the interesting question is
not what one match cost but whether the number is going down as the pipeline matures.

---

## The existing AWS bill, and what Vision does to it

The constraint from the source documents is "keep the existing low-cost AWS arrangement". Here is
what is actually provisioned in `infra/terraform/`, with indicative `us-east-1` on-demand pricing —
**re-verify against the real AWS bill, this is derived from the Terraform, not from an invoice**.

| Resource | Spec | Indicative $/month |
|---|---|---|
| EC2 instance | `t3.small`, 2 vCPU / 2 GB, on-demand | ~15.20 |
| Root EBS volume | gp3, 20 GiB, encrypted | ~1.60 |
| Public IPv4 (Elastic IP) | one, attached | ~3.65 |
| CloudFront | `PriceClass_100`, in front of the EC2 origin | ~0 at current traffic (perpetual free tier: 1 TB out, 10M requests) |
| ACM certificate | `dtp.africa`, `www.dtp.africa` | 0 |
| VPC, subnet, IGW, route table | no NAT gateway | 0 |
| Secrets Manager | 2 secrets | ~0.80 |
| **Total** | | **~$21/month** |

Two things worth knowing about this footprint:

- **There is no NAT gateway.** That is the single most common way a small AWS account
  accidentally spends $35/month on nothing. This setup avoids it by putting the instance in a
  public subnet.
- **CloudFront already fronts the app** — the architecture diagrams in the source documents do not
  show it, but it exists and is doing real work (caching `/assets/*` for a year, passing `/api/*`
  through uncached).

### What the Vision Engine adds to AWS

**Nothing structural.** The control plane is a module inside the API container that already runs.
No new instance, no new load balancer, no NAT gateway, no S3.

The only AWS line that moves is **EBS**, and only when Vision metadata starts to accumulate:

| Change | When | Cost |
|---|---|---|
| Grow root volume 20 → 100 GiB | Before Phase 3 | +$6.40/month |
| Add 1–2 Secrets Manager secrets (R2, provider credentials) | Phase 0 | +$0.40–0.80/month |

So AWS goes from roughly **$21 to roughly $28/month**, and stays under $30.

### But the total infrastructure bill is no longer just AWS

This is the part worth being explicit about, because "keep AWS under $30" is preserved while total
spend is not:

| Provider | What it is for | Rough scale |
|---|---|---|
| **AWS** | Control plane — web, API, database | ~$28/month, flat |
| **Cloudflare R2** | The video corpus and all artifacts | Scales with matches acquired. At $0.015/GiB-month and ~6–10 GB per match: ~**$6/month at 50 matches**, ~**$60/month at 500**. Zero egress. |
| **RunPod** (+ Lambda fallback) | GPU and CPU workers | Scales with matches *processed*. Per-match cost measured in Spike S0 — until then, unknown, and deliberately not guessed here. |

R2 storage is the bill that only ever goes up, because masters are never deleted — they are the
corpus. That is a deliberate trade: it is the cheapest of the three lines and the only one that
buys a durable asset.

---

## GPU selection

The HANDOFF's benchmark table, preserved as **indicative only**. These are list prices from the
prior architecture recommendation and **must be re-verified before any procurement or budget
commitment** — GPU pricing moves constantly and by provider.

| GPU | VRAM | Indicative $/hr | Intended use |
|---|---|---|---|
| RTX A5000 | 24 GB | 0.27 | Development, early inference |
| L4 | 24 GB | 0.49 | Efficient video inference |
| RTX 3090 | 24 GB | 0.50 | Development, testing |
| **RTX A6000** | **48 GB** | **0.53** | **Primary starting benchmark candidate** |
| RTX 4090 | 24 GB | 0.74 | Fast CV inference |
| RTX 6000 Ada | 48 GB | 0.84 | Higher-performance production |
| L40S | 48 GB | 1.09 | Production AI/video |
| A100 | 80 GB | 1.59 | Larger training |
| H100 PCIe | 80 GB | 2.89 | Advanced training, later |

**Starting recommendation:** benchmark **A6000 48 GB** against **L4 24 GB** and **RTX 4090 24 GB**
in Spike S0. A6000 is the preferred baseline candidate because 48 GB leaves room for detection
plus tracking plus embeddings at larger image sizes with batching and multi-model experimentation,
without reaching A100/H100 pricing.

**Move to A100/H100 only when measurement shows** the extra performance either lowers total cost
per processed match or enables a workload the baseline cannot run efficiently. Not because a
training run feels slow.

Note that $/hr is the wrong unit for decisions. A GPU at twice the price that finishes in a third
of the time is cheaper per match. **Always compare cost per analyzed match.**

---

## Where the money actually goes

Expected cost drivers, in rough order, before optimisation:

1. **GPU seconds on detection.** Every frame, every object. The dominant term.
2. **Transcode.** Long, CPU-bound, and easy to accidentally run on expensive hardware.
3. **VLM calls.** Cheap per clip, ruinous per match if pointed at whole matches.
4. **R2 operations.** Negligible if artifacts are large Parquet files; significant if anything writes per-frame objects.
5. **R2 storage.** Grows forever. The master corpus is the one thing never deleted.

---

## Controls

| Control | Rule |
|---|---|
| **Transcode on CPU workers** | `transcode`, `clip`, and `fingerprint` request `cpu_small`, never a GPU class. Neither source document specified this, and getting it wrong means paying GPU rates for FFmpeg. |
| **Staged inference** | Cheap checks first (media validity, segment detection), then detection and tracking, then expensive VLM on *selected clips only*. Never run stage N+1 on footage stage N showed is not live play. |
| **Frame sampling policy** | Full-rate detection is not always required. Sampling rate is a per-job policy tied to what the output is for: a heatmap needs less than an event boundary. |
| **Proxy resolution policy** | The proxy is sized for reviewability and model input, not fidelity. Ball detection uses a tiled high-res path on selected windows rather than a high-res proxy throughout. |
| **Batch inference** | Batch frames to the GPU. A pipeline that feeds one frame at a time wastes most of what it is paying for. |
| **Automatic shutdown** | Workers drain the queue and die. `idleShutdownSeconds` is mandatory in `WorkerLaunchSpec`. The most common way to burn GPU budget is an idle pod nobody noticed. |
| **Per-job budgets** | `budgetSeconds` and `budgetUsdCents` are required fields. Breach cancels the job and tears down the instance. |
| **Caching** | Re-running events after a taxonomy change must not re-run detection. Stage artifacts are addressed by job and reused. |
| **Few large objects** | Parquet, not per-frame objects. See [05-STORAGE.md](./05-STORAGE.md#artifact-granularity--a-cost-and-performance-rule). |
| **Selective acquisition** | Catalog everything; acquire selectively. Storage and annotation cost scale with what is acquired, and a representative 50 matches beat an indiscriminate 500. |

---

## Storage cost trajectory

A rough shape to plan against, using indicative R2 pricing — re-verify before budgeting:

| Item | Per match (90 min) |
|---|---|
| Master original | 4–8 GB depending on source |
| Normalized proxy | ~1.5 GB |
| HLS + thumbnails | ~0.3 GB |
| Inference artifacts (Parquet) | 50–200 MB |
| Crops (review queue only) | 100–500 MB |
| Clips | 20–100 MB per published highlight |

So roughly **6–10 GB per match**, dominated by the master. Masters are never deleted — they are
the corpus. At 500 matches that is around 3–5 TB, which is a manageable monthly storage bill but
needs to be in the plan rather than discovered.

Derived artifacts are the compressible part: lifecycle expiry on failed attempts, stale crops, and
old exports keeps the derived bucket from growing without bound. See
[05-STORAGE.md](./05-STORAGE.md#lifecycle-and-retention).

---

## The cost audit

Run once per quarter, and after any pipeline change that touches a stage:

1. Profile one representative 90-minute match through ingestion and every enabled stage.
2. Report: R2 bytes read and written, operation counts, transcode CPU time, GPU model and runtime,
   GPU seconds, VLM API usage, wall-clock time, and total estimated cost.
3. Name the three largest cost drivers.
4. Implement safe reductions — proxy resolution, sampling, batching, staging, caching, shutdown policy.
5. Re-measure.

**Constraint: optimise cost per match without weakening a benchmark gate.** A cheaper pipeline
that quietly degrades ball recall on night footage has not saved money; it has moved the cost to
the review queue, where it is larger and harder to see.

---

## Budget guardrails

| Guardrail | Mechanism |
|---|---|
| Monthly GPU spend cap | Dispatcher refuses to launch new capacity past the configured cap; queued jobs wait and the dashboard alerts |
| Per-job cap | `budgetUsdCents`, enforced by the worker and the dispatcher |
| Training job cap | Separate, higher cap; training runs are explicitly approved |
| Runaway detection | Any job exceeding 3× its resource class's median runtime is flagged before it exceeds budget |
| Provider rate drift | Configured rates are re-verified monthly; a rate change beyond tolerance raises an alert rather than silently changing every cost figure |

The last one matters for honesty: if provider pricing changes and the configured rate does not,
every historical cost-per-match figure becomes quietly wrong, and the trend line — the thing
decisions are made on — becomes misleading.

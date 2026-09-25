# 21 — The compute providers, and what the second one revealed

Both hosted providers now exist, and a **shared conformance suite** all four pass.
The design's claim that GPU capacity is swappable is no longer a comment; it is a
test.

> **Not verified against the live services.** There are no provider credentials in
> this environment, so request and response mapping is verified against a stateful
> fake, not against RunPod or Lambda. Treat the adapters as unproven until one
> launches real capacity — the first thing Spike S0 will establish.

---

## The abstraction held, but not for free

`ComputeProvider` needed **no new methods and no new fields**, which is the result
worth having. But the two providers are not the same shape at all:

| | Container-native provider | VM-native provider |
|---|---|---|
| What you launch | a container: `imageName`, `env` | a machine: `instance_type_name`, `ssh_key_names`, `user_data` |
| Container concept | first-class | **none at all** |
| `WorkerLaunchSpec.image` | passed straight through | honoured via cloud-init: install Docker, pull, run |
| `env` | passed straight through | shell-quoted into a `docker run` |
| Access | not required | **an SSH key must already exist in the account** |
| Reaping a finished worker | the provider can terminate | **nothing reaps a VM whose container exited** |

**Two things had to give, and both were pushed into the adapter rather than the
contract:**

1. **The image is honoured through `user_data`.** The domain still says "run this
   image with this env at this resource class"; how that happens on a bare VM is
   the adapter's problem. That is the boundary working, not a workaround.
2. **An SSH key is a prerequisite one provider cannot invent.** It comes from
   configuration. Adding `sshKeyNames` to `WorkerLaunchSpec` would have put one
   vendor's requirement into every caller — the exact coupling the interface exists
   to prevent.

### The asymmetry that costs money

On the container provider, a finished pod can be terminated. On the VM provider
**nothing reaps an instance whose container has exited** — it keeps billing until
somebody notices. So the generated cloud-init ends in `poweroff`, and the dispatcher
terminates as well. Belt and braces, because a forgotten GPU VM is expensive and
silent.

This is the kind of difference that would have been discovered by an invoice.

---

## The conformance suite

`provider-conformance.spec.ts` runs the same assertions against every provider.
**Add a provider, add it to the table. If it needs the suite relaxed, the
abstraction has a hole and the hole is the finding.**

What every provider must do:

- carry a stable, lowercase id
- declare capabilities whose resource classes are all real members of the contract's enum
- return an **opaque** reference from `launch` — nothing outside an adapter may parse it
- report a status drawn only from the contract's vocabulary
- **terminate idempotently**, including for a reference it has never seen, so one stale row cannot wedge the reaper
- **never report a terminated worker as running**, or the dispatcher launches a replacement while believing the old one lives
- estimate cost monotonically, and say the rate was configured rather than quoted
- **need nothing from the launch spec beyond the contract** — asserted by pinning the spec's key set, so a vendor-specific field cannot be slipped in

---

## Three bugs the work surfaced

### 1. A fake that could not express the state under test

The first two conformance failures looked like adapter bugs. They were not: my HTTP
stub answered `running` unconditionally, so it could not honour *"never reports a
terminated worker as running"*. The mock and local providers passed because they are
genuinely stateful.

Fixing the fake rather than dropping the assertion was the right call. **A fake that
cannot express the transition under test is not testing anything.**

### 2. The composition root learned every vendor's name

Wiring the concrete providers in `vision.module.ts` worked perfectly well — and
quietly made the module the one place that knows every vendor. The boundary test
caught it, for the third time. `compute/provider-registry.factory.ts` now owns that
decision, beside the adapters where vendor names belong, and the module simply asks
for "the compute registry".

### 3. An unconfigured provider advertising capacity it could not deliver

Found by reading what the running API actually reported:

```
runpod   production=True   cpu_small, gpu_24gb, gpu_48gb, gpu_80gb   ← no API key configured
lambda   production=True   (none - unconfigured)                     ← correct
```

Machine-type defaults are baked in, so with no credential the container provider
still advertised all four classes — and the dispatcher would have selected it and
failed at launch. Exactly the failure the class filter existed to prevent.

Both providers now gate capabilities on credentials, and the conformance suite
asserts the **general** rule rather than the two specific cases, so the next adapter
cannot repeat it.

```
runpod   production=True   (none - unconfigured)
lambda   production=True   (none - unconfigured)
mock     production=False  cpu_small, gpu_24gb, gpu_48gb, gpu_80gb
local    production=False  cpu_small
```

Both are registered whether configured or not: an operator sees which credentials
are missing rather than the provider being absent.

---

## Configuration

Provider settings live in `compute/provider-config.ts`, **not** in the shared config
file — vendor names are permitted in an adapter and in configuration and nowhere
else, so `VISION_RUNPOD_*` in `config/vision.config.ts` would fail the boundary
test. An adapter owning its own configuration is the rule working.

All settings are in `infra/.env.example`. Leaving them blank is safe: an
unconfigured provider is never selected.

---

## Verification

```
api tests           355 passed  (was 319)
worker tests         21 passed
contract tests       22 passed
typecheck            clean, 6 projects
live /vision/status  both hosted providers correctly report themselves unconfigured
```

## What is still unproven

| | |
|---|---|
| **A real launch** | No credentials here, so neither adapter has spoken to its live API. Spike S0 is what settles it. |
| Automatic failover | Still deliberately manual: an operator switches provider by configuration. Automating it needs a provider health signal worth trusting, which DTP will not have on day one. |
| Cost accuracy | Rates are configured, not quoted. `fromConfiguredRate` says so on every estimate, and a stale rate makes the cost-per-match trend misleading — see [12-COST-MODEL](./12-COST-MODEL.md). |

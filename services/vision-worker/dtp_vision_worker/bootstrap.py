"""Provision a bootstrap token, then run the worker: the entry point for a worker
that lives beside the API rather than on a pod.

A hosted worker is handed its bootstrap token by the provider that launched it
(docs/vision/17). A worker in the same compose stack as the API has no
provider: it starts when the stack starts, and must ask the API for its own
token first. That is all this does -- `POST /vision/workers/provision` with the
provision key and the `local` provider, put the one-time token in the
environment, and hand over to the ordinary worker main. When the worker exits
(the queue drained for the idle period), the row is retired so the dashboard
does not count a worker that is gone, and the container's restart policy brings
a fresh one up.

The provision key is the only extra thing this worker holds. It is not the
operator key: the deploy derives it from the operator key, and the API lets it do
two things, provision and retire, for the `local` provider only
(docs/vision/67). The stages still run on a worker token, and the key never
reaches a stage: it is taken out of the process environment before the worker
runs, kept only in this function's frame for the retire call, so no child
process can inherit it (docs/vision/50, PR-1). A worker given `VISION_BOOTSTRAP_TOKEN` directly, the
hosted way, skips provisioning entirely.

    VISION_WORKER_CALLBACK_URL   e.g. http://api:3000/api/v1/vision/worker
    VISION_PROVISION_KEY         the provision key (x-vision-provision-key)
    VISION_RESOURCE_CLASS        e.g. cpu_small
    VISION_PROVIDER_ID           default local
    VISION_PROVISION_WAIT_SECONDS  how long to keep trying while the API comes up; default 600
"""

from __future__ import annotations

import logging
import os
import sys
import time

import httpx

log = logging.getLogger("dtp_vision_worker.bootstrap")

DEFAULT_WAIT_SECONDS = 600.0
PROVISION_KEY_HEADER = "x-vision-provision-key"
#: What this worker was given until docs/vision/67: the operator key itself.
RETIRED_KEY_VARIABLE = "VISION_PROVISION_API_KEY"
RETRY_SECONDS = 5.0


class BootstrapError(RuntimeError):
    pass


def admin_base(callback_url: str) -> str:
    """The admin API base the provision route lives under, from the worker callback URL."""
    url = callback_url.rstrip("/")
    marker = "/vision/worker"
    if not url.endswith(marker):
        raise BootstrapError(f"VISION_WORKER_CALLBACK_URL must end in {marker}; got {callback_url!r}")
    return url[: -len(marker)]


def provision(
    callback_url: str,
    api_key: str,
    resource_class: str,
    provider_id: str = "local",
    *,
    wait_seconds: float = DEFAULT_WAIT_SECONDS,
    transport: httpx.BaseTransport | None = None,
    sleep=time.sleep,
) -> dict:
    """Ask the API for a worker row and its one-time bootstrap token.

    Keeps trying while the API is unreachable or not yet answering, because in
    a compose stack the worker and the API start together; gives up after
    `wait_seconds`. A refusal the API makes on purpose (a 4xx) is not retried:
    a wrong key or an unknown provider will not fix itself.
    """
    base = admin_base(callback_url)
    deadline = time.monotonic() + wait_seconds
    attempt = 0
    with httpx.Client(base_url=base, timeout=httpx.Timeout(30.0), transport=transport) as client:
        while True:
            attempt += 1
            try:
                res = client.post(
                    "/vision/workers/provision",
                    headers={PROVISION_KEY_HEADER: api_key},
                    json={"resourceClass": resource_class, "providerId": provider_id},
                )
            except httpx.HTTPError as exc:
                if time.monotonic() >= deadline:
                    raise BootstrapError(f"the API at {base} did not answer within {wait_seconds:.0f}s: {exc}") from exc
                log.info("API not reachable yet (%s); retrying in %ss", exc.__class__.__name__, RETRY_SECONDS)
                sleep(RETRY_SECONDS)
                continue
            if res.status_code in (200, 201):
                body = res.json()
                if not isinstance(body.get("bootstrapToken"), str) or not isinstance(body.get("workerId"), str):
                    raise BootstrapError(f"provision answered without a token: {res.text[:200]}")
                log.info("provisioned worker %s via %s (attempt %s)", body["workerId"], provider_id, attempt)
                return body
            if 400 <= res.status_code < 500:
                raise BootstrapError(f"provision refused ({res.status_code}): {res.text[:300]}")
            if time.monotonic() >= deadline:
                raise BootstrapError(f"provision kept failing ({res.status_code}) for {wait_seconds:.0f}s: {res.text[:200]}")
            log.info("API answered %s; retrying in %ss", res.status_code, RETRY_SECONDS)
            sleep(RETRY_SECONDS)


def retire(callback_url: str, api_key: str, worker_id: str, *, transport: httpx.BaseTransport | None = None) -> bool:
    """Tell the API this worker is gone. Best effort: a failure here is logged, not raised."""
    base = admin_base(callback_url)
    try:
        with httpx.Client(base_url=base, timeout=httpx.Timeout(30.0), transport=transport) as client:
            res = client.post(f"/vision/workers/{worker_id}/retire", headers={PROVISION_KEY_HEADER: api_key})
            if res.status_code >= 400:
                log.warning("retire of worker %s answered %s", worker_id, res.status_code)
                return False
            return True
    except httpx.HTTPError as exc:
        log.warning("retire of worker %s failed: %s", worker_id, exc)
        return False


def main(env: dict[str, str] | None = None, run=None) -> int:
    """Provision if no bootstrap token is set, run the worker, retire on exit."""
    logging.basicConfig(level=os.environ.get("VISION_LOG_LEVEL", "INFO").upper(), format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}')
    env = os.environ if env is None else env
    if run is None:
        from .__main__ import main as run  # noqa: PLC0415 - the ordinary worker entry

    if env.get("VISION_BOOTSTRAP_TOKEN", "").strip():
        log.info("bootstrap token present; running the worker as provisioned by a provider")
        return run()

    callback = env.get("VISION_WORKER_CALLBACK_URL", "").strip()
    key = env.pop("VISION_PROVISION_KEY", "").strip()
    # The old variable held the operator key. It is not read, and it is not left in the
    # environment for a stage's child process to inherit either.
    if env.pop(RETIRED_KEY_VARIABLE, "").strip() and not key:
        log.error(
            "%s is no longer read: it held the operator key. Give the worker VISION_PROVISION_KEY, "
            "the provision-only key the deploy derives (docs/vision/67).",
            RETIRED_KEY_VARIABLE,
        )
        return 2
    resource_class = env.get("VISION_RESOURCE_CLASS", "").strip()
    provider_id = env.get("VISION_PROVIDER_ID", "local").strip() or "local"
    missing = [name for name, value in [("VISION_WORKER_CALLBACK_URL", callback), ("VISION_PROVISION_KEY", key), ("VISION_RESOURCE_CLASS", resource_class)] if not value]
    if missing:
        log.error("cannot provision: %s not set", ", ".join(missing))
        return 2
    try:
        # Empty is unset, as the API treats every key compose passes (#205): float("")
        # raised, exit 2, and the restart policy looped on it.
        wait = float(env.get("VISION_PROVISION_WAIT_SECONDS", "").strip() or DEFAULT_WAIT_SECONDS)
        minted = provision(callback, key, resource_class, provider_id, wait_seconds=wait)
    except (BootstrapError, ValueError) as exc:
        log.error("%s", exc)
        return 2

    env["VISION_BOOTSTRAP_TOKEN"] = minted["bootstrapToken"]
    try:
        return run()
    finally:
        retire(callback, key, minted["workerId"])


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())

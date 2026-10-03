# DTP Vision Engine worker — CPU stages.
#
# Deliberately CUDA-free: probe, fingerprint, transcode and clip are all
# CPU-bound, and running them on a GPU pod would mean paying GPU rates for
# FFmpeg. The GPU image (Dockerfile.gpu) does NOT build FROM this one -- a slim
# Debian Python has no route to a CUDA runtime -- so it starts from NVIDIA's
# runtime image and installs this same worker package. Both images therefore
# contain every stage; which ones a pod is given is decided by the CPU_STAGES /
# GPU_STAGES split in dtp_vision_worker/stages, and `detect` imports torch lazily
# so this image can still load the registry without it.
#
# Portability is a requirement, not a nicety: the same image must run on any
# provider or a local machine. Nothing here knows whose hardware it is on.
FROM python:3.12-slim-bookworm

# ffmpeg pulls the codecs; the licence position of the build is recorded in
# docs/licenses/OSS_REGISTER.md, because the build flags ARE the licence.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
COPY dtp_vision_worker ./dtp_vision_worker
RUN pip install --no-cache-dir .

# Model weights are NOT baked in. They are pulled from object storage by
# modelVersionId and checksum-verified, so the image is not a deployment unit for
# models — that is what the model registry is for.

# Unprivileged: a worker needs its work directory and outbound HTTPS, nothing else.
# /var/lib/dtp-vision is where the box mounts a named volume; Docker seeds a new volume's
# ownership from the image's directory, so it must exist and belong to the worker first.
RUN useradd --create-home --shell /usr/sbin/nologin worker \
 && mkdir -p /tmp/dtp-vision && chown -R worker:worker /tmp/dtp-vision \
 && mkdir -p /var/lib/dtp-vision && chown -R worker:worker /var/lib/dtp-vision
USER worker

ENV VISION_WORK_DIR=/tmp/dtp-vision \
    PYTHONUNBUFFERED=1

ENTRYPOINT ["dtp-vision-worker"]

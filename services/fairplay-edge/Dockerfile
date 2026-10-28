# DTP FairPlay Edge — the venue service beside MediaMTX.
#
# Runs ffprobe on recordings and nothing heavier: it never encodes or transcodes what
# MediaMTX records. ffmpeg itself is here for two things only: the synthetic test feeds
# (`fairplay-edge synth`, development only) and, from Phase 2, stream-copy clips.
#
# Base pinned by digest: python:3.12-slim is Debian 13 (trixie), whose ffmpeg is 7.1.x.
# The licence register's FFmpeg clearance names the Debian 12 build used by the Vision
# worker; this build is recorded in docs/fairplay/phase-1-edge-foundation.md and the
# extension of that clearance to the Edge is an open decision (docs/licenses/OSS_REGISTER.md).
FROM python:3.12-slim@sha256:dddfd7e07f9d15aeeca61529320492139d21cac7f0070c00609243e51e4e0016

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml constraints.txt ./
COPY fairplay_edge ./fairplay_edge
# Exact versions from constraints.txt, so a rebuild installs what was tested.
RUN pip install --no-cache-dir -c constraints.txt .

# Unprivileged, with a fixed uid: MediaMTX runs as the same uid (compose.yaml) so both can
# read and write the recordings volume, which Docker seeds from these directories.
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin edge \
 && mkdir -p /var/lib/fairplay/recordings /var/lib/fairplay/data /etc/mediamtx /etc/fairplay \
 && chown -R edge:edge /var/lib/fairplay /etc/mediamtx
USER edge

ENV PYTHONUNBUFFERED=1 \
    FAIRPLAY_IN_CONTAINER=1 \
    FAIRPLAY_DATA_DIR=/var/lib/fairplay/data \
    FAIRPLAY_RECORDINGS_DIR=/var/lib/fairplay/recordings \
    FAIRPLAY_SOURCES_FILE=/etc/fairplay/sources.toml

ENTRYPOINT ["fairplay-edge"]

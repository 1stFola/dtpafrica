# Third-party notices: DTP FairPlay Edge

What the Edge is made of, and each part's licence, as read on 31 October 2026 from the Edge image,
MediaMTX's image at its pinned digest and the console's bundle.
[docs/fairplay/licences.md](../../docs/fairplay/licences.md) has how they were read and the FFmpeg
build review. `tests/test_licences.py` holds this file to `fairplay_edge/licences_reviewed.py`.

This lists; it clears nothing. Whether a part is cleared is in
[the licence register](../../docs/licenses/OSS_REGISTER.md). It is an engineering record, not legal advice.

**Full licence texts.** `deploy/licences.sh <folder>` writes every text the installed image holds:
each Python package's and each Debian package's, and MediaMTX's own. The console's are in
`apps/fairplay-console/public/third-party-notices.txt`, which the Edge serves at
`/third-party-notices.txt`. The texts of MediaMTX's modules are **not** in its image, so a copy of the
stack that left DTP would need them collected first.

## FFmpeg and ffprobe

FFmpeg 7.1.5, Debian 13's package `7:7.1.5-0+deb13u1`, is built with `--enable-gpl` and reports
GPL-2.0-or-later. It is copyright the FFmpeg developers; the build links libx264, libx265, libxvid
and others. Its source is Debian's source package of that version. Run `ffmpeg -L` for the build's own
statement, and see `/usr/share/doc/ffmpeg/copyright` in the image.

## The base image

`python:3.12-slim`, pinned by digest: Python 3.12.15 (PSF-2.0), SQLite 3.46.1 (public domain) and
Debian 13.7, with the packages FFmpeg brings, 292 in all. Each package's licence is in its
`/usr/share/doc/<package>/copyright`, and the list is in `deploy/licences.sh`'s `inventory.json`.
None comes from Debian's `contrib` or `non-free`, and no copyright file names AGPL as a licence.

DejaVu fonts (`fonts-dejavu-core` 2.37-8, Bitstream Vera licence) are in the image. Only the
synthetic test feeds use them.

## Python packages in the image

| Package | Version | Licence |
|---|---|---|
| annotated-doc | 0.0.5 | MIT |
| annotated-types | 0.8.0 | MIT |
| anyio | 4.15.1 | MIT |
| certifi | 2026.10.23 | MPL-2.0 |
| cffi | 2.1.1 | MIT-0 |
| click | 8.5.0 | BSD-3-Clause |
| cryptography | 50.0.2 | Apache-2.0 OR BSD-3-Clause |
| fastapi | 0.162.0 | MIT |
| h11 | 0.16.0 | MIT |
| httpcore | 1.0.9 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| idna | 3.20 | BSD-3-Clause |
| opentelemetry-api | 1.45.1 | Apache-2.0 |
| pip | 25.0.1 | MIT |
| pycparser | 3.12 | BSD-3-Clause |
| pydantic | 2.14.1 | MIT |
| pydantic-core | 2.50.1 | MIT |
| starlette | 1.10.0 | BSD-3-Clause |
| typing-extensions | 4.16.0 | PSF-2.0 |
| typing-inspection | 0.4.4 | MIT |
| uvicorn | 0.54.0 | BSD-3-Clause |

`cryptography`'s wheel bundles OpenSSL (Apache-2.0).

## The console's JavaScript

| Package | Version | Licence |
|---|---|---|
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| scheduler | 0.23.2 | MIT |

The console's own code and `@dtp/ui` are DTP's.

## MediaMTX

MediaMTX 1.21.3, MIT, copyright (c) 2019 aler9. Run from the published image
`bluenviron/mediamtx:1.21.3@sha256:59e43552f3be43695b70c19424dc2a42fcec18075f88d91561a24ac5d70a586c`, unmodified. Its binary is built from these
modules, listed in the binary itself. Their licences were read at these versions, except that
`github.com/ugorji/go/codec` was read at its tag `codec/v1.3.1`.

`github.com/benburkert/openpgp` **has no licence file.** Its source headers say "BSD-style license"
and point to a LICENSE file its repository does not have. It is a fork of `golang.org/x/crypto/openpgp`.
See the register.

| Module | Version | Licence |
|---|---|---|
| aead.dev/minisign | v0.2.0 | MIT |
| code.cloudfoundry.org/bytefmt | v0.95.0 | Apache-2.0 |
| dario.cat/mergo | v1.0.0 | BSD-3-Clause |
| github.com/Masterminds/semver/v3 | v3.5.0 | MIT |
| github.com/MicahParks/jwkset | v0.11.3 | Apache-2.0 |
| github.com/MicahParks/keyfunc/v3 | v3.8.2 | Apache-2.0 |
| github.com/ProtonMail/go-crypto | v1.1.6 | BSD-3-Clause |
| github.com/abema/go-mp4 | v1.7.3 | MIT |
| github.com/alecthomas/kong | v1.16.1 | MIT |
| github.com/asticode/go-astikit | v0.30.0 | MIT |
| github.com/asticode/go-astits | v1.16.0 | MIT |
| github.com/benburkert/openpgp | v0.0.0-20160410205803-c2471f86866c | NO LICENCE FILE |
| github.com/bluenviron/gohlslib/v2 | v2.4.7 | MIT |
| github.com/bluenviron/gortmplib | v1.0.5 | MIT |
| github.com/bluenviron/gortsplib/v5 | v5.6.7 | MIT |
| github.com/bluenviron/mediacommon/v2 | v2.9.7 | MIT |
| github.com/cloudflare/circl | v1.6.3 | BSD-3-Clause |
| github.com/cyphar/filepath-securejoin | v0.6.1 | BSD-3-Clause AND MPL-2.0 |
| github.com/datarhei/gosrt | v0.12.0 | MIT |
| github.com/dunglas/httpsfv | v1.1.1 | BSD-3-Clause |
| github.com/emirpasic/gods | v1.18.1 | BSD-2-Clause |
| github.com/fsnotify/fsnotify | v1.10.1 | BSD-3-Clause |
| github.com/gabriel-vasile/mimetype | v1.4.13 | MIT |
| github.com/gin-contrib/pprof | v1.5.6 | MIT |
| github.com/gin-contrib/sse | v1.1.1 | MIT |
| github.com/gin-gonic/gin | v1.12.0 | MIT |
| github.com/go-git/gcfg | v1.5.1-0.20230307220236-3a3c6141e376 | BSD-3-Clause |
| github.com/go-git/go-billy/v5 | v5.9.2 | Apache-2.0 |
| github.com/go-git/go-git/v5 | v5.19.3 | Apache-2.0 |
| github.com/go-playground/locales | v0.14.1 | MIT |
| github.com/go-playground/universal-translator | v0.18.1 | MIT |
| github.com/go-playground/validator/v10 | v10.30.3 | MIT |
| github.com/goccy/go-yaml | v1.19.2 | MIT |
| github.com/golang-jwt/jwt/v5 | v5.3.1 | MIT |
| github.com/golang/groupcache | v0.0.0-20241129210726-2c02b8208cf8 | Apache-2.0 |
| github.com/google/gopacket | v1.1.19 | BSD-3-Clause |
| github.com/google/uuid | v1.6.0 | BSD-3-Clause |
| github.com/gookit/color | v1.6.3 | MIT |
| github.com/gorilla/websocket | v1.5.3 | BSD-2-Clause |
| github.com/jbenet/go-context | v0.0.0-20150711004518-d14ea06fba99 | MIT |
| github.com/kballard/go-shellquote | v0.0.0-20180428030007-95032a82bc51 | MIT |
| github.com/kevinburke/ssh_config | v1.2.0 | MIT |
| github.com/leodido/go-urn | v1.4.0 | MIT |
| github.com/matthewhartstonge/argon2 | v1.6.4 | Apache-2.0 |
| github.com/mattn/go-isatty | v0.0.23 | MIT |
| github.com/minio/selfupdate | v0.6.0 | Apache-2.0 |
| github.com/pelletier/go-toml/v2 | v2.4.3 | MIT |
| github.com/pion/datachannel | v1.6.3 | MIT |
| github.com/pion/dtls/v3 | v3.1.13 | MIT |
| github.com/pion/ice/v4 | v4.4.8 | MIT |
| github.com/pion/interceptor | v0.1.49 | MIT |
| github.com/pion/logging | v0.2.4 | MIT |
| github.com/pion/mdns/v2 | v2.2.2 | MIT |
| github.com/pion/randutil | v0.1.0 | MIT |
| github.com/pion/rtcp | v1.2.19 | MIT |
| github.com/pion/rtp | v1.10.5 | MIT |
| github.com/pion/sctp | v1.12.0 | MIT |
| github.com/pion/sdp/v3 | v3.0.20 | MIT |
| github.com/pion/srtp/v3 | v3.1.3 | MIT |
| github.com/pion/stun/v4 | v4.0.1 | MIT |
| github.com/pion/transport/v5 | v5.1.1 | MIT |
| github.com/pion/turn/v5 | v5.1.2 | MIT |
| github.com/pion/webrtc/v4 | v4.2.24 | MIT |
| github.com/pires/go-proxyproto | v0.16.0 | Apache-2.0 |
| github.com/pjbgf/sha1cd | v0.7.0 | Apache-2.0 |
| github.com/quic-go/qpack | v0.6.0 | MIT |
| github.com/quic-go/quic-go | v0.64.1 | MIT |
| github.com/quic-go/webtransport-go | v0.13.0 | MIT |
| github.com/sergi/go-diff | v1.3.2-0.20230802210424-5b0b94c5c0d3 | MIT |
| github.com/skeema/knownhosts | v1.3.1 | Apache-2.0 |
| github.com/ugorji/go/codec | v1.3.1 | MIT |
| github.com/wlynxg/anet | v0.0.5 | BSD-3-Clause |
| github.com/xanzy/ssh-agent | v0.3.3 | Apache-2.0 |
| github.com/xo/terminfo | v0.0.0-20220910002029-abceb7e1c41e | MIT |
| go.mongodb.org/mongo-driver/v2 | v2.8.0 | Apache-2.0 |
| golang.org/x/crypto | v0.58.0 | BSD-3-Clause |
| golang.org/x/net | v0.61.0 | BSD-3-Clause |
| golang.org/x/sync | v0.24.0 | BSD-3-Clause |
| golang.org/x/sys | v0.49.0 | BSD-3-Clause |
| golang.org/x/term | v0.47.0 | BSD-3-Clause |
| golang.org/x/text | v0.43.0 | BSD-3-Clause |
| golang.org/x/time | v0.15.0 | BSD-3-Clause |
| google.golang.org/protobuf | v1.36.11 | BSD-3-Clause |
| gopkg.in/warnings.v0 | v0.1.2 | BSD-2-Clause |

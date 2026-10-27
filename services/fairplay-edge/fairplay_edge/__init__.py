"""DTP FairPlay Edge.

The venue-side service beside MediaMTX: it indexes what MediaMTX records, hashes every
finalised segment into a durable manifest, watches source and disk health, and serves a
protected local API. It never encodes, transcodes or uploads video. See
docs/fairplay/architecture.md and docs/fairplay/phase-1-edge-foundation.md.
"""

__version__ = "0.1.0"

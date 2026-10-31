"""Writes the vectors the cloud's tests check its TypeScript against (services/api/src/fairplay/
edge-vectors.json), so the two sides of a hash or a signature are the same bytes:

  canonical   the Edge's canonical JSON for awkward values
  audit       real outbox payloads of real audit entries, with the hash the Edge computed
  pin         a PIN hashed with a fixed salt
  bundle      a bundle signed with a key made from a fixed, public seed, and its content hash

The key here is a TEST VECTOR made from bytes 0..31. It signs nothing anywhere else.

    python -I fixtures/cloud_vectors.py > ../api/src/fairplay/edge-vectors.json   (in the Edge image)
"""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat  # noqa: E402

from fairplay_edge import audit  # noqa: E402
from fairplay_edge.auth import b64, canonical, hash_pin, key_id  # noqa: E402
from fairplay_edge.cloud import content_hash  # noqa: E402
from fairplay_edge.store import Store  # noqa: E402

SAMPLES = [
    {"b": 1, "a": [True, False, None], "A": "upper", "_": "underscore", "z9": -42},
    {"text": "Ẹ̀ṣọ́ — naïve “quotes” \\ back\\slash \"dq\" / slash"},
    {"ctl": "tab\tnl\ncr\rbs\bff\fnul\u0000unit\u001fdel\u007f"},
    {"emoji": "⚽🟥 offside? 🤔", "sep": "  "},
    {"nested": {"y": {"b": [1, {"d": 2, "c": 3}]}, "x": []}, "empty": {}},
    {"big": 9007199254740991, "neg": -9007199254740991, "zero": 0},
]


def main() -> None:
    out = {"canonical": [{"value": v, "python": canonical(v).decode()} for v in SAMPLES]}

    with tempfile.TemporaryDirectory() as tmp:
        store = Store(Path(tmp) / "edge.sqlite3")
        op = audit.Actor("u-1", "Adé Operator", "operator")
        with store.tx() as db:
            audit.append(db, op, "incident.created", "incident", "i-1", 1, {"category": "foul", "minute": 23})
            audit.append(db, op, "evidence.created", "evidence", "e-1", 1,
                         {"coverage": 1.0, "fps": 25.0, "note": "ratio 0.5", "names": ["Ọlá"]})
            audit.append(db, audit.Actor.system(), "outbox.parked", "session", None, None, {})
        rows = store.query("SELECT payload, payload_hash FROM outbox WHERE entity_type = 'audit' ORDER BY seq")
        out["audit"] = {"deviceId": store.device_id, "payloads": [json.loads(r["payload"]) for r in rows]}

    out["pin"] = {"pin": "48291375", "saltHex": bytes(range(16)).hex(), "hash": hash_pin("48291375", bytes(range(16)))}

    seed = bytes(range(32))
    key = Ed25519PrivateKey.from_private_bytes(seed)
    public = b64(key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw))
    bundle = {"schema": "fairplay.credential-bundle/v1", "issuer": "dtp-cloud", "bundleId": "b-1",
              "issuedAt": "2026-10-28T09:00:00Z", "expiresAt": "2026-10-29T21:00:00Z",
              "session": {"id": "s-1", "label": "Lions v Eagles", "matchId": None, "mode": "shadow"},
              "members": [{"userId": "u-1", "email": "ade@example.org", "name": "Adé", "pinHash": out["pin"]["hash"],
                           "permissions": ["fairplay.incident.operate", "fairplay.incident.review"]}]}
    out["bundle"] = {"seedHex": seed.hex(), "publicKey": public, "keyId": key_id(public), "bundle": bundle,
                     "signature": b64(key.sign(canonical(bundle))), "contentHash": content_hash(bundle)}
    json.dump(out, sys.stdout, indent=2, ensure_ascii=False, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

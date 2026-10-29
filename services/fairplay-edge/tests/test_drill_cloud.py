"""The drills' stand-in cloud (fixtures/drill_cloud.py, TEST ONLY) answers as the real sync endpoint does."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("drill_cloud", Path(__file__).parents[1] / "fixtures" / "drill_cloud.py")
drill_cloud = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drill_cloud)


def test_a_record_is_applied_once_then_replayed_and_a_changed_one_conflicts():
    seen = {}
    first = drill_cloud.results_for([{"idempotencyKey": "k1", "payloadHash": "a"},
                                     {"idempotencyKey": "k2", "payloadHash": "b"}], seen)
    assert [r["status"] for r in first] == ["applied", "applied"]
    again = drill_cloud.results_for([{"idempotencyKey": "k1", "payloadHash": "a"},
                                     {"idempotencyKey": "k2", "payloadHash": "changed"}], seen)
    assert [r["status"] for r in again] == ["replayed", "conflict"]
    assert seen == {"k1": "a", "k2": "b"}

from dtp_vision_worker.evidence import same_evidence


def test_numbers_match_to_the_last_digits_and_nothing_else_is_loosened():
    assert same_evidence(0.014107883817427386, 0.01410788381742739)
    assert same_evidence({"a": 1, "b": [0.1 + 0.2]}, {"b": [0.3], "a": 1})
    assert not same_evidence(0.3, 0.3001)
    assert not same_evidence(1, 1 + 1e-9)
    assert not same_evidence(True, 1) and not same_evidence(0, False)
    assert not same_evidence({"a": 1}, {"a": 1, "b": None})
    assert not same_evidence([1, 2], [2, 1])
    assert not same_evidence(None, 0) and not same_evidence("1", 1)
    assert not same_evidence(float("nan"), float("nan"))

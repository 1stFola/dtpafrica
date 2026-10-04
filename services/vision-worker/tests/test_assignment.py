"""The assignment against brute force.

`hungarian` is trusted by the tracker and by MOTA, in exactly the case where it
was wrong: some pairs forbidden. The answer is defined here by exhaustion -- the
most allowed pairs, and among those the cheapest -- and the algorithm is held to
it over thousands of small random matrices.
"""

from __future__ import annotations

import itertools
import random

import pytest

from dtp_vision_worker.assignment import INF, hungarian


def brute_force(cost: list[list[float]]) -> tuple[int, float]:
    """(pairs, total) of the best assignment: most allowed pairs first, then cheapest."""
    n = len(cost)
    m = len(cost[0]) if n else 0
    best = (0, 0.0)
    rows, cols = (range(n), range(m))
    small, large, by_row = (rows, cols, True) if n <= m else (cols, rows, False)
    for perm in itertools.permutations(large, len(small)):
        count = 0
        total = 0.0
        for a, b in zip(small, perm, strict=True):
            c = cost[a][b] if by_row else cost[b][a]
            if c != INF:
                count += 1
                total += c
        if count > best[0] or (count == best[0] and total < best[1] - 1e-12):
            best = (count, total)
    return best


def scored(cost: list[list[float]], pairs: list[tuple[int, int]]) -> tuple[int, float]:
    return len(pairs), sum(cost[r][c] for r, c in pairs)


def test_the_case_the_audit_found() -> None:
    # Both tracks may only take the second box. The cheaper pairing is track 1's; 1e18 for
    # the forbidden pairs used to round the difference away and hand the box to track 0.
    assert hungarian([[INF, 0.268], [INF, 0.255]]) == [(1, 1)]


def test_a_forbidden_pair_is_never_returned_and_never_counted() -> None:
    assert hungarian([[INF, INF], [INF, INF]]) == []
    assert hungarian([[INF]]) == []
    assert hungarian([[0.4, INF], [INF, INF]]) == [(0, 0)]


def test_more_allowed_pairs_beats_a_cheaper_single_pair() -> None:
    # Taking (0,0) at 0.01 leaves row 1 with nothing; (0,1)+(1,0) pairs both.
    assert hungarian([[0.01, 0.9], [0.9, INF]]) == [(0, 1), (1, 0)]


@pytest.mark.parametrize("forbidden_share", [0.0, 0.3, 0.6, 0.9])
def test_it_agrees_with_brute_force_on_random_matrices(forbidden_share: float) -> None:
    rng = random.Random(20261003 + int(forbidden_share * 10))
    for _ in range(1500):
        n, m = rng.randint(1, 5), rng.randint(1, 5)
        cost = [[INF if rng.random() < forbidden_share else round(rng.random(), 3) for _ in range(m)] for _ in range(n)]
        pairs = hungarian(cost)
        # One-to-one, and nothing forbidden.
        assert len({r for r, _ in pairs}) == len(pairs) == len({c for _, c in pairs})
        assert all(cost[r][c] != INF for r, c in pairs)
        got = scored(cost, pairs)
        want = brute_force(cost)
        assert got[0] == want[0], cost
        assert got[1] == pytest.approx(want[1], abs=1e-9), cost


def test_it_agrees_with_brute_force_when_costs_are_negative_as_idf1_uses_them() -> None:
    rng = random.Random(7)
    for _ in range(500):
        n, m = rng.randint(1, 5), rng.randint(1, 5)
        cost = [[float(-rng.randint(0, 40)) for _ in range(m)] for _ in range(n)]
        got = scored(cost, hungarian(cost))
        want = brute_force(cost)
        assert got[1] == pytest.approx(want[1]), cost


def test_overlaps_close_together_are_still_told_apart_at_tracker_scale() -> None:
    # Thirty tracks, thirty boxes, costs differing in the fourth decimal, half the pairs forbidden.
    rng = random.Random(11)
    n = 30
    cost = [[INF if (r + c) % 2 else 0.5 + rng.random() * 1e-3 for c in range(n)] for r in range(n)]
    pairs = hungarian(cost)
    assert len(pairs) == n
    total = sum(cost[r][c] for r, c in pairs)
    # No single swap of two pairs improves it: the least a wrong answer would fail.
    for (r1, c1), (r2, c2) in itertools.combinations(pairs, 2):
        if cost[r1][c2] != INF and cost[r2][c1] != INF:
            assert cost[r1][c2] + cost[r2][c1] >= cost[r1][c1] + cost[r2][c2] - 1e-12
    assert total < n * 0.501

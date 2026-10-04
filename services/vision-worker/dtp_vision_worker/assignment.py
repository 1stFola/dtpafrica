"""Optimal assignment, dependency-free.

The Hungarian (Kuhn-Munkres) algorithm on a rectangular cost matrix, O(n^3). Used
wherever two sets have to be paired one-to-one -- predictions with truths in a
frame, predicted track ids with gold track ids for IDF1 -- because greedy pairing
is wrong exactly when it matters: two candidates both good for two tracks, where
taking the best pair first can cost the second. A page of code, so no library.
"""

from __future__ import annotations

from collections.abc import Sequence

INF = float("inf")


def hungarian(cost: Sequence[Sequence[float]]) -> list[tuple[int, int]]:
    """Minimum-cost one-to-one assignment of rows to columns.

    Returns `(row, column)` pairs; every row and column appears at most once, and
    rows beyond the number of columns (or the reverse) are left unassigned. A cost
    of `inf` means the pair is forbidden; such pairs are never returned.

    With forbidden pairs the answer is the one with the most allowed pairs, and
    among those the cheapest. A forbidden pair is given a finite cost larger than
    any sum of allowed ones, so one more forbidden pair always costs more than any
    rearrangement of allowed pairs can save. It used to be 1e18, and against that
    the potentials grew until costs between 0 and 1 rounded away: the result was
    an assignment, and not the cheapest (docs/vision/50, appendix C).
    """
    n = len(cost)
    if n == 0:
        return []
    m = len(cost[0])
    if m == 0:
        return []
    finite = [abs(c) for row in cost for c in row if c != INF]
    forbidden = 1.0 + sum(finite)
    transpose = n > m
    if transpose:
        cost = [[cost[r][c] for r in range(n)] for c in range(m)]
        n, m = m, n

    # Potentials-based implementation (e-maxx), rows 1..n, columns 1..m.
    u = [0.0] * (n + 1)
    v = [0.0] * (m + 1)
    p = [0] * (m + 1)  # p[j] = row assigned to column j
    way = [0] * (m + 1)
    # Above any path cost the search can see: at most n pairs, each at most `forbidden`.
    big = (n + 1) * forbidden * 2.0 + 1.0
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv = [big] * (m + 1)
        used = [False] * (m + 1)
        while True:
            used[j0] = True
            i0 = p[j0]
            delta = big
            j1 = 0
            for j in range(1, m + 1):
                if used[j]:
                    continue
                c = cost[i0 - 1][j - 1]
                cur = (forbidden if c == INF else c) - u[i0] - v[j]
                if cur < minv[j]:
                    minv[j] = cur
                    way[j] = j0
                if minv[j] < delta:
                    delta = minv[j]
                    j1 = j
            for j in range(m + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break

    pairs: list[tuple[int, int]] = []
    for j in range(1, m + 1):
        if p[j] and cost[p[j] - 1][j - 1] != INF:
            pairs.append((p[j] - 1, j - 1))
    if transpose:
        pairs = [(c, r) for r, c in pairs]
    pairs.sort()
    return pairs

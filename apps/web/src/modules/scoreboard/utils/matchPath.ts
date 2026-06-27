const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isMatchUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function matchCenterPath(match: { slug?: string | null; id: string }): string {
  return `/scoreboard/match/${match.slug ?? match.id}`;
}

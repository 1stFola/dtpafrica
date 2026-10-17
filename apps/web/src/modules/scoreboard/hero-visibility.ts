/**
 * Where the ScoreBoard hero (the "Score board" banner over the players photo) shows.
 *
 * Fola's rule: the banner belongs to the Overview and Competitions tabs only. Opening a
 * fixture from Overview, or a competition from Competitions, closes it so the content
 * starts at the top, and Highlights and Live Games never show it. So the hero is shown
 * on exactly two routes -- the hub and the competitions browser -- and folds away on
 * every other ScoreBoard page.
 */
export function heroShownFor(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/scoreboard" || path === "/scoreboard/browse";
}

/** MM:SS with seconds 00–59 (e.g. 3:45, 12:05). */
export const HIGHLIGHT_DURATION_REGEX = /^\d{1,2}:[0-5]\d$/;

export function assertHighlightDuration(duration: string): void {
  if (!HIGHLIGHT_DURATION_REGEX.test(duration.trim())) {
    throw new Error("Duration must be MM:SS (e.g. 03:45)");
  }
}

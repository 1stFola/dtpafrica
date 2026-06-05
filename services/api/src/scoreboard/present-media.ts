import {
  detectVideoMediaType,
  highlightThumbnailUrl,
  type VideoMediaType,
  videoEmbedUrl,
} from "../shared/media-url";

export type PresentedHighlight = {
  id: string;
  title: string;
  youtubeUrl: string;
  mediaType: VideoMediaType;
  videoEmbedUrl: string | null;
  thumbnailUrl: string | null;
  duration?: string | null;
  publishedAt: string | Date;
  [key: string]: unknown;
};

export function presentHighlight<T extends { youtubeUrl: string }>(
  row: T,
  explicitThumb?: string | null
): T & {
  mediaType: VideoMediaType;
  videoEmbedUrl: string | null;
  thumbnailUrl: string | null;
} {
  const mediaType = detectVideoMediaType(row.youtubeUrl);
  return {
    ...row,
    mediaType,
    videoEmbedUrl: videoEmbedUrl(row.youtubeUrl, mediaType),
    thumbnailUrl: highlightThumbnailUrl(row.youtubeUrl, explicitThumb),
  };
}

export function parseMatchPhotosFromMeta(meta: unknown): Array<{ url: string; caption: string | null }> {
  if (!meta || typeof meta !== "object" || !("photos" in meta)) return [];
  const photos = (meta as { photos?: unknown }).photos;
  if (!Array.isArray(photos)) return [];
  return photos.flatMap((item) => {
    if (!item || typeof item !== "object" || !("url" in item)) return [];
    const url = (item as { url?: unknown }).url;
    if (typeof url !== "string" || !url.trim()) return [];
    const caption = (item as { caption?: unknown }).caption;
    return [{ url: url.trim(), caption: typeof caption === "string" ? caption : null }];
  });
}

export function presentMatchDetail<
  T extends {
    meta?: unknown;
    highlights?: Array<{ youtubeUrl: string }>;
    events?: Array<{ highlights?: Array<{ youtubeUrl: string }> }>;
  },
>(match: T): T & { photos: Array<{ url: string; caption: string | null }> } {
  const photos = parseMatchPhotosFromMeta(match.meta);
  const highlights = Array.isArray(match.highlights)
    ? match.highlights.map((h) => presentHighlight(h))
    : match.highlights;
  const events = Array.isArray(match.events)
    ? match.events.map((ev) => ({
        ...ev,
        highlights: Array.isArray(ev.highlights)
          ? ev.highlights.map((h) => presentHighlight(h))
          : ev.highlights,
      }))
    : match.events;
  return { ...match, photos, highlights, events } as T & {
    photos: Array<{ url: string; caption: string | null }>;
  };
}

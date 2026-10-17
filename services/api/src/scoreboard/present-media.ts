import {
  detectVideoMediaType,
  highlightThumbnailUrl,
  type VideoMediaType,
  videoEmbedUrl,
  youtubeThumbnail,
  youtubeVideoId,
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

export type HighlightKind = "video" | "photo";

export function presentHighlight<T extends { youtubeUrl: string; mediaType?: string | null }>(
  row: T,
  explicitThumb?: string | null
): T & {
  highlightKind: HighlightKind;
  mediaType: VideoMediaType | "photo";
  videoEmbedUrl: string | null;
  thumbnailUrl: string | null;
} {
  if (row.mediaType === "photo") {
    return {
      ...row,
      highlightKind: "photo",
      mediaType: "photo",
      videoEmbedUrl: null,
      thumbnailUrl: row.youtubeUrl,
    };
  }

  const mediaType = detectVideoMediaType(row.youtubeUrl);
  return {
    ...row,
    highlightKind: "video",
    mediaType,
    videoEmbedUrl: videoEmbedUrl(row.youtubeUrl, mediaType),
    thumbnailUrl: highlightThumbnailUrl(row.youtubeUrl, explicitThumb),
  };
}

/**
 * A live stream as the Live Games page plays it: the YouTube id behind whatever link the
 * admin pasted, the embed URL for the player, and a poster for the moment before it loads.
 */
export function presentLiveStream<T extends { youtubeUrl: string }>(
  row: T
): T & { videoId: string | null; embedUrl: string | null; thumbnailUrl: string | null } {
  const videoId = youtubeVideoId(row.youtubeUrl);
  return {
    ...row,
    videoId,
    embedUrl: videoId ? videoEmbedUrl(row.youtubeUrl, "youtube") : null,
    thumbnailUrl: youtubeThumbnail(row.youtubeUrl),
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
    highlights?: Array<{ youtubeUrl: string; title?: string; mediaType?: string | null }>;
    events?: Array<{ highlights?: Array<{ youtubeUrl: string; mediaType?: string | null }> }>;
  },
>(match: T): T & { photos: Array<{ url: string; caption: string | null }> } {
  const metaPhotos = parseMatchPhotosFromMeta(match.meta);
  const presentedHighlights = Array.isArray(match.highlights)
    ? match.highlights.map((h) => presentHighlight(h))
    : [];
  const photoHighlights = presentedHighlights
    .filter((h) => h.highlightKind === "photo")
    .map((h) => ({
      url: h.youtubeUrl,
      caption: typeof h.title === "string" ? h.title : null,
    }));
  const photos = [...metaPhotos, ...photoHighlights];
  const highlights = presentedHighlights.filter((h) => h.highlightKind === "video");
  const events = Array.isArray(match.events)
    ? match.events.map((ev) => ({
        ...ev,
        highlights: Array.isArray(ev.highlights)
          ? ev.highlights
              .map((h) => presentHighlight(h))
              .filter((h) => h.highlightKind === "video")
          : ev.highlights,
      }))
    : match.events;
  return { ...match, photos, highlights, events } as T & {
    photos: Array<{ url: string; caption: string | null }>;
  };
}

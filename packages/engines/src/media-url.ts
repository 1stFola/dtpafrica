export type VideoMediaType = "youtube" | "google_drive" | "external";

export type VideoMediaInfo = {
  mediaType: VideoMediaType;
  sourceUrl: string;
  embedUrl: string | null;
  thumbnailUrl: string | null;
};

const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

/** Extract a Google Drive file id from common share URL shapes. */
export function parseGoogleDriveFileId(url: string): string | null {
  if (!url?.trim()) return null;
  try {
    const u = new URL(url.trim());
    if (!DRIVE_HOSTS.has(u.hostname.replace(/^www\./, ""))) return null;
    const filePath = u.pathname.match(/\/file\/d\/([^/]+)/);
    if (filePath?.[1]) return filePath[1];
    const openId = u.searchParams.get("id");
    if (openId) return openId;
    const ucId = u.pathname.match(/\/uc\?.*$/) ? u.searchParams.get("id") : null;
    return ucId;
  } catch {
    const m = url.match(/\/file\/d\/([^/]+)/);
    return m?.[1] ?? null;
  }
}

/** iframe-friendly Google Drive preview URL. */
export function toGoogleDriveEmbedUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

/** Canonical stored URL for a Drive file (preview embed). */
export function toGoogleDrivePreviewUrl(fileId: string): string {
  return toGoogleDriveEmbedUrl(fileId);
}

export function isGoogleDriveUrl(url: string): boolean {
  return parseGoogleDriveFileId(url) != null;
}

export function isGooglePhotosUrl(url: string): boolean {
  if (!url?.trim()) return false;
  try {
    const host = new URL(url.trim()).hostname.replace(/^www\./, "");
    return host === "lh3.googleusercontent.com" || host.endsWith(".googleusercontent.com");
  } catch {
    return /googleusercontent\.com/i.test(url);
  }
}

export function isHttpImageUrl(url: string): boolean {
  if (!url?.trim()) return false;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (isGoogleDriveUrl(url) || isYoutubeUrl(url)) return false;
    return true;
  } catch {
    return false;
  }
}

export function isYoutubeUrl(url: string): boolean {
  return youtubeVideoId(url) != null;
}

/**
 * Extract a YouTube video id from common URL shapes: watch, youtu.be, embed, shorts, and
 * the `/live/<id>` share link YouTube hands out for a live broadcast. A live broadcast
 * has an ordinary video id behind that path, so it embeds and thumbnails like any other.
 */
export function youtubeVideoId(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host === "youtu.be") {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    if (host.includes("youtube.com") || host.includes("youtube-nocookie.com")) {
      for (const prefix of ["/embed/", "/shorts/", "/live/"]) {
        if (u.pathname.startsWith(prefix)) {
          return u.pathname.slice(prefix.length).split("/")[0] || null;
        }
      }
      return u.searchParams.get("v");
    }
    return null;
  } catch {
    return null;
  }
}

export function youtubeThumbnail(url: string): string | null {
  const id = youtubeVideoId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

export function detectVideoMediaType(url: string): VideoMediaType {
  if (isYoutubeUrl(url)) return "youtube";
  if (isGoogleDriveUrl(url)) return "google_drive";
  return "external";
}

/** Normalize a video URL for storage (Drive → preview embed). */
export function normalizeVideoMediaUrl(url: string): VideoMediaInfo {
  const trimmed = url.trim();
  const driveId = parseGoogleDriveFileId(trimmed);
  if (driveId) {
    const preview = toGoogleDrivePreviewUrl(driveId);
    return {
      mediaType: "google_drive",
      sourceUrl: trimmed,
      embedUrl: preview,
      thumbnailUrl: null,
    };
  }
  const ytThumb = youtubeThumbnail(trimmed);
  if (ytThumb) {
    return {
      mediaType: "youtube",
      sourceUrl: trimmed,
      embedUrl: trimmed,
      thumbnailUrl: ytThumb,
    };
  }
  return {
    mediaType: "external",
    sourceUrl: trimmed,
    embedUrl: trimmed,
    thumbnailUrl: null,
  };
}

export function videoEmbedUrl(url: string, mediaType?: VideoMediaType): string | null {
  const type = mediaType ?? detectVideoMediaType(url);
  if (type === "google_drive") {
    const id = parseGoogleDriveFileId(url);
    return id ? toGoogleDriveEmbedUrl(id) : null;
  }
  if (type === "youtube") {
    const id = youtubeVideoId(url);
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }
  return url.trim() || null;
}

export function highlightThumbnailUrl(
  videoUrl: string,
  explicitThumb?: string | null
): string | null {
  if (explicitThumb?.trim()) return explicitThumb.trim();
  return youtubeThumbnail(videoUrl);
}

export function isAllowedVideoMediaUrl(url: string): boolean {
  const trimmed = url?.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  } catch {
    return false;
  }
  return (
    isYoutubeUrl(trimmed) ||
    isGoogleDriveUrl(trimmed) ||
    /^https?:\/\/.+/i.test(trimmed)
  );
}

export function isAllowedImageMediaUrl(url: string): boolean {
  return isHttpImageUrl(url) || isGooglePhotosUrl(url);
}

/** Match page photo entries stored in `SbMatch.meta.photos`. */
export function toMatchPhotoEntries(urls: string[]): Array<{ url: string; caption: string | null }> {
  return urls.filter(Boolean).map((url) => ({ url: url.trim(), caption: null }));
}

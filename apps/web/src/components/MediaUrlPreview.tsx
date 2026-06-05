import {
  detectVideoMediaType,
  highlightThumbnailUrl,
  isAllowedImageMediaUrl,
  isAllowedVideoMediaUrl,
  videoEmbedUrl,
} from "../utils/media-url";
import { MediaVideoEmbed } from "./MediaVideoEmbed";

type Props = {
  url: string;
  kind: "video" | "image";
};

export function MediaUrlPreview({ url, kind }: Props) {
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (kind === "video" && isAllowedVideoMediaUrl(trimmed)) {
    const mediaType = detectVideoMediaType(trimmed);
    return (
      <div className="admin-media-preview">
        <MediaVideoEmbed url={trimmed} title="Preview" mediaType={mediaType} />
      </div>
    );
  }

  if (kind === "image" && isAllowedImageMediaUrl(trimmed)) {
    return (
      <div className="admin-media-preview">
        <img src={trimmed} alt="Preview" referrerPolicy="no-referrer" loading="lazy" />
      </div>
    );
  }

  if (kind === "video") {
    const thumb = highlightThumbnailUrl(trimmed);
    if (thumb) {
      return (
        <div className="admin-media-preview">
          <img src={thumb} alt="" referrerPolicy="no-referrer" loading="lazy" />
        </div>
      );
    }
    const embed = videoEmbedUrl(trimmed);
    if (embed) {
      return (
        <div className="admin-media-preview">
          <MediaVideoEmbed url={trimmed} title="Preview" />
        </div>
      );
    }
  }

  return null;
}

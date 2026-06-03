import {
  detectVideoMediaType,
  videoEmbedUrl,
  type VideoMediaType,
} from "../utils/media-url";

type Props = {
  url: string;
  title: string;
  mediaType?: VideoMediaType;
  embedUrl?: string | null;
  className?: string;
};

export function MediaVideoEmbed({ url, title, mediaType, embedUrl, className }: Props) {
  const type = mediaType ?? detectVideoMediaType(url);
  const embed = embedUrl ?? videoEmbedUrl(url, type);

  if (type === "google_drive" && embed) {
    return (
      <div className={`sb-media-video${className ? ` ${className}` : ""}`}>
        <iframe
          src={embed}
          title={title}
          allow="autoplay; encrypted-media"
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer"
          className="sb-media-video__iframe"
        />
        <p className="sb-media-video__fallback muted">
          Video not playing?{" "}
          <a href={url} target="_blank" rel="noreferrer" className="text-link">
            Open in Google Drive ↗
          </a>
        </p>
      </div>
    );
  }

  if (type === "youtube" && embed) {
    return (
      <div className={`sb-media-video${className ? ` ${className}` : ""}`}>
        <iframe
          src={embed}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer"
          className="sb-media-video__iframe"
        />
      </div>
    );
  }

  return (
    <p className="muted">
      <a href={url} target="_blank" rel="noreferrer" className="text-link">
        Watch: {title} ↗
      </a>
    </p>
  );
}

import { safeHref } from "../lib/safe-href";

export type AdBannerFormat = "leaderboard" | "square" | "mobile-banner" | "inline";

export type AdBannerProps = {
  slotId: string;
  format: AdBannerFormat;
  fallbackImageUrl: string;
  destinationUrl: string;
  label?: string;
  /** Shown under the frame (e.g. recommended upload size in dev) */
  sizeHint?: string;
};

export function AdBanner({
  slotId,
  format,
  fallbackImageUrl,
  destinationUrl,
  label,
  sizeHint,
}: AdBannerProps) {
  // Hide legacy demo label text from public UI.
  const normalizedLabel = label?.trim();
  const displayLabel =
    normalizedLabel && normalizedLabel !== "Demo · Sidebar sponsor"
      ? normalizedLabel
      : "Advertisement";
  // Admin-entered, but shown on public pages: only an http(s) link becomes clickable.
  const href = safeHref(destinationUrl);

  return (
    <aside
      className={`ad-banner ad-banner--${format}`}
      data-slot-id={slotId}
      data-ad-format={format}
      aria-label="Sponsored content"
    >
      <span className="ad-banner__label">{displayLabel}</span>
      <div className="ad-banner__frame">
        <div className="ad-banner__slot" data-slot={slotId}>
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer sponsored"
              className="ad-banner__link"
              title={sizeHint}
            >
              <img
                src={fallbackImageUrl}
                alt="Sponsored"
                className="ad-banner__image"
                loading="lazy"
                title={sizeHint}
              />
            </a>
          ) : (
            <img
              src={fallbackImageUrl}
              alt="Sponsored"
              className="ad-banner__image"
              loading="lazy"
              title={sizeHint}
            />
          )}
        </div>
      </div>
      {sizeHint && <p className="ad-banner__size-hint muted">{sizeHint}</p>}
    </aside>
  );
}

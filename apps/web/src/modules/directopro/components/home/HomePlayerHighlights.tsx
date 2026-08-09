import { useCallback, useEffect, useId, useState } from "react";
import { apiGet, type HomeVideoHighlight } from "../../../../api/client";
import { highlightThumbnailUrl, videoEmbedUrl } from "../../../../utils/media-url";

function embedAutoplayUrl(youtubeUrl: string): string | null {
  const base = videoEmbedUrl(youtubeUrl);
  if (!base) return null;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}autoplay=1`;
}

type HighlightVideoCardProps = {
  highlight: HomeVideoHighlight;
  onPlay: (id: string) => void;
};

function HighlightVideoCard({ highlight, onPlay }: HighlightVideoCardProps) {
  const thumb = highlightThumbnailUrl(highlight.youtubeUrl);
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <article className="home-hl-card">
      <button
        type="button"
        className="home-hl-card__media"
        onClick={() => onPlay(highlight.id)}
        aria-label={`Play: ${highlight.title}`}
      >
        {thumb && !imageFailed ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="home-hl-card__thumb"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="home-hl-card__thumb home-hl-card__thumb--fallback" aria-hidden="true" />
        )}
        <span className="home-hl-card__play" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="44" height="44" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </button>
    </article>
  );
}

type HomeHighlightVideoModalProps = {
  highlight: HomeVideoHighlight;
  onClose: () => void;
};

function HomeHighlightVideoModal({ highlight, onClose }: HomeHighlightVideoModalProps) {
  const titleId = useId();
  const embedSrc = embedAutoplayUrl(highlight.youtubeUrl);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="home-highlights-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="home-highlights-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="home-highlights-modal__close"
          onClick={onClose}
          aria-label="Close video"
        >
          <span aria-hidden="true">&times;</span>
        </button>

        {embedSrc ? (
          <div className="home-highlights-modal__player">
            <iframe
              src={embedSrc}
              title={highlight.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="home-highlights-modal__iframe"
            />
          </div>
        ) : (
          <p className="home-highlights-modal__unavailable muted">
            This clip cannot be played inline.
          </p>
        )}

        <div className="home-highlights-modal__meta">
          <span className="home-highlights-modal__tag">{highlight.playerName}</span>
          <h2 id={titleId} className="home-highlights-modal__title">
            {highlight.title}
          </h2>
          {highlight.description?.trim() && (
            <p className="home-highlights-modal__desc">{highlight.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function HomePlayerHighlights() {
  const [highlights, setHighlights] = useState<HomeVideoHighlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const visibleHighlights = highlights.slice(0, 3);
  const activeHighlight = highlights.find((h) => h.id === activeId) ?? null;

  const handlePlay = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const handleClose = useCallback(() => {
    setActiveId(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    apiGet<HomeVideoHighlight[]>("/home/video-highlights", controller.signal)
      .then((data) => {
        if (active) setHighlights(data);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return (
    <section className="home-footage" aria-labelledby="home-player-highlights-title">
      <div className="home-footage__head">
        <span className="home-footage__eyebrow">Player Highlights</span>
        <h2 id="home-player-highlights-title">Curated match footage</h2>
        <p>
          Verified clips from Jagaban Cup, 1XCup, and NLO — defensive reads, goals, and
          game-changing moments.
        </p>
      </div>

      {loading && (
        <div className="home-footage__grid" aria-busy="true" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="dtp-skeleton home-hl-card-skeleton" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="dtp-empty-state home-features-empty">
          <p className="dtp-empty-state__title">Could not load highlights</p>
          <p>Please refresh. Curated clips will appear when available.</p>
        </div>
      )}

      {!loading && !error && visibleHighlights.length === 0 && (
        <div className="dtp-empty-state home-features-empty">
          <p className="dtp-empty-state__title">No highlights published yet</p>
          <p>Curated player clips from tournaments will appear here soon.</p>
        </div>
      )}

      {!loading && !error && visibleHighlights.length > 0 && (
        <>
          <div className="home-footage__grid">
            {visibleHighlights.map((highlight) => (
              <HighlightVideoCard key={highlight.id} highlight={highlight} onPlay={handlePlay} />
            ))}
          </div>

          <div className="home-footage__pager" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </>
      )}

      {activeHighlight && (
        <HomeHighlightVideoModal highlight={activeHighlight} onClose={handleClose} />
      )}
    </section>
  );
}

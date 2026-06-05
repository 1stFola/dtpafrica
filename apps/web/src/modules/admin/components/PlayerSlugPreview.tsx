import { useEffect, useState } from "react";
import { adminApi } from "../../../api/admin";
import { slugifyPlayerName } from "../../../lib/player-slug";

type Props = {
  displayName: string;
  excludeId?: string;
  currentSlug?: string | null;
};

export function PlayerSlugPreview({ displayName, excludeId, currentSlug }: Props) {
  const [slug, setSlug] = useState("");
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);

  const trimmed = displayName.trim();
  const localSlug = trimmed ? slugifyPlayerName(trimmed) : "";

  useEffect(() => {
    if (!trimmed) {
      setSlug("");
      setAvailable(false);
      return;
    }

    if (currentSlug && slugifyPlayerName(trimmed) === currentSlug) {
      setSlug(currentSlug);
      setAvailable(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    adminApi
      .previewPlayerSlug(trimmed, excludeId)
      .then((res) => {
        if (cancelled) return;
        setSlug(res.slug);
        setAvailable(res.available);
      })
      .catch(() => {
        if (cancelled) return;
        setSlug(localSlug);
        setAvailable(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [trimmed, excludeId, currentSlug, localSlug]);

  if (!trimmed) return null;

  return (
    <p className="admin-slug-preview" aria-live="polite">
      <span className="muted">Public Link Preview:</span>{" "}
      <code>/player/{slug || localSlug || "…"}</code>
      {loading ? (
        <span className="admin-slug-preview__status muted"> checking…</span>
      ) : available ? (
        <span className="admin-slug-preview__status admin-slug-preview__status--ok"> ✓</span>
      ) : slug ? (
        <span className="admin-slug-preview__status muted"> (unique variant)</span>
      ) : null}
    </p>
  );
}

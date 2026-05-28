import { FormEvent, useEffect, useState } from "react";
import {
  adminApi,
  type AdminAdSlotConfig,
  type AdminAdSlotKey,
  type AdminAdsConfig,
} from "../../../api/admin";
import { AD_SLOT_KEYS, defaultAdConfig } from "../../../config/adConfig";
import { AD_FORMAT_SPECS, AD_SLOT_SIZE_SPECS } from "../../../config/adFormatSpecs";
import { usePageTitle } from "../../../hooks/usePageTitle";

const SLOT_META: Record<
  AdminAdSlotKey,
  { title: string; placementNotes: string }
> = {
  scoreboardLeaderboardDesktop: {
    title: "Scoreboard leaderboard (legacy header)",
    placementNotes:
      "Deprecated on desktop — use ScoreBoard top instead. Optional legacy slot.",
  },
  scoreboardLeaderboardMobile: {
    title: "Scoreboard banner (mobile)",
    placementNotes: "ScoreBoard header; shown below 760px.",
  },
  matchCenterInline: {
    title: "Match center inline",
    placementNotes: "Match center page below score header.",
  },
  featuredPlayersInline: {
    title: "Featured players inline",
    placementNotes: "Inserted every 8 cards on /featured-players.",
  },
  scoutingDirectoryInline: {
    title: "Scouting directory inline",
    placementNotes: "Inserted every 8 rows on tactical search.",
  },
  scoreboardTop: {
    title: "ScoreBoard top",
    placementNotes: "Below subnav on all /scoreboard/* pages.",
  },
  scoreboardLeft: {
    title: "ScoreBoard left rail",
    placementNotes: "Left of page content on /scoreboard/* (desktop ≥1200px).",
  },
  scoreboardRight: {
    title: "ScoreBoard right rail",
    placementNotes: "Right of page content on /scoreboard/* (desktop ≥1200px).",
  },
  scoutingTop: {
    title: "Scouting top",
    placementNotes: "Below subnav on all /scouting/* pages.",
  },
  scoutingLeft: {
    title: "Scouting left rail",
    placementNotes: "Left of page content on /scouting/* (desktop ≥1200px).",
  },
  scoutingRight: {
    title: "Scouting right rail",
    placementNotes: "Right of page content on /scouting/* (desktop ≥1200px).",
  },
  valuationTop: {
    title: "Valuation top",
    placementNotes: "Below subnav on all /valuation/* pages.",
  },
  valuationLeft: {
    title: "Valuation left rail",
    placementNotes: "Left of page content on /valuation/* (desktop ≥1200px).",
  },
  valuationRight: {
    title: "Valuation right rail",
    placementNotes: "Right of page content on /valuation/* (desktop ≥1200px).",
  },
};

const FORMAT_OPTIONS: AdminAdSlotConfig["format"][] = [
  "leaderboard",
  "square",
  "mobile-banner",
  "inline",
];

function mergeLoadedSlots(
  fromApi: Partial<Record<AdminAdSlotKey, AdminAdSlotConfig>>
): Record<AdminAdSlotKey, AdminAdSlotConfig> {
  const merged = {} as Record<AdminAdSlotKey, AdminAdSlotConfig>;
  for (const key of AD_SLOT_KEYS) {
    const remote = fromApi[key];
    const fallback = defaultAdConfig[key];
    merged[key] = {
      enabled: remote?.enabled ?? true,
      slotId: remote?.slotId ?? fallback.slotId,
      format: remote?.format ?? fallback.format,
      fallbackImageUrl: remote?.fallbackImageUrl ?? "",
      destinationUrl: remote?.destinationUrl ?? fallback.destinationUrl,
      label: remote?.label ?? "",
      placementNotes: remote?.placementNotes ?? "",
    };
  }
  return merged;
}

export function AdminAdsPage() {
  usePageTitle("Admin — Ads");
  const [slots, setSlots] = useState<Record<AdminAdSlotKey, AdminAdSlotConfig> | null>(
    null
  );
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminApi
      .adsGet()
      .then((config: AdminAdsConfig) => {
        setSlots(mergeLoadedSlots(config.slots));
        setUpdatedAt(config.updatedAt);
      })
      .catch((e) => setMessage(String(e)));
  }, []);

  const updateSlot = (key: AdminAdSlotKey, patch: Partial<AdminAdSlotConfig>) => {
    setSlots((prev) => {
      if (!prev) return prev;
      return { ...prev, [key]: { ...prev[key], ...patch } };
    });
  };

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!slots) return;
    setSaving(true);
    setMessage(null);
    try {
      const payload = mergeLoadedSlots(slots);
      const saved = await adminApi.adsPatch(payload);
      setSlots(mergeLoadedSlots(saved.slots));
      setUpdatedAt(saved.updatedAt);
      setMessage("Ad placements saved. Public site picks up changes on next load.");
    } catch (err) {
      setMessage(`Could not save: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  if (!slots) {
    return (
      <div className="admin-page">
        <h1>Ad placements</h1>
        <p className="muted">{message ?? "Loading ad configuration…"}</p>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <header className="page-header">
        <h1>Ad placements</h1>
        <p className="muted">
          Enable or disable sponsor slots, set click-through URLs, and fallback image URLs.
          Upload creatives at the recommended IAB sizes below. Demo images use placehold.co.
        </p>
        <table className="sip-table admin-table admin-ads-size-table">
          <thead>
            <tr>
              <th>Format</th>
              <th>Recommended</th>
              <th>Max width</th>
              <th>IAB name</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(AD_FORMAT_SPECS) as (keyof typeof AD_FORMAT_SPECS)[]).map(
              (format) => {
                const spec = AD_FORMAT_SPECS[format];
                return (
                  <tr key={format}>
                    <td>
                      <code>{format}</code>
                    </td>
                    <td>
                      {spec.width}×{spec.height} px
                    </td>
                    <td>{spec.maxWidthPx} px</td>
                    <td>{spec.iabName}</td>
                  </tr>
                );
              }
            )}
          </tbody>
        </table>
        {updatedAt && (
          <p className="muted admin-field-help">
            Last saved: {new Date(updatedAt).toLocaleString()}
          </p>
        )}
      </header>

      {message && <p className="muted">{message}</p>}

      <form className="admin-homepage-form" onSubmit={save}>
        {AD_SLOT_KEYS.map((key) => {
          const slot = slots[key];
          const meta = SLOT_META[key];
          const sizeSpec = AD_SLOT_SIZE_SPECS[key];
          const formatSpec = AD_FORMAT_SPECS[slot.format];
          const railRenderHint =
            key.endsWith("Left") || key.endsWith("Right")
              ? "Rendered in side rails at ~240×480 px (portrait display)."
              : null;
          return (
            <section key={key} className="admin-content-form">
              <h2>{meta.title}</h2>
              <p className="muted admin-field-help">{meta.placementNotes}</p>
              <div className="admin-ad-size-spec" role="note">
                <strong>Creative size:</strong> {sizeSpec.recommendedPx} px ·{" "}
                <strong>IAB:</strong> {sizeSpec.iabName} · <strong>Format:</strong>{" "}
                <code>{slot.format}</code> · <strong>Max width:</strong> {sizeSpec.maxWidthPx}{" "}
                px (aspect {formatSpec.aspectRatio})
                {railRenderHint && (
                  <>
                    {" "}
                    · <strong>Render note:</strong> {railRenderHint}
                  </>
                )}
              </div>
              <p className="muted admin-field-help">
                Slot id: <code>{slot.slotId}</code> · Key: <code>{key}</code>
              </p>

              <label className="admin-checkbox-label">
                <input
                  type="checkbox"
                  checked={slot.enabled}
                  onChange={(e) => updateSlot(key, { enabled: e.target.checked })}
                />
                Enabled
              </label>

              <label>
                Format
                <select
                  value={slot.format}
                  onChange={(e) =>
                    updateSlot(key, {
                      format: e.target.value as AdminAdSlotConfig["format"],
                    })
                  }
                >
                  {FORMAT_OPTIONS.map((format) => {
                    const spec = AD_FORMAT_SPECS[format];
                    return (
                      <option key={format} value={format}>
                        {format} — {spec.width}×{spec.height} ({spec.iabName})
                      </option>
                    );
                  })}
                </select>
              </label>

              <label>
                Destination URL
                <input
                  type="url"
                  value={slot.destinationUrl}
                  onChange={(e) => updateSlot(key, { destinationUrl: e.target.value })}
                  required
                />
              </label>

              <label>
                Fallback image URL
                <input
                  type="url"
                  value={slot.fallbackImageUrl}
                  onChange={(e) => updateSlot(key, { fallbackImageUrl: e.target.value })}
                  placeholder={`https://…/${sizeSpec.recommendedPx.replace("×", "x")}.png`}
                />
                <span className="muted admin-field-help">
                  Use {sizeSpec.recommendedPx} px for best fit. Empty = bundled SVG placeholder.
                </span>
              </label>
              {slot.fallbackImageUrl && (
                <div className="admin-ad-preview">
                  <img
                    src={slot.fallbackImageUrl}
                    alt={`Preview ${meta.title}`}
                    width={formatSpec.width}
                    height={formatSpec.height}
                    style={{ maxWidth: "100%", height: "auto" }}
                  />
                </div>
              )}

              <label>
                Label (optional)
                <input
                  value={slot.label ?? ""}
                  onChange={(e) => updateSlot(key, { label: e.target.value })}
                  placeholder="Advertisement"
                />
              </label>

              <label>
                Placement notes (admin only)
                <textarea
                  rows={2}
                  value={slot.placementNotes ?? ""}
                  onChange={(e) => updateSlot(key, { placementNotes: e.target.value })}
                />
              </label>
            </section>
          );
        })}

        <button type="submit" className="dtp-btn dtp-btn--primary" disabled={saving}>
          {saving ? "Saving…" : "Save ad placements"}
        </button>
      </form>
    </div>
  );
}

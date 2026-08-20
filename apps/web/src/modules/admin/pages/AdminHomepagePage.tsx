import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../../api/admin";
import type { HomeVideoHighlight } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { AdminTableShell } from "../components/AdminTableShell";

type Field = {
  key: string;
  label: string;
  help?: string;
  multiline?: boolean;
  type?: string;
};

type FootageFormState = {
  playerName: string;
  title: string;
  description: string;
  youtubeUrl: string;
};

const HOMEPAGE_VIDEO_HIGHLIGHTS_KEY = "homepage.video-highlights";

const emptyFootageForm = (): FootageFormState => ({
  playerName: "",
  title: "",
  description: "",
  youtubeUrl: "",
});

function parseHomepageVideoHighlights(raw?: string): HomeVideoHighlight[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as HomeVideoHighlight[]) : [];
  } catch {
    return [];
  }
}

const sections: { title: string; fields: Field[] }[] = [
  {
    title: "Hero",
    fields: [
      { key: "home.eyebrow", label: "Eyebrow" },
      { key: "home.headline", label: "Headline" },
      {
        key: "home.headlineAccent",
        label: "Headline accent",
        help: "Optional trailing headline text highlighted in blue, for example: Local Talent.",
      },
      { key: "home.secondaryCta", label: "Hero CTA" },
      { key: "home.marquee.phrase", label: "Ticker phrase" },
    ],
  },
  {
    title: "Reel Section",
    fields: [
      {
        key: "home.reel.url",
        label: "Video URL",
        type: "url",
        help: "YouTube URL opened by the Watch Reel modal.",
      },
      { key: "home.reel.body", label: "Body", multiline: true },
      { key: "home.reel.cta", label: "CTA label" },
    ],
  },
  {
    title: "Featured Talent",
    fields: [
      { key: "home.featured.kicker", label: "Kicker" },
      { key: "home.featured.title", label: "Title" },
      { key: "home.featured.body", label: "Body", multiline: true },
      { key: "home.featured.cta", label: "CTA label" },
    ],
  },
  {
    title: "Intelligence Suite",
    fields: [
      { key: "home.intel.kicker", label: "Kicker" },
      { key: "home.intel.title", label: "Title" },
      { key: "home.intel.body", label: "Body", multiline: true },
      { key: "home.intel.cardTitle", label: "Card title" },
      { key: "home.intel.cardBody", label: "Card body", multiline: true },
      { key: "home.intel.cardCta", label: "Card CTA label" },
    ],
  },
  {
    title: "Match Footage",
    fields: [
      { key: "home.footage.kicker", label: "Kicker" },
      { key: "home.footage.title", label: "Title" },
      { key: "home.footage.body", label: "Body", multiline: true },
    ],
  },
];

const fields = sections.flatMap((section) => section.fields);

export function AdminHomepagePage() {
  usePageTitle("Admin — Homepage");
  const toast = useAdminToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [footageRows, setFootageRows] = useState<HomeVideoHighlight[]>([]);
  const [footageForm, setFootageForm] = useState<FootageFormState>(emptyFootageForm);
  const [editFootageId, setEditFootageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingFootage, setSavingFootage] = useState(false);

  useEffect(() => {
    adminApi
      .contentList()
      .then((rows) => {
        const nextValues = Object.fromEntries(rows.map((row) => [row.key, row.value]));
        setValues(nextValues);
        setFootageRows(parseHomepageVideoHighlights(nextValues[HOMEPAGE_VIDEO_HIGHLIGHTS_KEY]));
      })
      .catch((e) => toast.error(String(e)))
      .finally(() => setLoading(false));
  }, [toast]);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      await Promise.all(
        fields.map((field) => adminApi.contentUpsert(field.key, values[field.key] ?? ""))
      );
      toast.success("Homepage content saved");
    } catch (err) {
      toast.error(`Could not save: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const persistFootageRows = async (nextRows: HomeVideoHighlight[]) => {
    setSavingFootage(true);
    try {
      const value = JSON.stringify(nextRows, null, 2);
      await adminApi.contentUpsert(HOMEPAGE_VIDEO_HIGHLIGHTS_KEY, value);
      setFootageRows(nextRows);
      setValues((current) => ({ ...current, [HOMEPAGE_VIDEO_HIGHLIGHTS_KEY]: value }));
      toast.success("Match footage videos saved");
    } catch (err) {
      toast.error(`Could not save match footage: ${String(err)}`);
    } finally {
      setSavingFootage(false);
    }
  };

  const resetFootageForm = () => {
    setEditFootageId(null);
    setFootageForm(emptyFootageForm());
  };

  const startEditFootage = (row: HomeVideoHighlight) => {
    setEditFootageId(row.id);
    setFootageForm({
      playerName: row.playerName,
      title: row.title,
      description: row.description ?? "",
      youtubeUrl: row.youtubeUrl,
    });
  };

  const saveFootage = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const playerName = footageForm.playerName.trim();
    const title = footageForm.title.trim();
    const description = footageForm.description.trim();
    const youtubeUrl = footageForm.youtubeUrl.trim();

    if (!playerName || !title || !youtubeUrl) {
      toast.error("Player name, title, and YouTube URL are required");
      return;
    }

    if (editFootageId) {
      const nextRows = footageRows.map((row) =>
        row.id === editFootageId
          ? { ...row, playerName, title, description: description || undefined, youtubeUrl }
          : row
      );
      await persistFootageRows(nextRows);
      resetFootageForm();
      return;
    }

    await persistFootageRows([
      ...footageRows,
      {
        id: crypto.randomUUID(),
        playerName,
        title,
        description: description || undefined,
        youtubeUrl,
        sortOrder: footageRows.length,
      },
    ]);
    resetFootageForm();
  };

  const removeFootage = async (row: HomeVideoHighlight) => {
    if (!window.confirm(`Delete "${row.title}"?`)) return;
    const nextRows = footageRows
      .filter((item) => item.id !== row.id)
      .map((item, sortOrder) => ({ ...item, sortOrder }));
    await persistFootageRows(nextRows);
    if (editFootageId === row.id) resetFootageForm();
  };

  const moveFootage = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= footageRows.length) return;
    const nextRows = [...footageRows];
    [nextRows[index], nextRows[targetIndex]] = [nextRows[targetIndex], nextRows[index]];
    await persistFootageRows(nextRows.map((row, sortOrder) => ({ ...row, sortOrder })));
  };

  return (
    <section className="admin-page admin-sb-section">
      <AdminPageHeader
        title="Homepage"
        description="Manage the current public homepage copy, reel video, featured talent, intelligence suite, and match footage videos."
        crumbs={[{ label: "Homepage" }]}
        actions={
          <Link to="/" target="_blank" rel="noreferrer" className="text-link">
            View homepage
          </Link>
        }
      />

      {loading ? (
        <div className="admin-cms-form-skeleton" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="admin-sb-skeleton admin-sb-skeleton--panel" />
          ))}
        </div>
      ) : (
        <form className="admin-homepage-form" onSubmit={save}>
          {sections.map((section) => (
            <section key={section.title} className="admin-content-form admin-sb-panel">
              <h2 className="admin-sb-form-heading">{section.title}</h2>
              <div className="admin-sb-highlight-form">
                {section.fields.map((field) => (
                  <label
                    key={field.key}
                    className={`admin-sb-field ${field.multiline ? "admin-sb-field--wide" : ""}`}
                  >
                    <span>{field.label}</span>
                    {field.multiline ? (
                      <textarea
                        rows={3}
                        value={values[field.key] ?? ""}
                        onChange={(e) =>
                          setValues({ ...values, [field.key]: e.target.value })
                        }
                      />
                    ) : (
                      <input
                        type={field.type ?? "text"}
                        value={values[field.key] ?? ""}
                        onChange={(e) =>
                          setValues({ ...values, [field.key]: e.target.value })
                        }
                      />
                    )}
                    {field.help && <span className="muted admin-field-help">{field.help}</span>}
                  </label>
                ))}
              </div>
            </section>
          ))}

          <div className="admin-sb-sticky-actions">
            <button
              type="submit"
              className="admin-inline-button admin-inline-button--primary"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save homepage"}
            </button>
          </div>
        </form>
      )}

      {!loading && (
        <section className="admin-content-form admin-sb-panel">
          <div className="admin-sb-form-heading-row">
            <div>
              <h2 className="admin-sb-form-heading">Match Footage Videos</h2>
              <p className="muted">
                These YouTube URLs power the Player Highlights / Curated Match Footage
                section on the public homepage.
              </p>
            </div>
            {footageRows.length > 0 && (
              <span className="admin-sb-badge">{footageRows.length} videos</span>
            )}
          </div>

          <form className="admin-sb-highlight-form" onSubmit={saveFootage}>
            <h3 className="admin-sb-form-heading">
              {editFootageId ? "Edit footage video" : "Add footage video"}
            </h3>
            <label className="admin-sb-field">
              <span>Player name</span>
              <input
                required
                value={footageForm.playerName}
                onChange={(e) =>
                  setFootageForm((current) => ({ ...current, playerName: e.target.value }))
                }
                placeholder="Player name"
              />
            </label>
            <label className="admin-sb-field">
              <span>Title</span>
              <input
                required
                value={footageForm.title}
                onChange={(e) =>
                  setFootageForm((current) => ({ ...current, title: e.target.value }))
                }
                placeholder="Curated match moment"
              />
            </label>
            <label className="admin-sb-field admin-sb-field--wide">
              <span>YouTube URL</span>
              <input
                required
                type="url"
                value={footageForm.youtubeUrl}
                onChange={(e) =>
                  setFootageForm((current) => ({ ...current, youtubeUrl: e.target.value }))
                }
                placeholder="https://youtu.be/..."
              />
            </label>
            <label className="admin-sb-field admin-sb-field--wide">
              <span>Description</span>
              <textarea
                rows={3}
                value={footageForm.description}
                onChange={(e) =>
                  setFootageForm((current) => ({ ...current, description: e.target.value }))
                }
                placeholder="Optional context shown in the video modal."
              />
            </label>
            <div className="admin-sb-form-actions">
              <button
                type="submit"
                className="admin-inline-button admin-inline-button--primary"
                disabled={savingFootage}
              >
                {savingFootage ? "Saving..." : editFootageId ? "Save video" : "Add video"}
              </button>
              {editFootageId && (
                <button
                  type="button"
                  className="dtp-btn dtp-btn--secondary"
                  onClick={resetFootageForm}
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>

          <div className="admin-sb-content-panel">
            <AdminTableShell
              loading={false}
              empty={footageRows.length === 0}
              emptyTitle="No match footage videos yet"
              emptyHint="Add YouTube clips above. The first three appear on the homepage."
              columns={5}
            >
              <table className="admin-table admin-sb-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Player</th>
                    <th>Title</th>
                    <th>Video</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {footageRows.map((row, index) => (
                    <tr
                      key={row.id}
                      className={editFootageId === row.id ? "admin-sb-row--active" : undefined}
                    >
                      <td>
                        <div className="admin-table__actions">
                          <button
                            type="button"
                            className="admin-link"
                            disabled={index === 0 || savingFootage}
                            onClick={() => moveFootage(index, -1)}
                            aria-label="Move footage up"
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className="admin-link"
                            disabled={index === footageRows.length - 1 || savingFootage}
                            onClick={() => moveFootage(index, 1)}
                            aria-label="Move footage down"
                          >
                            Down
                          </button>
                        </div>
                      </td>
                      <td>
                        <strong>{row.playerName}</strong>
                      </td>
                      <td>
                        {row.title}
                        {row.description && (
                          <>
                            <br />
                            <span className="muted">{row.description}</span>
                          </>
                        )}
                      </td>
                      <td>
                        <a href={row.youtubeUrl} className="text-link" target="_blank" rel="noreferrer">
                          Open video
                        </a>
                      </td>
                      <td className="admin-table__actions">
                        <button type="button" className="admin-link" onClick={() => startEditFootage(row)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="admin-link-danger"
                          disabled={savingFootage}
                          onClick={() => removeFootage(row)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableShell>
          </div>
        </section>
      )}
    </section>
  );
}

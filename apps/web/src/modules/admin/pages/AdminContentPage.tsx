import { FormEvent, useEffect, useState } from "react";
import { adminApi, type AdminStaticContent } from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { AdminTableShell } from "../components/AdminTableShell";

const ABOUT_FIELDS = [
  { key: "about.hero.kicker", label: "Hero kicker", rows: 2 },
  { key: "about.hero.title", label: "Hero headline", rows: 3 },
  { key: "about.hero.body", label: "Hero body", rows: 5 },
  { key: "about.story.kicker", label: "Story kicker", rows: 2 },
  { key: "about.story.title", label: "Story headline", rows: 3 },
  { key: "about.story.body1", label: "Story paragraph 1", rows: 5 },
  { key: "about.story.body2", label: "Story paragraph 2", rows: 5 },
  { key: "about.framework.kicker", label: "Framework kicker", rows: 2 },
  { key: "about.framework.title", label: "Framework headline", rows: 3 },
  { key: "about.framework.body", label: "Framework body", rows: 5 },
  { key: "about.founder.kicker", label: "Founder kicker", rows: 2 },
  { key: "about.founder.name", label: "Founder name", rows: 2 },
  { key: "about.founder.role", label: "Founder role", rows: 2 },
  { key: "about.founder.body1", label: "Founder paragraph 1", rows: 5 },
  { key: "about.founder.body2", label: "Founder paragraph 2", rows: 5 },
] as const;

export function AdminContentPage() {
  usePageTitle("Admin — Content");
  const toast = useAdminToast();
  const [rows, setRows] = useState<AdminStaticContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [aboutDraft, setAboutDraft] = useState<Record<string, string>>({});
  const [savingAbout, setSavingAbout] = useState(false);

  const load = () => {
    setLoading(true);
    adminApi
      .contentList()
      .then((items) => {
        setRows(items);
        setAboutDraft(Object.fromEntries(items.map((item) => [item.key, item.value])));
        if (!selectedKey && items.length > 0) {
          setSelectedKey(items[0].key);
          setValue(items[0].value);
        }
      })
      .catch((err) => {
        toast.error(String(err));
        setRows([]);
      })
      .finally(() => setLoading(false));
  };

  const saveAbout = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSavingAbout(true);
    try {
      await Promise.all(
        ABOUT_FIELDS.map((field) =>
          adminApi.contentUpsert(field.key, aboutDraft[field.key] ?? "")
        )
      );
      toast.success("About page content saved");
      await load();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSavingAbout(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const chooseRow = (row: AdminStaticContent) => {
    setSelectedKey(row.key);
    setValue(row.value);
  };

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const key = selectedKey.trim();
    if (!key) return;

    setSaving(true);
    try {
      const saved = await adminApi.contentUpsert(key, value);
      toast.success(`Saved ${saved.key}`);
      await load();
      setSelectedKey(saved.key);
      setValue(saved.value);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-page admin-sb-section">
      <AdminPageHeader
        title="Static content"
        description="Edit key/value copy used by the public marketing pages."
        crumbs={[{ label: "Content" }]}
      />

      <form className="admin-content-form admin-sb-panel" onSubmit={saveAbout}>
        <div className="admin-sb-form-heading-row">
          <div>
            <h2 className="admin-sb-form-heading">About page editor</h2>
            <p className="muted">
              These fields feed the public /about page and are also stored as static content keys.
            </p>
          </div>
          <button
            type="submit"
            className="admin-inline-button admin-inline-button--primary"
            disabled={savingAbout}
          >
            {savingAbout ? "Saving..." : "Save About page"}
          </button>
        </div>
        <div className="admin-about-content-grid">
          {ABOUT_FIELDS.map((field) => (
            <label key={field.key} className="admin-sb-field admin-sb-field--wide">
              <span>{field.label}</span>
              <textarea
                rows={field.rows}
                value={aboutDraft[field.key] ?? ""}
                onChange={(e) =>
                  setAboutDraft((current) => ({
                    ...current,
                    [field.key]: e.target.value,
                  }))
                }
                placeholder={field.key}
              />
            </label>
          ))}
        </div>
      </form>

      <div className="admin-content-grid">
        <div className="admin-sb-content-panel">
          <AdminTableShell
            loading={loading}
            empty={!loading && rows.length === 0}
            emptyTitle="No content keys yet"
            emptyHint="Create a new key using the editor panel."
            columns={2}
          >
            <table className="admin-table admin-sb-table admin-table--clickable">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    className={row.key === selectedKey ? "admin-sb-row--active" : undefined}
                    onClick={() => chooseRow(row)}
                  >
                    <td>
                      <code className="admin-sb-code">{row.key}</code>
                    </td>
                    <td className="muted">
                      {new Date(row.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableShell>
        </div>

        <form className="admin-content-form admin-sb-panel" onSubmit={save}>
          <h2 className="admin-sb-form-heading">Editor</h2>
          <label className="admin-sb-field admin-sb-field--wide">
            <span>Content key</span>
            <input
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              placeholder="about.mission"
              required
            />
          </label>
          <label className="admin-sb-field admin-sb-field--wide">
            <span>Value</span>
            <textarea
              rows={8}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </label>
          <div className="admin-sb-form-actions">
            <button
              type="submit"
              className="admin-inline-button admin-inline-button--primary"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save content"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

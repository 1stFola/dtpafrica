import { FormEvent, useEffect, useState } from "react";
import { adminApi, type AdminStaticContent } from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";
import { AdminTableShell } from "../components/AdminTableShell";

type ManagedContentField = {
  key: string;
  label: string;
  rows: number;
};

type ManagedContentSection = {
  title: string;
  description: string;
  fields: ManagedContentField[];
};

const CONTENT_SECTIONS: ManagedContentSection[] = [
  {
    title: "About page",
    description: "Copy used by the current cinematic /about page.",
    fields: [
      { key: "about.hero.kicker", label: "Hero kicker", rows: 2 },
      { key: "about.hero.position", label: "Hero position line", rows: 2 },
      { key: "about.hero.title_line1", label: "Hero title line 1", rows: 2 },
      { key: "about.hero.title_line2", label: "Hero title line 2", rows: 2 },
      { key: "about.hero.body", label: "Hero body", rows: 5 },
      { key: "about.hero.change_line", label: "Hero change line", rows: 2 },
      { key: "about.hero.belief", label: "Hero belief line", rows: 2 },
      { key: "about.problem.kicker", label: "Problem kicker", rows: 2 },
      { key: "about.problem.title_line1", label: "Problem title line 1", rows: 2 },
      { key: "about.problem.title_line2", label: "Problem title line 2", rows: 2 },
      { key: "about.problem.intro1", label: "Problem intro paragraph 1", rows: 3 },
      { key: "about.problem.intro2", label: "Problem intro paragraph 2", rows: 3 },
      { key: "about.problem.close_lead", label: "Problem closing lead", rows: 2 },
      { key: "about.problem.close_body", label: "Problem closing body", rows: 2 },
      { key: "about.manifesto.title", label: "Manifesto title", rows: 4 },
      { key: "about.manifesto.body", label: "Manifesto body", rows: 4 },
      { key: "about.manifesto.emphasis", label: "Manifesto emphasis", rows: 2 },
      { key: "about.founder.kicker", label: "Founder kicker", rows: 2 },
      { key: "about.founder.name", label: "Founder name", rows: 2 },
      { key: "about.founder.role", label: "Founder role", rows: 2 },
      { key: "about.founder.body", label: "Founder body", rows: 12 },
      { key: "about.founder.quote", label: "Founder closing quote", rows: 4 },
      { key: "about.mission", label: "Mission", rows: 4 },
      { key: "about.vision", label: "Vision", rows: 4 },
      { key: "about.final.kicker", label: "Final CTA kicker", rows: 2 },
      { key: "about.final.title", label: "Final CTA title", rows: 2 },
      { key: "about.final.body1", label: "Final CTA body 1", rows: 2 },
      { key: "about.final.body2", label: "Final CTA body 2", rows: 2 },
      { key: "about.final.emphasis", label: "Final CTA emphasis", rows: 2 },
    ],
  },
  {
    title: "Public page heroes",
    description: "Copy for the About-inspired frontend pages outside /about.",
    fields: [
      { key: "blog.hero.kicker", label: "Blog kicker", rows: 2 },
      { key: "blog.hero.title", label: "Blog title", rows: 3 },
      { key: "blog.hero.body", label: "Blog body", rows: 4 },
      { key: "featured_players.hero.kicker", label: "Featured players kicker", rows: 2 },
      { key: "featured_players.hero.title", label: "Featured players title", rows: 3 },
      { key: "featured_players.hero.body", label: "Featured players body", rows: 4 },
      { key: "register.hero.kicker", label: "Register kicker", rows: 2 },
      { key: "register.hero.title", label: "Register title", rows: 3 },
      { key: "register.hero.body", label: "Register body", rows: 4 },
      { key: "contact.hero.kicker", label: "Contact kicker", rows: 2 },
      { key: "contact.hero.title", label: "Contact title", rows: 3 },
      { key: "contact.hero.body", label: "Contact body", rows: 4 },
      { key: "contact.panel.kicker", label: "Contact panel kicker", rows: 2 },
      { key: "contact.panel.title", label: "Contact panel title", rows: 3 },
      { key: "contact.email", label: "Contact email", rows: 2 },
      { key: "contact.whatsapp", label: "Contact WhatsApp", rows: 2 },
    ],
  },
];

const MANAGED_FIELDS = CONTENT_SECTIONS.flatMap((section) => section.fields);

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
        MANAGED_FIELDS.map((field) =>
          adminApi.contentUpsert(field.key, aboutDraft[field.key] ?? "")
        )
      );
      toast.success("Managed public content saved");
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
        description="Edit managed public-page copy and one-off static content keys."
        crumbs={[{ label: "Content" }]}
      />

      <form className="admin-content-form admin-sb-panel" onSubmit={saveAbout}>
        <div className="admin-sb-form-heading-row">
          <div>
            <h2 className="admin-sb-form-heading">Managed frontend content</h2>
            <p className="muted">
              These fields correspond to the current public About, Blog, Featured Players,
              Register, and Contact pages.
            </p>
          </div>
          <button
            type="submit"
            className="admin-inline-button admin-inline-button--primary"
            disabled={savingAbout}
          >
            {savingAbout ? "Saving..." : "Save managed content"}
          </button>
        </div>
        <div className="admin-content-section-stack">
          {CONTENT_SECTIONS.map((section) => (
            <section key={section.title} className="admin-content-managed-section">
              <div className="admin-content-managed-section__header">
                <h3>{section.title}</h3>
                <p className="muted">{section.description}</p>
              </div>
              <div className="admin-about-content-grid">
                {section.fields.map((field) => (
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
                    <small className="admin-sb-field-hint">{field.key}</small>
                  </label>
                ))}
              </div>
            </section>
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
              {saving ? "Saving..." : "Save content"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

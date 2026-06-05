import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useAdminToast } from "../components/AdminToast";
import { AdminPageHeader } from "../components/AdminPageHeader";

type Field = {
  key: string;
  label: string;
  help?: string;
  multiline?: boolean;
};

const sections: { title: string; fields: Field[] }[] = [
  {
    title: "Hero",
    fields: [
      { key: "home.eyebrow", label: "Eyebrow" },
      { key: "home.headline", label: "Headline" },
      { key: "home.lead", label: "Lead", multiline: true },
      { key: "home.primaryCta", label: "Primary CTA" },
      { key: "home.secondaryCta", label: "Secondary CTA" },
    ],
  },
  {
    title: "Announcement",
    fields: [
      { key: "home.announcement.enabled", label: "Enabled", help: "Use true or false." },
      { key: "home.announcement.title", label: "Title" },
      { key: "home.announcement.body", label: "Body", multiline: true },
      { key: "home.announcement.ctaLabel", label: "CTA label" },
      { key: "home.announcement.ctaHref", label: "CTA href" },
    ],
  },
  {
    title: "Event Sales",
    fields: [
      { key: "home.event.enabled", label: "Enabled", help: "Use true or false." },
      { key: "home.event.title", label: "Title" },
      { key: "home.event.date", label: "Date" },
      { key: "home.event.venue", label: "Venue" },
      { key: "home.event.body", label: "Body", multiline: true },
      { key: "home.event.ctaLabel", label: "CTA label" },
      { key: "home.event.ctaHref", label: "CTA href" },
    ],
  },
  {
    title: "Featured Video",
    fields: [
      { key: "home.featuredVideo.enabled", label: "Enabled", help: "Use true or false." },
      { key: "home.featuredVideo.title", label: "Title" },
      { key: "home.featuredVideo.url", label: "Video URL" },
      { key: "home.featuredVideo.caption", label: "Caption", multiline: true },
    ],
  },
  {
    title: "Wins Wall",
    fields: [
      { key: "home.winsWall.enabled", label: "Enabled", help: "Use true or false." },
      { key: "home.winsWall.title", label: "Title" },
      {
        key: "home.winsWall.logos",
        label: "Logos JSON",
        help: 'Array of {"name","imageUrl","href"} objects. Leave imageUrl empty for text cards.',
        multiline: true,
      },
    ],
  },
];

const fields = sections.flatMap((section) => section.fields);

export function AdminHomepagePage() {
  usePageTitle("Admin — Homepage");
  const toast = useAdminToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminApi
      .contentList()
      .then((rows) => setValues(Object.fromEntries(rows.map((row) => [row.key, row.value]))))
      .catch((e) => toast.error(String(e)))
      .finally(() => setLoading(false));
  }, [toast]);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      JSON.parse(values["home.winsWall.logos"] || "[]");
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

  return (
    <section className="admin-page admin-sb-section">
      <AdminPageHeader
        title="Homepage"
        description="Manage announcements, event sales, featured video, wins wall, and video highlights."
        crumbs={[{ label: "Homepage" }]}
        actions={
          <Link to="/admin/homepage/video-highlights" className="text-link">
            Video highlights manager →
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
                        rows={field.key === "home.winsWall.logos" ? 6 : 3}
                        value={values[field.key] ?? ""}
                        onChange={(e) =>
                          setValues({ ...values, [field.key]: e.target.value })
                        }
                      />
                    ) : (
                      <input
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
    </section>
  );
}

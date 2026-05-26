import { FormEvent, useEffect, useState } from "react";
import { adminApi } from "../../../api/admin";
import { usePageTitle } from "../../../hooks/usePageTitle";

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
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminApi
      .contentList()
      .then((rows) =>
        setValues(Object.fromEntries(rows.map((row) => [row.key, row.value])))
      )
      .catch((e) => setMessage(String(e)));
  }, []);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      JSON.parse(values["home.winsWall.logos"] || "[]");
      await Promise.all(
        fields.map((field) => adminApi.contentUpsert(field.key, values[field.key] ?? ""))
      );
      setMessage("Homepage content saved");
    } catch (err) {
      setMessage(`Could not save: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-page">
      <header className="page-header">
        <h1>Homepage</h1>
        <p className="muted">
          Manage current-platform equivalents for legacy announcements, event sales,
          featured video, and wins wall content.
        </p>
      </header>

      {message && <p className="muted">{message}</p>}

      <form className="admin-homepage-form" onSubmit={save}>
        {sections.map((section) => (
          <section key={section.title} className="admin-content-form">
            <h2>{section.title}</h2>
            {section.fields.map((field) => (
              <label key={field.key}>
                {field.label}
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
          </section>
        ))}

        <button type="submit" className="dtp-btn dtp-btn--primary" disabled={saving}>
          {saving ? "Saving…" : "Save homepage"}
        </button>
      </form>
    </div>
  );
}

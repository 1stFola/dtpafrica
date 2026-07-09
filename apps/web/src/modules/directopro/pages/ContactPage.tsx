import { FormEvent, useState } from "react";
import { Button } from "@dtp/ui";
import { apiPost } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { contentValue, useStaticContent } from "../../../hooks/useStaticContent";

export function ContactPage() {
  usePageTitle("Contact");
  const contact = useStaticContent([
    "contact.hero.kicker",
    "contact.hero.title",
    "contact.hero.body",
    "contact.panel.kicker",
    "contact.panel.title",
    "contact.email",
    "contact.whatsapp",
  ]);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      await apiPost("/home/contact", {
        name: fd.get("name"),
        email: fd.get("email"),
        phone: fd.get("phone") || undefined,
        subject: fd.get("subject") || undefined,
        message: fd.get("message"),
      });
      setSent(true);
      e.currentTarget.reset();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="home-page evidence-page evidence-page--contact">
      <header className="evidence-hero contact-hero">
        <span className="about-kicker">{contentValue(contact, "contact.hero.kicker", "Start the conversation")}</span>
        <h1>{contentValue(contact, "contact.hero.title", "Bring the right football evidence into view.")}</h1>
        <p>
          {contentValue(
            contact,
            "contact.hero.body",
            "Reach the DTP Africa team for partnerships, scouting conversations, club onboarding, media, or platform support."
          )}
        </p>
      </header>

      <section className="contact-evidence-grid">
        <aside className="contact-evidence-panel">
          <span>{contentValue(contact, "contact.panel.kicker", "Direct channels")}</span>
          <h2>
            {contentValue(
              contact,
              "contact.panel.title",
              "For clubs, scouts, academies, partners, and football families."
            )}
          </h2>
          <div className="contact-channels">
            {contact["contact.email"] && (
              <p>
                Email:{" "}
                <a href={`mailto:${contact["contact.email"]}`} className="text-link">
                  {contact["contact.email"]}
                </a>
              </p>
            )}
            {contact["contact.whatsapp"] && (
              <p>
                WhatsApp:{" "}
                <a
                  href={`https://wa.me/${contact["contact.whatsapp"].replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-link"
                >
                  {contact["contact.whatsapp"]}
                </a>
              </p>
            )}
          </div>
        </aside>

        {sent ? (
          <div className="success-panel evidence-success-panel">
            <h2>Message sent</h2>
            <p>We will respond as soon as possible.</p>
          </div>
        ) : (
          <form className="home-form evidence-form" onSubmit={onSubmit}>
            <label>
              Name
              <input name="name" required />
            </label>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Phone
              <input name="phone" type="tel" />
            </label>
            <label>
              Subject
              <input name="subject" />
            </label>
            <label>
              Message
              <textarea name="message" rows={5} required minLength={10} />
            </label>
            {error && <p className="form-error">{error}</p>}
            <Button type="submit" disabled={loading}>
              {loading ? "Sending..." : "Send message"}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}

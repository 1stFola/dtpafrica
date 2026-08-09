import { FormEvent, useState } from "react";
import { apiPost } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { contentValue, useStaticContent } from "../../../hooks/useStaticContent";
import { HIGH_FETCH_PRIORITY } from "../../../utils/imgPriority";

/* Figma "DTP" -> Contact us 113:4.
   Black hero -> two-column "Direct Channels" + white form card (585x524)
   -> lime newsletter band (1311x248). */

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
    const form = e.currentTarget;
    setLoading(true);
    setError(null);
    const fd = new FormData(form);
    try {
      await apiPost("/home/contact", {
        name: [fd.get("firstName"), fd.get("lastName")].filter(Boolean).join(" ").trim(),
        email: fd.get("email"),
        phone: fd.get("phone") || undefined,
        subject: fd.get("subject") || undefined,
        message: fd.get("message"),
      });
      setSent(true);
      form.reset();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dtp-page">
      <section className="dtp-hero dtp-hero--left">
        <img className="dtp-hero__media" {...HIGH_FETCH_PRIORITY} decoding="async" src="/figma/hero-contact.webp" alt="" aria-hidden="true" />
        <div className="dtp-hero__scrim" aria-hidden="true" />
        <div className="dtp-shell dtp-hero__inner">
          <p className="dtp-eyebrow" style={{ color: "var(--dtp-lime)" }}>
            {contentValue(contact, "contact.hero.kicker", "Start the conversation")}
          </p>
          <h1 className="dtp-display dtp-display--hero dtp-hero__title">
            {contentValue(
              contact,
              "contact.hero.title",
              "Bring the right football evidence into view."
            )}
          </h1>
        </div>
      </section>

      <section className="dtp-band dtp-band--ink">
        <div
          className="dtp-shell"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "clamp(2rem, 5vw, 64px)",
            alignItems: "start",
          }}
        >
          <div className="dtp-channels">
            <h2 className="dtp-channels__title">
              {contentValue(contact, "contact.panel.kicker", "Direct Channels")}
            </h2>
            <p className="dtp-channels__body">
              {contentValue(
                contact,
                "contact.panel.title",
                "For clubs, scouts, academies, partners, and football families."
              )}
            </p>
            <ul className="dtp-channels__list">
              {contact["contact.whatsapp"] && (
                <li>
                  <a
                    className="dtp-channels__link"
                    href={`https://wa.me/${contact["contact.whatsapp"].replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {contact["contact.whatsapp"]}
                  </a>
                </li>
              )}
              {contact["contact.email"] && (
                <li>
                  <a className="dtp-channels__link" href={`mailto:${contact["contact.email"]}`}>
                    {contact["contact.email"]}
                  </a>
                </li>
              )}
            </ul>
            <p className="dtp-lead" style={{ color: "var(--dtp-white)", opacity: 0.86 }}>
              {contentValue(
                contact,
                "contact.hero.body",
                "Reach the DTP Africa team for partnerships, scouting conversations, club onboarding, media, or platform support."
              )}
            </p>
          </div>

          {sent ? (
            <div className="dtp-form" style={{ display: "block", textAlign: "center" }}>
              <h2 className="dtp-display" style={{ fontSize: "2rem", color: "var(--dtp-green)" }}>
                Message sent
              </h2>
              <p className="dtp-lead" style={{ color: "var(--dtp-slate)" }}>
                We will respond as soon as possible.
              </p>
            </div>
          ) : (
            <form className="dtp-form" onSubmit={onSubmit} noValidate={false}>
              <div className="dtp-form__field">
                <label className="dtp-form__label" htmlFor="contact-first-name">
                  First name
                </label>
                <input
                  className="dtp-form__input"
                  id="contact-first-name"
                  name="firstName"
                  placeholder="John"
                  autoComplete="given-name"
                  required
                />
              </div>

              <div className="dtp-form__field">
                <label className="dtp-form__label" htmlFor="contact-last-name">
                  Last name
                </label>
                <input
                  className="dtp-form__input"
                  id="contact-last-name"
                  name="lastName"
                  placeholder="Last Name*"
                  autoComplete="family-name"
                  required
                />
              </div>

              <div className="dtp-form__field dtp-form__field--wide">
                <label className="dtp-form__label" htmlFor="contact-email">
                  Email
                </label>
                <input
                  className="dtp-form__input"
                  id="contact-email"
                  name="email"
                  type="email"
                  placeholder="Email*"
                  autoComplete="email"
                  required
                />
              </div>

              <div className="dtp-form__field dtp-form__field--wide">
                <label className="dtp-form__label" htmlFor="contact-phone">
                  Phone number
                </label>
                <input
                  className="dtp-form__input"
                  id="contact-phone"
                  name="phone"
                  type="tel"
                  placeholder="Phone Number*"
                  autoComplete="tel"
                />
              </div>

              <div className="dtp-form__field dtp-form__field--wide">
                <label className="dtp-form__label" htmlFor="contact-subject">
                  Subject
                </label>
                <input
                  className="dtp-form__input"
                  id="contact-subject"
                  name="subject"
                  placeholder="What is this about?"
                />
              </div>

              <div className="dtp-form__field dtp-form__field--wide">
                <label className="dtp-form__label" htmlFor="contact-message">
                  Message
                </label>
                <textarea
                  className="dtp-form__textarea"
                  id="contact-message"
                  name="message"
                  rows={5}
                  minLength={10}
                  placeholder="Your message..."
                  required
                />
              </div>

              {error && <p className="dtp-form__error">{error}</p>}

              <div className="dtp-form__actions">
                <button type="submit" className="dtp-btn" disabled={loading}>
                  {loading ? "Sending..." : "Send us a Message"}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="dtp-band dtp-band--ink" style={{ paddingTop: 0 }}>
        <div className="dtp-shell">
          <div className="dtp-subscribe">
            <div>
              <h2 className="dtp-subscribe__title">Subscribe to our Newsletter</h2>
              <p className="dtp-subscribe__body">
                Stay informed about the latest platform updates, scouting releases, and
                announcements by subscribing to our newsletter.
              </p>
            </div>
            <form
              className="dtp-subscribe__form"
              onSubmit={(event) => {
                event.preventDefault();
                const input = event.currentTarget.elements.namedItem(
                  "newsletterEmail"
                ) as HTMLInputElement | null;
                if (input?.value) {
                  window.location.href = `mailto:${
                    contact["contact.email"] || "hello@dtp.africa"
                  }?subject=Newsletter%20signup&body=Please%20subscribe%20${encodeURIComponent(
                    input.value
                  )}`;
                }
              }}
            >
              <label className="sr-only" htmlFor="newsletter-email">
                Email address
              </label>
              <input
                className="dtp-subscribe__input"
                id="newsletter-email"
                name="newsletterEmail"
                type="email"
                placeholder="Enter your email"
                required
              />
              <button type="submit" className="dtp-subscribe__btn">
                Subscribe
              </button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}

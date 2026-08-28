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
  const [newsletterSent, setNewsletterSent] = useState(false);
  const [newsletterError, setNewsletterError] = useState<string | null>(null);
  const [newsletterLoading, setNewsletterLoading] = useState(false);

  const rawWhatsappDisplay = contentValue(contact, "contact.whatsapp", "+1 945 275 6104");
  const whatsappDisplay =
    rawWhatsappDisplay.replace(/\D/g, "") === "2348000000000"
      ? "+1 945 275 6104"
      : rawWhatsappDisplay;
  const whatsappDigits = whatsappDisplay.replace(/\D/g, "");
  const whatsappMessage =
    "Hello DirectToPro Africa, I'm interested in learning more about your scouting and talent profiling platform. How can we get started?";
  const contactEmail = contact["contact.email"] || "hello@dtp.africa";

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
    <div className="dtp-page contact-page">
      {/* Figma 113:4 frames this hero as an inset panel (1317x622 at x61 y207),
          not a full-bleed band, with the picture at full strength. */}
      <section className="dtp-hero dtp-hero--left dtp-hero--panel">
        <img className="dtp-hero__media" {...HIGH_FETCH_PRIORITY} decoding="async" src="/figma/hero-contact.webp" alt="" aria-hidden="true" />
        <div className="dtp-hero__scrim" aria-hidden="true" />
        <div className="dtp-shell dtp-hero__inner">
          <p className="dtp-eyebrow">
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

      {/* Figma 113:4 sets this as a two-column body: a 478px copy column at
          x135 and the 585px white form card at x715 — a 102px gutter. */}
      <section className="dtp-band dtp-band--ink">
        <div className="dtp-shell contact-body">
          {/* Figma 113:4 orders this column: the Gasoek lead (y915), then the
              "Direct Channels" heading (y1196), its lime body (y1245), and the
              two contact rows (y1312 / y1356) with a 24px glyph at x135 and the
              label at x169. The lead used to sit last, under the list. */}
          <div className="dtp-channels">
            <p className="contact-channels__lead">
              {contentValue(
                contact,
                "contact.hero.body",
                "Reach the DTP Africa team for partnerships, scouting conversations, club onboarding, media, or platform support."
              )}
            </p>
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
              <li>
                <a
                  className="dtp-channels__link"
                  href={`https://wa.me/${whatsappDigits}?text=${encodeURIComponent(whatsappMessage)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <svg
                    className="dtp-channels__glyph"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      fill="currentColor"
                      d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"
                    />
                  </svg>
                  {whatsappDisplay}
                </a>
              </li>
              <li>
                <a className="dtp-channels__link" href={`mailto:${contactEmail}`}>
                  <svg
                    className="dtp-channels__glyph"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      fill="currentColor"
                      d="M2 5.5A1.5 1.5 0 0 1 3.5 4h17A1.5 1.5 0 0 1 22 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18.5v-13Zm2.2.5 7.8 5.9L19.8 6H4.2ZM20 7.6l-7.4 5.6a1 1 0 0 1-1.2 0L4 7.6V18h16V7.6Z"
                    />
                  </svg>
                  {contactEmail}
                </a>
              </li>
            </ul>
          </div>

          {sent ? (
            <div className="dtp-form dtp-form--sent">
              <h2 className="dtp-display">Message sent</h2>
              <p className="dtp-lead">We will respond as soon as possible.</p>
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

      <section className="dtp-band dtp-band--ink contact-subscribe-band">
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
              onSubmit={async (event) => {
                event.preventDefault();
                setNewsletterError(null);
                const input = event.currentTarget.elements.namedItem(
                  "newsletterEmail"
                ) as HTMLInputElement | null;
                if (!input?.value) {
                  return;
                }
                setNewsletterLoading(true);
                try {
                  await apiPost("/home/newsletter", { email: input.value });
                  setNewsletterSent(true);
                  input.value = "";
                } catch (err) {
                  setNewsletterError(String(err));
                } finally {
                  setNewsletterLoading(false);
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
              <button type="submit" className="dtp-subscribe__btn" disabled={newsletterLoading}>
                {newsletterLoading ? "Subscribing..." : "Subscribe"}
              </button>
            </form>
            {newsletterSent && (
              <p className="dtp-form__success">Thanks. You are on the newsletter list.</p>
            )}
            {newsletterError && <p className="dtp-form__error">{newsletterError}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

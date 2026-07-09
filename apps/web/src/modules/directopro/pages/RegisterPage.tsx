import { FormEvent, useState } from "react";
import { Button } from "@dtp/ui";
import { apiPost, type RegisterResponse } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function RegisterPage() {
  usePageTitle("Register talent");
  const [submitted, setSubmitted] = useState<RegisterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isMinor, setIsMinor] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const ageRaw = String(fd.get("age") ?? "");
    const age = ageRaw ? Number(ageRaw) : undefined;

    try {
      const res = await apiPost<RegisterResponse>("/home/register", {
        firstName: fd.get("firstName"),
        lastName: fd.get("lastName"),
        positionPrimary: fd.get("positionPrimary"),
        nationality: fd.get("nationality") || undefined,
        city: fd.get("city") || undefined,
        age,
        dominantFoot: fd.get("dominantFoot") || undefined,
        videoUrl: fd.get("videoUrl") || undefined,
        biography: fd.get("biography") || undefined,
        guardianName: fd.get("guardianName") || undefined,
        guardianEmail: fd.get("guardianEmail") || undefined,
        guardianPhone: fd.get("guardianPhone") || undefined,
        consentAccepted: fd.get("consent") === "on",
      });
      setSubmitted(res);
      e.currentTarget.reset();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="home-page evidence-page evidence-page--register">
        <div className="success-panel evidence-success-panel">
          <h1>Registration received</h1>
          <p>{submitted.message}</p>
          <p className="muted">Reference: {submitted.displayName}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="home-page evidence-page evidence-page--register">
      <header className="evidence-hero register-hero">
        <span className="about-kicker">Player evidence intake</span>
        <h1>Start building a football identity that can be trusted.</h1>
        <p>
          Submit a player profile for DTP review. Players under 18 require a parent or guardian on
          the form so the process stays clear, responsible, and properly documented.
        </p>
        <div className="evidence-hero__signals" aria-label="Registration review signals">
          <span>Identity</span>
          <span>Position context</span>
          <span>Video evidence</span>
          <span>Guardian consent</span>
        </div>
      </header>

      <form className="home-form evidence-form register-evidence-form" onSubmit={onSubmit}>
        <div className="form-row">
          <label>
            First name
            <input name="firstName" required />
          </label>
          <label>
            Last name
            <input name="lastName" required />
          </label>
        </div>
        <div className="form-row">
          <label>
            Primary position
            <input name="positionPrimary" placeholder="e.g. AM, ST, CB" required />
          </label>
          <label>
            Age
            <input
              name="age"
              type="number"
              min={8}
              max={40}
              onChange={(e) => setIsMinor(Number(e.target.value) < 18)}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Nationality
            <input name="nationality" />
          </label>
          <label>
            City
            <input name="city" />
          </label>
        </div>
        <label>
          Dominant foot
          <select name="dominantFoot" defaultValue="">
            <option value="">Select</option>
            <option value="Right">Right</option>
            <option value="Left">Left</option>
            <option value="Both">Both</option>
          </select>
        </label>
        <label>
          Highlight video URL
          <input name="videoUrl" type="url" placeholder="https://" />
        </label>
        <label>
          Short bio
          <textarea name="biography" rows={4} />
        </label>

        {isMinor && (
          <fieldset className="guardian-fieldset">
            <legend>Guardian (required under 18)</legend>
            <label>
              Guardian name
              <input name="guardianName" required={isMinor} />
            </label>
            <label>
              Guardian email
              <input name="guardianEmail" type="email" required={isMinor} />
            </label>
            <label>
              Guardian phone
              <input name="guardianPhone" type="tel" />
            </label>
          </fieldset>
        )}

        <label className="checkbox-label">
          <input name="consent" type="checkbox" required />
          I confirm the information is accurate and consent to DTP processing this registration.
        </label>

        {error && <p className="form-error">{error}</p>}

        <Button type="submit" disabled={loading}>
          {loading ? "Submitting..." : "Submit registration"}
        </Button>
      </form>
    </div>
  );
}

import { useState } from "react";
import { addVisionSignatory, attachVisionEvidenceFile, createVisionPartner, createVisionSource, type VisionPartner } from "../../../api/vision";
import { useAdminAuth } from "../AdminAuthContext";
import { Field, Panel, useAction } from "./vision-ui";

const EVIDENCE_KINDS = ["contract", "email", "consent_form", "competition_authorization", "authority_evidence"];
const QUALITY_RANKS: [string, string][] = [
  ["original_master", "Original master"],
  ["authorized_export", "Authorized export"],
  ["platform_copy", "Platform copy"],
];

/**
 * The three things a source needs before footage can be held, in the order
 * they are needed: a partner, that partner's rights evidence and a signatory,
 * and the source itself, linked to its match. Everything after that -- grants,
 * acquisition, the upload link -- is on the source's own page.
 */
export function VisionRegisterPanels({ partners, onChanged }: { partners: VisionPartner[]; onChanged: () => void }) {
  const { hasPermission } = useAdminAuth();
  const { busy, run, messages } = useAction(onChanged);
  const [partner, setPartner] = useState({ name: "", contactName: "", contactEmail: "", contactPhone: "" });
  const [evidence, setEvidence] = useState<{ partnerId: string; kind: string; documentDate: string; notes: string; file: File | null }>({ partnerId: "", kind: "contract", documentDate: "", notes: "", file: null });
  const [signatory, setSignatory] = useState({ partnerId: "", name: "", role: "", contactEmail: "" });
  const [source, setSource] = useState({ partnerId: "", title: "", sbMatchId: "", url: "", sourceQualityRank: "original_master", originalAvailable: true, rightsOwnerName: "" });
  const [open, setOpen] = useState<"partner" | "evidence" | "signatory" | "source" | null>(null);
  const canRights = hasPermission("vision.rights.manage");

  const toggle = (which: typeof open) => setOpen(open === which ? null : which);

  return (
    <>
      {messages}
      <Panel
        title="Register"
        actions={
          <div className="vision-inline">
            <button type="button" onClick={() => toggle("partner")}>Partner</button>
            {canRights && <button type="button" onClick={() => toggle("evidence")}>Rights evidence</button>}
            {canRights && <button type="button" onClick={() => toggle("signatory")}>Signatory</button>}
            <button type="button" onClick={() => toggle("source")}>Source</button>
          </div>
        }
      >
        {!open && (
          <p className="muted vision-footnote">
            A partner first; then the partner's rights evidence and a signatory who can authorise acquisition; then the source, linked to its match. Grants, acquisition and the upload link are on the source's page.
          </p>
        )}

        {open === "partner" && (
          <form
            className="vision-form vision-form--grid"
            onSubmit={(e) => {
              e.preventDefault();
              void run(`Partner "${partner.name}" registered. Attach its rights evidence next.`, async () => {
                await createVisionPartner({ name: partner.name.trim(), contactName: partner.contactName.trim() || undefined, contactEmail: partner.contactEmail.trim() || undefined, contactPhone: partner.contactPhone.trim() || undefined });
                setPartner({ name: "", contactName: "", contactEmail: "", contactPhone: "" });
                setOpen(null);
              });
            }}
          >
            <Field label="Partner name" hint="the academy, club or league that owns the footage">
              <input value={partner.name} onChange={(e) => setPartner({ ...partner, name: e.target.value })} required minLength={2} />
            </Field>
            <Field label="Contact name">
              <input value={partner.contactName} onChange={(e) => setPartner({ ...partner, contactName: e.target.value })} />
            </Field>
            <Field label="Contact email">
              <input type="email" value={partner.contactEmail} onChange={(e) => setPartner({ ...partner, contactEmail: e.target.value })} />
            </Field>
            <Field label="Contact phone">
              <input value={partner.contactPhone} onChange={(e) => setPartner({ ...partner, contactPhone: e.target.value })} />
            </Field>
            <button type="submit" disabled={busy || partner.name.trim().length < 2}>
              Register partner
            </button>
          </form>
        )}

        {open === "evidence" && (
          <form
            className="vision-form vision-form--grid"
            onSubmit={(e) => {
              e.preventDefault();
              if (!evidence.file) return;
              void run(`Evidence attached to the partner. Grants on its sources can now cite it.`, async () => {
                await attachVisionEvidenceFile(evidence.partnerId, evidence.file!, { kind: evidence.kind, documentDate: evidence.documentDate || undefined, notes: evidence.notes.trim() || undefined });
                setEvidence({ ...evidence, file: null, notes: "" });
                setOpen(null);
              });
            }}
          >
            <Field label="Partner">
              <select value={evidence.partnerId} onChange={(e) => setEvidence({ ...evidence, partnerId: e.target.value })} required>
                <option value="">Choose…</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p._count.evidence} document(s))
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Kind">
              <select value={evidence.kind} onChange={(e) => setEvidence({ ...evidence, kind: e.target.value })}>
                {EVIDENCE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Document" hint="PDF or an image, up to 25 MB; it goes to the write-once master bucket">
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setEvidence({ ...evidence, file: e.target.files?.[0] ?? null })} required />
            </Field>
            <Field label="Document date">
              <input type="date" value={evidence.documentDate} onChange={(e) => setEvidence({ ...evidence, documentDate: e.target.value })} />
            </Field>
            <Field label="Notes">
              <input value={evidence.notes} onChange={(e) => setEvidence({ ...evidence, notes: e.target.value })} />
            </Field>
            <button type="submit" disabled={busy || !evidence.partnerId || !evidence.file}>
              Attach evidence
            </button>
          </form>
        )}

        {open === "signatory" && (
          <form
            className="vision-form vision-form--grid"
            onSubmit={(e) => {
              e.preventDefault();
              void run(`Signatory ${signatory.name} added. Acquisition on this partner's sources can be authorised by them.`, async () => {
                await addVisionSignatory(signatory.partnerId, { name: signatory.name.trim(), role: signatory.role.trim(), contactEmail: signatory.contactEmail.trim() || undefined });
                setSignatory({ partnerId: "", name: "", role: "", contactEmail: "" });
                setOpen(null);
              });
            }}
          >
            <Field label="Partner">
              <select value={signatory.partnerId} onChange={(e) => setSignatory({ ...signatory, partnerId: e.target.value })} required>
                <option value="">Choose…</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name">
              <input value={signatory.name} onChange={(e) => setSignatory({ ...signatory, name: e.target.value })} required minLength={2} />
            </Field>
            <Field label="Role" hint="e.g. Team Manager, Academy Director">
              <input value={signatory.role} onChange={(e) => setSignatory({ ...signatory, role: e.target.value })} required minLength={2} />
            </Field>
            <Field label="Email">
              <input type="email" value={signatory.contactEmail} onChange={(e) => setSignatory({ ...signatory, contactEmail: e.target.value })} />
            </Field>
            <button type="submit" disabled={busy || !signatory.partnerId || signatory.name.trim().length < 2 || signatory.role.trim().length < 2}>
              Add signatory
            </button>
          </form>
        )}

        {open === "source" && (
          <form
            className="vision-form vision-form--grid"
            onSubmit={(e) => {
              e.preventDefault();
              void run(`Source "${source.title || "untitled"}" registered. Grant its scopes and authorise acquisition on its page.`, async () => {
                await createVisionSource({
                  partnerId: source.partnerId,
                  title: source.title.trim() || undefined,
                  sbMatchId: source.sbMatchId.trim() || undefined,
                  url: source.url.trim() || undefined,
                  sourceQualityRank: source.sourceQualityRank,
                  originalAvailable: source.originalAvailable,
                  rightsOwnerName: source.rightsOwnerName.trim() || undefined,
                });
                setSource({ ...source, title: "", sbMatchId: "", url: "" });
                setOpen(null);
              });
            }}
          >
            <Field label="Partner">
              <select value={source.partnerId} onChange={(e) => setSource({ ...source, partnerId: e.target.value })} required>
                <option value="">Choose…</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Title" hint="e.g. KAKAWA FC v OBAZZ FC — full match">
              <input value={source.title} onChange={(e) => setSource({ ...source, title: e.target.value })} />
            </Field>
            <Field label="ScoreBoard match id" hint="from the match's page in ScoreBoard; every stage after probe needs it">
              <input value={source.sbMatchId} onChange={(e) => setSource({ ...source, sbMatchId: e.target.value })} placeholder="uuid" />
            </Field>
            <Field label="Quality">
              <select value={source.sourceQualityRank} onChange={(e) => setSource({ ...source, sourceQualityRank: e.target.value })}>
                {QUALITY_RANKS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Original available">
              <select value={source.originalAvailable ? "yes" : "no"} onChange={(e) => setSource({ ...source, originalAvailable: e.target.value === "yes" })}>
                <option value="yes">yes</option>
                <option value="no">no</option>
              </select>
            </Field>
            <Field label="URL" hint="for a catalogued platform copy; blank for a file the partner holds">
              <input value={source.url} onChange={(e) => setSource({ ...source, url: e.target.value })} />
            </Field>
            <Field label="Rights owner">
              <input value={source.rightsOwnerName} onChange={(e) => setSource({ ...source, rightsOwnerName: e.target.value })} />
            </Field>
            <button type="submit" disabled={busy || !source.partnerId}>
              Register source
            </button>
          </form>
        )}
      </Panel>
    </>
  );
}

/* Always on screen, on every page including sign-in (ADR-0001). */
export function ShadowBanner({ dev }: { dev: boolean }) {
  return (
    <div className="fp-banner" role="note">
      <strong>SHADOW REVIEW — NOT VAR.</strong> Nothing here contacts a referee or changes a decision or a score.
      {dev && <span className="fp-banner__dev">DEV CREDENTIALS — NOT FOR A REAL MATCH</span>}
    </div>
  );
}

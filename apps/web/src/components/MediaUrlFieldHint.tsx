export function MediaUrlFieldHint({ kind }: { kind: "video" | "image" }) {
  if (kind === "video") {
    return (
      <span className="muted admin-sb-field-hint">
        YouTube, Google Drive (<code>/file/d/…/view</code>), or any https video link. Drive links are
        stored as embed-friendly preview URLs.
      </span>
    );
  }
  return (
    <span className="muted admin-sb-field-hint">
      Direct image URLs including Google Photos (<code>lh3.googleusercontent.com</code>) or club CDN
      logos.
    </span>
  );
}

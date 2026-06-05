type Props = {
  title: string;
  description: string;
  phase: string;
};

export function ModulePlaceholder({ title, description, phase }: Props) {
  return (
    <section className="placeholder">
      <h1>{title}</h1>
      <p>{description}</p>
      <p className="phase-badge">Build phase: {phase}</p>
      <p className="muted">Module routes are wired; implementation follows product docs in /docs.</p>
    </section>
  );
}

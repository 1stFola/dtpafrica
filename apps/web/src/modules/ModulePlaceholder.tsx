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
      <p className="phase-badge">{phase}</p>
      <p className="muted">This experience is being prepared for DTP Africa users.</p>
    </section>
  );
}

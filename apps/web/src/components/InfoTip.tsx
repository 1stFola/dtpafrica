type Props = {
  text: string;
  label?: string;
};

export function InfoTip({ text, label = "More information" }: Props) {
  return (
    <span className="info-tip" tabIndex={0} role="note" aria-label={text}>
      <span className="info-tip__icon" aria-hidden="true">
        i
      </span>
      <span className="info-tip__tooltip" role="tooltip">
        {text}
      </span>
      <span className="sr-only">{label}: {text}</span>
    </span>
  );
}

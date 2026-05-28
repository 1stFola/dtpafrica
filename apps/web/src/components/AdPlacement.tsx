import { useAdSlot } from "../context/AdConfigContext";
import type { AdSlotKey } from "../config/adConfig";
import { creativeSizeLabel } from "../config/adFormatSpecs";
import { AdBanner } from "./AdBanner";

type AdPlacementProps = {
  slotKey: AdSlotKey;
  className?: string;
};

export function AdPlacement({ slotKey, className }: AdPlacementProps) {
  const slot = useAdSlot(slotKey);
  if (!slot) return null;

  const sizeHint = import.meta.env.DEV
    ? `Recommended creative: ${creativeSizeLabel(slot.format)}`
    : undefined;

  return (
    <div className={className}>
      <AdBanner {...slot} sizeHint={sizeHint} />
    </div>
  );
}

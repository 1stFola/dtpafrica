import type { ReactNode } from "react";
import type { AdSlotKey } from "../config/adConfig";
import { useAdSlot } from "../context/AdConfigContext";
import { AdPlacement } from "./AdPlacement";

type ModuleAdRailsProps = {
  topSlot: AdSlotKey;
  leftSlot: AdSlotKey;
  rightSlot: AdSlotKey;
  children: ReactNode;
};

export function ModuleAdRails({ topSlot, leftSlot, rightSlot, children }: ModuleAdRailsProps) {
  const top = useAdSlot(topSlot);
  const left = useAdSlot(leftSlot);
  const right = useAdSlot(rightSlot);

  const bodyClass = [
    "module-ad-body",
    !left && "module-ad-body--no-left",
    !right && "module-ad-body--no-right",
    !left && !right && "module-ad-body--no-sides",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="module-ad-shell">
      {top && (
        <div className="module-ad-top">
          <AdPlacement slotKey={topSlot} />
        </div>
      )}
      <div className={bodyClass}>
        {left && (
          <aside className="module-ad-rail module-ad-rail--left" aria-label="Sponsored left">
            <AdPlacement slotKey={leftSlot} />
          </aside>
        )}
        <div className="module-ad-main">{children}</div>
        {right && (
          <aside className="module-ad-rail module-ad-rail--right" aria-label="Sponsored right">
            <AdPlacement slotKey={rightSlot} />
          </aside>
        )}
      </div>
    </div>
  );
}

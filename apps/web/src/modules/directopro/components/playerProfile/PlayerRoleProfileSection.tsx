import { useId, useState } from "react";
import { InfoTip } from "../../../../components/InfoTip";
import { PlayerAttributeMicroGrid } from "./PlayerAttributeMicroGrid";
import {
  resolveIntelligentRoleProfileKeys,
  resolveRoleProfileHeading,
} from "./roleProfileAttributes";

type PlayerRoleProfileSectionProps = {
  attributes: Record<string, number>;
  positionPrimary?: string | null;
  role?: string | null;
  secondaryRole?: string | null;
  dataSourceLabel: string;
};

export function PlayerRoleProfileSection({
  attributes,
  positionPrimary,
  role,
  secondaryRole,
  dataSourceLabel,
}: PlayerRoleProfileSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const { coreKeys, remainingKeys } = resolveIntelligentRoleProfileKeys({
    attributes,
    positionPrimary,
    role,
    secondaryRole,
  });
  const heading = resolveRoleProfileHeading(positionPrimary, role);

  return (
    <>
      <div className="profile-section-heading">
        <div>
          <span className="player-profile-eyebrow">Skill ratings</span>
          <h2 className="player-profile-heading">
            {heading}
            <InfoTip text="Six role-specific skills highlighted for quick scouting. Expand to review all eighteen calibrated attributes across athletic, technical, mental, and team-impact categories." />
          </h2>
        </div>
        <span className="profile-data-note">{dataSourceLabel}</span>
      </div>

      <PlayerAttributeMicroGrid attributes={attributes} keys={coreKeys} variant="core" />

      {remainingKeys.length > 0 && (
        <div className="player-profile-role-expand">
          <button
            type="button"
            className="player-profile-role-expand__toggle"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? "Hide full 18-point profile" : "View full 18-point profile"}
            <span
              className={
                expanded
                  ? "player-profile-role-expand__chevron player-profile-role-expand__chevron--open"
                  : "player-profile-role-expand__chevron"
              }
              aria-hidden="true"
            />
          </button>

          <div
            id={panelId}
            className={
              expanded
                ? "player-profile-role-expand__panel"
                : "player-profile-role-expand__panel player-profile-role-expand__panel--collapsed"
            }
            hidden={!expanded}
          >
            <p className="player-profile-role-expand__lead">
              Remaining calibrated attributes for deeper scouting review.
            </p>
            <PlayerAttributeMicroGrid
              attributes={attributes}
              keys={remainingKeys}
              variant="full"
            />
          </div>
        </div>
      )}
    </>
  );
}

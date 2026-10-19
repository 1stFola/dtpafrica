/**
 * The shirt-number lookup now lives in `@dtp/engines`, so the recorder console runs the
 * same function the API publishes with. Re-exported here so existing imports stand.
 */
export {
  buildNumberLookup,
  samePersonKey,
  squadNumberLabel,
  type AmbiguousNumber,
  type NumberConflict,
  type NumberLookup,
  type NumberResolution,
  type SquadRow,
} from "@dtp/engines";

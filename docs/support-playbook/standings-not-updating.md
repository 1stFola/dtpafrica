# Standings Not Updating

Tier: Tier 2 - AI-assisted human resolution

## Symptoms

- League table is stale after full time.
- Final score displays but standings do not.
- Penalty shootout result is missing from match context.

## Diagnose

- Check match status.
- Confirm final score fields.
- Confirm `full_time` event exists when required.
- Check competition format and points rules.

## Recommendation

A human admin should verify match data, then run the approved standings recalculation path.


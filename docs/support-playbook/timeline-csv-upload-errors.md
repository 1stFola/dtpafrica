# Timeline CSV Upload Errors

Tier: Tier 1 - Known issue recommendation

## Symptoms

- CSV upload is rejected.
- Event appears without linked player history.
- `playerLabel2` or assist mentions are not captured.

## Diagnose

- Check CSV headers against the Match Center template.
- Confirm event type spelling.
- Confirm complete first and last names for clickable profile linking.
- Review Name QA for unusual or single-name entries.

## Recommendation

Correct headers/event types first. Use Name QA/merge after upload for player identity cleanup.


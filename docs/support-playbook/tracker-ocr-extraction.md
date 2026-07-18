# Tracker OCR Extraction

Tier: Tier 1 - Known issue recommendation

## Symptoms

- OCR provider missing.
- Sprint distance, kicking power, or quick release score looks wrong.
- Footed kicking power is missing.

## Diagnose

- Confirm `OCR_SPACE_API_KEY` or `OPENAI_API_KEY` is configured.
- Review extractor warnings.
- Double-check flagged fields manually before using the CSV.

## Recommendation

Treat extractor output as assisted data entry. Human verification is required for flagged metric fields.


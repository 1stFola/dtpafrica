import {
  BadGatewayException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ExtractedPlayerStats, RawMetric } from "./types";
import { PlayerStatsImageUpload } from "./extract-with-openai";

type OcrSpaceParsedResult = {
  ParsedText?: string;
  ErrorMessage?: string | string[];
};

type OcrSpaceResponse = {
  ParsedResults?: OcrSpaceParsedResult[];
  OCRExitCode?: number;
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[];
  ErrorDetails?: string;
};

type MetricKey = Exclude<keyof ExtractedPlayerStats, "warnings">;

type MetricDef = {
  key: MetricKey;
  warningLabel: string;
  labels: RegExp[];
};

const OCR_SPACE_ENDPOINT = "https://api.ocr.space/parse/image";
const OCR_REQUEST_SPACING_MS = 1600;
const OCR_MAX_ATTEMPTS = 4;
const OCR_RETRY_BASE_MS = 3500;
const SPEED_UNIT_PATTERN = String.raw`(?:m\s*p\s*h|mph|k\s*p\s*h|kph|k\s*m\s*\/\s*h|km\/h|k\s*m\s*h|kmh)`;

const METRIC_DEFS: MetricDef[] = [
  {
    key: "intense_turns_with_ball",
    warningLabel: "Intense turns with the ball",
    labels: [/intense\s+turns?\s+with\s+(?:the\s+)?ball/i],
  },
  {
    key: "top_speed_with_ball",
    warningLabel: "Top speed with the ball",
    labels: [/top\s+speed\s+with\s+(?:the\s+)?ball/i],
  },
  {
    key: "distance_with_ball",
    warningLabel: "Distance with the ball",
    labels: [/distance\s+with\s+(?:the\s+)?ball/i],
  },
  {
    key: "avg_turn_entry_speed",
    warningLabel: "Average turn entry speed",
    labels: [/(?:average|avg)\s+turn\s+entry\s+speed/i],
  },
  {
    key: "avg_turn_exit_speed",
    warningLabel: "Average turn exit speed",
    labels: [/(?:average|avg)\s+turn\s+exit\s+speed/i],
  },
  {
    key: "first_step_accelerations",
    warningLabel: "First step accelerations",
    labels: [/first\s+step\s+accelerations?/i],
  },
  {
    key: "intense_accelerations",
    warningLabel: "Intense accelerations",
    labels: [/intense\s+accelerations?/i],
  },
  {
    key: "ball_possessions",
    warningLabel: "Ball possessions",
    labels: [/ball\s+possessions?(?!\s+total)/i, /ball\s+touches/i],
  },
  {
    key: "total_distance",
    warningLabel: "Total distance",
    labels: [/total\s+distance/i],
  },
  {
    key: "sprint_distance",
    warningLabel: "Sprint distance",
    labels: [/sprint\s+distance/i],
  },
  {
    key: "top_speed",
    warningLabel: "Top speed",
    labels: [/top\s+speed(?!\s+with)/i],
  },
  {
    key: "kicking_power",
    warningLabel: "Kicking power",
    labels: [/kicking\s+power(?!\s*(?:left|right)?\s*foot)/i],
  },
  {
    key: "sprints",
    warningLabel: "Sprints",
    labels: [/\bsprints?\b/i],
  },
  {
    key: "intense_turns",
    warningLabel: "Intense turns",
    labels: [/intense\s+turns?(?!\s+with)/i],
  },
  {
    key: "left_turns",
    warningLabel: "Left turns",
    labels: [/left\s+turns?/i],
  },
  {
    key: "right_turns",
    warningLabel: "Right turns",
    labels: [/right\s+turns?/i],
  },
  {
    key: "back_turns",
    warningLabel: "Back turns",
    labels: [/back\s+turns?/i],
  },
  {
    key: "one_touch_possessions_count",
    warningLabel: "One touch count",
    labels: [/one\s+touch\s+(?:count|possessions?)/i],
  },
  {
    key: "multi_touch_possessions_count",
    warningLabel: "Multiple touch count",
    labels: [/(?:multiple|multi)\s+touch\s+(?:count|possessions?)/i],
  },
  {
    key: "total_ball_possessions",
    warningLabel: "Ball possessions total",
    labels: [/ball\s+possessions?\s+total/i],
  },
  {
    key: "possession_duration_seconds",
    warningLabel: "Possession duration seconds",
    labels: [/total\s+duration/i, /possession\s+duration/i],
  },
  {
    key: "release_laces_count",
    warningLabel: "Laces release count",
    labels: [/laces(?:\s+release)?(?:\s+count)?/i],
  },
  {
    key: "release_inside_foot_count",
    warningLabel: "Inside release count",
    labels: [/inside(?:\s+release)?(?:\s+count)?/i],
  },
  {
    key: "release_other_footzone_count",
    warningLabel: "Other release count",
    labels: [/other(?:\s+release)?(?:\s+count)?/i],
  },
  {
    key: "left_foot_touch_percentage",
    warningLabel: "Left foot touch percentage",
    labels: [/left\s+foot\s+touch(?:\s+percentage)?/i],
  },
  {
    key: "right_foot_touch_percentage",
    warningLabel: "Right foot touch percentage",
    labels: [/right\s+foot\s+touch(?:\s+percentage)?/i],
  },
  {
    key: "left_foot_release_percentage",
    warningLabel: "Left foot release percentage",
    labels: [/left\s+foot\s+release(?:\s+percentage)?/i],
  },
  {
    key: "right_foot_release_percentage",
    warningLabel: "Right foot release percentage",
    labels: [/right\s+foot\s+release(?:\s+percentage)?/i],
  },
  {
    key: "left_foot_receive_percentage",
    warningLabel: "Left foot receive percentage",
    labels: [/left\s+foot\s+receive(?:\s+percentage)?/i],
  },
  {
    key: "right_foot_receive_percentage",
    warningLabel: "Right foot receive percentage",
    labels: [/right\s+foot\s+receive(?:\s+percentage)?/i],
  },
  {
    key: "left_foot_kicking_power",
    warningLabel: "Left foot kicking power",
    labels: [/left\s+foot\s+kicking\s+power/i, /left\s+kicking\s+power/i],
  },
  {
    key: "right_foot_kicking_power",
    warningLabel: "Right foot kicking power",
    labels: [/right\s+foot\s+kicking\s+power/i, /right\s+kicking\s+power/i],
  },
];

const ALL_KEYS = METRIC_DEFS.map((def) => def.key);

function blankMetric(): RawMetric {
  return { value: null, unit: null, confidence: null };
}

function normalizeWhitespace(value: string) {
  return value.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function parseErrorMessage(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(" ");
  return value || "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferUnit(snippet: string): string | null {
  const unitMatch = snippet.match(
    /(?:k\s*m\s*\/\s*h|km\/h|k\s*p\s*h|kph|k\s*m\s*h|kmh|m\s*p\s*h|mph|\byards?\b|\byds?\b|\byd\b|\bmiles?\b|\bmi\b|\bkilometers?\b|\bkm\b|\bmeters?\b|\bmetres?\b|\bm\b|\bseconds?\b|\bsecs?\b|\bsec\b|\bs\b|%)/i
  );
  if (!unitMatch) return null;
  const raw = unitMatch[0].toLowerCase().replace(/\s+/g, "");
  if (raw === "kmh") return "kph";
  if (raw === "kph") return "kph";
  if (raw === "km/h") return "km/h";
  if (raw === "mph") return "mph";
  if (raw === "yds") return "yd";
  if (raw === "yards") return "yd";
  if (raw === "miles") return "mi";
  if (raw === "kilometers") return "km";
  if (raw === "meters" || raw === "metres") return "m";
  if (raw === "seconds" || raw === "secs" || raw === "s") return "sec";
  return raw;
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function numberNearLabel(text: string, label: RegExp): RawMetric | null {
  const match = label.exec(text);
  if (!match || match.index == null) return null;

  const after = text.slice(match.index + match[0].length, match.index + match[0].length + 90);
  const numberPattern =
    /[-+]?\d[\d,]*(?:\.\d+)?\s*(?:%|km\/h|kph|kmh|mph|yards?|yds?|yd|miles?|mi|kilometers?|km|meters?|metres?|m|seconds?|secs?|sec|s)?/gi;
  const numberMatch =
    after.match(numberPattern)?.[0] ??
    text.slice(Math.max(0, match.index - 90), match.index).match(numberPattern)?.at(-1) ??
    null;
  if (!numberMatch) return null;

  const valueMatch = numberMatch.match(/[-+]?\d[\d,]*(?:\.\d+)?/);
  if (!valueMatch) return null;
  const value = parseNumber(valueMatch[0]);
  if (value === null) return null;

  return {
    value,
    unit: inferUnit(numberMatch || after),
    confidence: 0.75,
  };
}

function metricFromText(text: string, def: MetricDef): RawMetric {
  for (const label of def.labels) {
    const found = numberNearLabel(text, label);
    if (found) return found;
  }
  return blankMetric();
}

function metric(value: number | null, unit: string | null, confidence = 0.9): RawMetric {
  return value === null ? blankMetric() : { value, unit, confidence };
}

function metricFromMatch(
  text: string,
  pattern: RegExp,
  valueGroup = 1,
  unit: string | null = null,
  confidence = 0.9
): RawMetric | null {
  const match = text.match(pattern);
  if (!match) return null;
  const value = parseNumber(match[valueGroup] ?? "");
  if (value === null) return null;
  return metric(value, unit ?? inferUnit(match[0]), confidence);
}

function setIfFound(
  result: Omit<ExtractedPlayerStats, "warnings">,
  key: MetricKey,
  found: RawMetric | null
) {
  if (found?.value !== null && found?.value !== undefined) {
    result[key] = found;
  }
}

function setIfMissing(
  result: Omit<ExtractedPlayerStats, "warnings">,
  key: MetricKey,
  found: RawMetric | null
) {
  if (result[key].value === null) {
    setIfFound(result, key, found);
  }
}

function valuesWithUnit(text: string, unitPattern: string): number[] {
  return Array.from(
    text.matchAll(new RegExp(`(?:^|[^\\d.])(\\d+(?:\\.\\d+)?)\\s*${unitPattern}`, "gi"))
  )
    .map((match) => parseNumber(match[1] ?? ""))
    .filter((value): value is number => value !== null);
}

function truncateAtNextScreen(text: string) {
  const marker = text.slice(1).search(/\b(?:Skill\s+details|Two-footed|Dribbling|First\s+touch|Agility)\b/i);
  return marker >= 0 ? text.slice(0, marker + 1) : text;
}

function stripWorkRateValues(text: string) {
  return text.replace(
    /(?:Work\s+rate[\s\S]{0,120}?)?\d+(?:\.\d+)?\s*(?:yd|m)\s*(?:\/|per|i)?\s*m?in\b/gi,
    " "
  );
}

function unitValueMatches(text: string): Array<{ value: number; unit: string; index: number }> {
  const unitPattern = String.raw`(?:k\s*m\s*\/\s*h|km\/h|k\s*p\s*h|kph|k\s*m\s*h|kmh|m\s*p\s*h|mph|yards?|yds?|yd|miles?|mi|kilometers?|km|meters?|metres?|m)`;
  return Array.from(
    text.matchAll(new RegExp(`(?:^|[^\\d.])(\\d+(?:\\.\\d+)?)\\s*(${unitPattern})\\b`, "gi"))
  )
    .filter((match) => {
      const index = match.index ?? 0;
      const matched = match[0] ?? "";
      const unit = (match[2] ?? "").toLowerCase().replace(/\s+/g, "");
      const following = text.slice(index + matched.length, index + matched.length + 12);
      const around = text.slice(Math.max(0, index - 80), index + matched.length + 24);
      return (
        !(unit === "m" && /^\s*(?:\/|per|i)?\s*m?in\b/i.test(following)) &&
        !/work\s+rate/i.test(around)
      );
    })
    .map((match) => ({
      value: parseNumber(match[1] ?? ""),
      unit: inferUnit(match[2] ?? ""),
      index: match.index ?? 0,
    }))
    .filter((item): item is { value: number; unit: string; index: number } =>
      item.value !== null && item.unit !== null
    );
}

function yardValuesExcludingWorkRate(text: string): number[] {
  return Array.from(text.matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*yd\b/gi))
    .filter((match) => {
      const index = match.index ?? 0;
      const around = text.slice(Math.max(0, index - 80), index + match[0].length + 30);
      return !/work\s+rate/i.test(around) && !/yd\s*(?:\/|per|i)?\s*m?in\b/i.test(around);
    })
    .map((match) => parseNumber(match[1] ?? ""))
    .filter((value): value is number => value !== null);
}

function valuesNearLabel(text: string, label: RegExp, window = 260): number[] {
  const match = label.exec(text);
  if (!match || match.index == null) return [];

  const after = text.slice(match.index + match[0].length, match.index + match[0].length + window);
  return Array.from(after.matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)/g))
    .map((valueMatch) => parseNumber(valueMatch[1] ?? ""))
    .filter((value): value is number => value !== null);
}

function unitValuesNearLabel(
  text: string,
  label: RegExp,
  unitPattern: string,
  window = 260
): Array<{ value: number; unit: string | null }> {
  const match = label.exec(text);
  if (!match || match.index == null) return [];

  const after = text.slice(match.index + match[0].length, match.index + match[0].length + window);
  return Array.from(
    after.matchAll(new RegExp(`(?:^|[^\\d.])(\\d+(?:\\.\\d+)?)\\s*(${unitPattern})\\b`, "gi"))
  )
    .filter((valueMatch) => {
      const index = valueMatch.index ?? 0;
      const matched = valueMatch[0] ?? "";
      const unit = (valueMatch[2] ?? "").toLowerCase().replace(/\s+/g, "");
      const following = after.slice(index + matched.length, index + matched.length + 12);
      return !(unit === "m" && /^\s*(?:\/|per|i)?\s*m?in\b/i.test(following));
    })
    .map((valueMatch) => ({
      value: parseNumber(valueMatch[1] ?? ""),
      unit: inferUnit(valueMatch[2] ?? ""),
    }))
    .filter((item): item is { value: number; unit: string | null } => item.value !== null);
}

function numberMatches(text: string) {
  return Array.from(text.matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)/g))
    .map((match) => ({
      value: parseNumber(match[1] ?? ""),
      text: match[0],
      index: match.index ?? 0,
    }))
    .filter((item): item is { value: number; text: string; index: number } => item.value !== null);
}

function unitNear(text: string, index: number): string | null {
  return inferUnit(text.slice(Math.max(0, index - 8), index + 18));
}

function twoFootedKickingPowerFallback(text: string): {
  left: RawMetric;
  right: RawMetric;
} | null {
  const labelMatches = Array.from(text.matchAll(/Kicking\s+power/gi)).reverse();

  for (const labelMatch of labelMatches) {
    if (labelMatch.index == null) continue;

    const labelIndex = labelMatch.index;
    const before = text.slice(Math.max(0, labelIndex - 190), labelIndex);
    const after = text.slice(labelIndex + labelMatch[0].length, labelIndex + labelMatch[0].length + 190);
    const beforeSpeedValues = unitValueMatches(before).filter((item) =>
      ["mph", "kph", "km/h", "kmh"].includes(item.unit)
    );
    const afterSpeedValues = unitValueMatches(after).filter((item) =>
      ["mph", "kph", "km/h", "kmh"].includes(item.unit)
    );

    if (beforeSpeedValues.length && afterSpeedValues.length) {
      const left = beforeSpeedValues.at(-1)!;
      const right = afterSpeedValues[0];
      return {
        left: metric(left.value, left.unit),
        right: metric(right.value, right.unit),
      };
    }

    const beforeValues = numberMatches(before)
      .filter((item) => item.value >= 10 && item.value <= 140)
      .map((item) => ({
        ...item,
        unit: unitNear(before, item.index) ?? inferUnit(before.slice(item.index, item.index + 24)),
        hasDecimal: item.text.includes("."),
      }));
    const afterValues = numberMatches(after)
      .filter((item) => item.value >= 10 && item.value <= 140)
      .map((item) => ({
        ...item,
        unit: unitNear(after, item.index) ?? inferUnit(after.slice(item.index, item.index + 24)),
        hasDecimal: item.text.includes("."),
      }));

    const leftCandidates = beforeValues.filter((item) => item.unit || item.hasDecimal);
    const rightCandidates = afterValues.filter((item) => item.unit || item.hasDecimal);
    const left = leftCandidates.at(-1) ?? beforeValues.at(-1);
    const right = rightCandidates[0] ?? afterValues[0];

    if (left && right) {
      return {
        left: metric(left.value, left.unit ?? right.unit ?? "mph"),
        right: metric(right.value, right.unit ?? left.unit ?? "mph"),
      };
    }
  }

  return null;
}

function applyDribblingLayout(
  text: string,
  result: Omit<ExtractedPlayerStats, "warnings">
) {
  const dribblingStarts = Array.from(text.matchAll(/\bDribbling\b/gi)).map(
    (match) => match.index ?? -1
  );
  const dribblingStart =
    dribblingStarts.find((index) => index >= 0 && /Distance\s+with\s+(?:the\s+)?ball/i.test(text.slice(index, index + 900))) ??
    dribblingStarts.find((index) => index >= 0) ??
    -1;
  const section = dribblingStart >= 0 ? text.slice(dribblingStart, dribblingStart + 900) : text;

  const distanceWithBallMatch = section.match(
    /Distance\s+with\s+(?:the\s+)?ball[\s\S]{0,120}?(\d+(?:\.\d+)?)\s*(yd|yards?|m)\b/i
  );
  if (distanceWithBallMatch) {
    setIfFound(
      result,
      "distance_with_ball",
      metric(
        parseNumber(distanceWithBallMatch[1] ?? ""),
        inferUnit(distanceWithBallMatch[2] ?? "")
      )
    );
  }
  setIfFound(
    result,
    "top_speed_with_ball",
    metricFromMatch(
      section,
      new RegExp(
        `Top\\s+speed\\s+with\\s+(?:the\\s+)?ball[\\s\\S]{0,120}?(\\d+(?:\\.\\d+)?)\\s*(${SPEED_UNIT_PATTERN})\\b`,
        "i"
      )
    )
  );
  setIfFound(
    result,
    "intense_turns_with_ball",
    metricFromMatch(
      section,
      /Intense\s+turns?\s+with\s+(?:the\s+)?ball[\s\S]{0,120}?(\d+(?:\.\d+)?)\s*#?/i
    )
  );
}

function metricFromRowLabel(
  text: string,
  label: string,
  unitPattern: string | null,
  unit: string | null,
  window = 160
): RawMetric | null {
  const labelThenValue = new RegExp(
    `${label}[\\s\\S]{0,${window}}?(\\d+(?:\\.\\d+)?)\\s*${unitPattern ?? "#?"}`,
    "i"
  );
  const valueThenLabel = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*${unitPattern ?? "#?"}[\\s\\S]{0,${window}}?${label}`,
    "i"
  );
  return (
    metricFromMatch(text, labelThenValue, 1, unit) ??
    metricFromMatch(text, valueThenLabel, 1, unit)
  );
}

function applyFirstTouchLayout(
  text: string,
  result: Omit<ExtractedPlayerStats, "warnings">
) {
  setIfFound(
    result,
    "total_ball_possessions",
    metricFromMatch(text, /Ball\s+possessions[\s\S]{0,120}?Total:\s*(\d+(?:\.\d+)?)\s*#?/i)
  );
  setIfFound(
    result,
    "one_touch_possessions_count",
    metricFromMatch(
      text,
      /One\s+Touch[\s\S]{0,160}?(\d+(?:\.\d+)?)\s*#?[\s\S]{0,45}?Count/i
    )
  );
  setIfFound(
    result,
    "multi_touch_possessions_count",
    metricFromMatch(
      text,
      /Multiple\s+touch[\s\S]{0,160}?(\d+(?:\.\d+)?)\s*#?[\s\S]{0,45}?Count/i
    )
  );
  setIfFound(
    result,
    "possession_duration_seconds",
    metricFromMatch(
      text,
      /(\d+(?:\.\d+)?)\s*(?:sec|seconds?)\.?[\s\S]{0,45}?Total\s+Duration/i,
      1,
      "sec"
    )
  );
  setIfFound(
    result,
    "release_laces_count",
    metricFromMatch(text, /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*#?\s*Laces/i)
  );
  setIfFound(
    result,
    "release_inside_foot_count",
    metricFromMatch(text, /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*#?\s*Inside/i)
  );
  setIfFound(
    result,
    "release_other_footzone_count",
    metricFromMatch(text, /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*#?\s*Other/i)
  );
}

function applyHighlightsLayout(
  text: string,
  result: Omit<ExtractedPlayerStats, "warnings">
) {
  const highlightsStart = text.search(/Highlights/i);
  const rawHighlightsSection =
    highlightsStart >= 0 ? truncateAtNextScreen(text.slice(highlightsStart, highlightsStart + 1400)) : text;
  const highlightsSection = stripWorkRateValues(rawHighlightsSection);

  const miValues = valuesWithUnit(highlightsSection, "mi\\b");
  const sprintYdValues = yardValuesExcludingWorkRate(highlightsSection);
  const highlightUnitValues = unitValueMatches(highlightsSection);
  const distanceUnitValues = highlightUnitValues.filter((item) =>
    ["mi", "km", "m", "yd"].includes(item.unit)
  );
  const orderedTotalDistance = distanceUnitValues.find((item) =>
    ["mi", "km"].includes(item.unit)
  );
  const orderedSprintDistance = distanceUnitValues.find((item) =>
    item !== orderedTotalDistance && ["yd", "m"].includes(item.unit) && item.value >= 100
  );
  const speedPowerValues = Array.from(
    highlightsSection.matchAll(
      new RegExp(`(?:^|[^\\d.])(\\d+(?:\\.\\d+)?)\\s*(${SPEED_UNIT_PATTERN})\\b`, "gi")
    )
  )
    .map((match) => ({
      value: parseNumber(match[1] ?? ""),
      unit: inferUnit(match[2] ?? ""),
    }))
    .filter((item): item is { value: number; unit: string } => item.value !== null && item.unit !== null);

  const totalDistanceNearLabel = unitValuesNearLabel(
    highlightsSection,
    /Total\s+distance/i,
    String.raw`(?:mi|km|m(?!\s*(?:\/|per|i)?\s*m?in\b))`,
    220
  ).filter((item) => item.value > 0);
  if (orderedTotalDistance) {
    setIfFound(
      result,
      "total_distance",
      metric(orderedTotalDistance.value, orderedTotalDistance.unit)
    );
  } else if (totalDistanceNearLabel.length) {
    const found = totalDistanceNearLabel[0];
    setIfFound(result, "total_distance", metric(found.value, found.unit));
  } else if (miValues.length) {
    setIfFound(result, "total_distance", metric(miValues[0], "mi"));
  }
  if (orderedSprintDistance) {
    setIfFound(
      result,
      "sprint_distance",
      metric(orderedSprintDistance.value, orderedSprintDistance.unit)
    );
  }
  const sprintDistanceNearLabel = unitValuesNearLabel(
    highlightsSection,
    /Sprint\s+distance/i,
    String.raw`(?:yd|yards?|m(?!\s*(?:\/|per|i)?\s*m?in\b))`,
    260
  ).filter((item) => item.value >= 150);
  if (!orderedSprintDistance && sprintDistanceNearLabel.length) {
    const found = sprintDistanceNearLabel[0];
    setIfFound(
      result,
      "sprint_distance",
      metric(found.value, found.unit)
    );
  }
  const sprintDistanceRow = metricFromRowLabel(
    highlightsSection,
    "Sprint\\s+distance",
    "yd\\b",
    "yd",
    220
  );
  if (sprintDistanceRow?.value !== null && sprintDistanceRow?.value !== undefined) {
    setIfFound(result, "sprint_distance", sprintDistanceRow);
  }
  if (!orderedSprintDistance && !sprintDistanceNearLabel.length && sprintYdValues.length) {
    const plausibleSprintDistances = sprintYdValues.filter((value) => value >= 150);
    setIfFound(
      result,
      "sprint_distance",
      metric(
        plausibleSprintDistances.length
          ? Math.max(...plausibleSprintDistances)
          : Math.max(...sprintYdValues),
        "yd"
      )
    );
  }
  if (speedPowerValues.length >= 1) {
    setIfFound(result, "top_speed", metric(speedPowerValues[0].value, speedPowerValues[0].unit));
  }
  if (speedPowerValues.length >= 2) {
    const strongestSpeedPower = speedPowerValues.reduce((max, current) =>
      current.value > max.value ? current : max
    );
    setIfFound(result, "kicking_power", metric(strongestSpeedPower.value, strongestSpeedPower.unit));
  }

  setIfFound(
    result,
    "ball_possessions",
    metricFromMatch(
      highlightsSection,
      /Ball\s+possessions\s+(\d+(?:\.\d+)?)\s*#?/i
    ) ??
      metricFromMatch(
        highlightsSection,
        /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*#?\s+Ball\s+possessions/i
      )
  );
  if (result.ball_possessions.value === null || result.ball_possessions.value > 90) {
    const highlightCounts = Array.from(
      highlightsSection.matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*#/g)
    )
      .map((match) => parseNumber(match[1] ?? ""))
      .filter((value): value is number => value !== null);
    if (highlightCounts.length) {
      setIfFound(result, "ball_possessions", metric(highlightCounts[0], null));
    }
  }

  setIfMissing(
    result,
    "total_distance",
    metricFromMatch(text, /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*mi\b/i, 1, "mi")
  );
  setIfMissing(
    result,
    "sprint_distance",
    metricFromMatch(stripWorkRateValues(text), /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*yd\b/i, 1, "yd")
  );

  const metricRows: Array<{
    key: MetricKey;
    label: string;
    unit: string | null;
  }> = [
    { key: "ball_possessions", label: "Ball\\s+possessions", unit: null },
  ];

  for (const row of metricRows) {
    const labelThenValue = new RegExp(
      `${row.label}\\s+(\\d+(?:\\.\\d+)?)\\s*(?:#|mi|yd|mph)?`,
      "i"
    );
    const valueThenLabel = new RegExp(
      `(\\d+(?:\\.\\d+)?)\\s*(?:#|mi|yd|mph)?\\s+${row.label}`,
      "i"
    );
    setIfMissing(
      result,
      row.key,
      metricFromMatch(text, labelThenValue, 1, row.unit) ??
        metricFromMatch(text, valueThenLabel, 1, row.unit)
    );
  }
}

function applySpeedLayout(
  text: string,
  result: Omit<ExtractedPlayerStats, "warnings">
) {
  const speedStarts = Array.from(text.matchAll(/\bSpeed\b/gi)).map(
    (match) => match.index ?? -1
  );
  const speedStart =
    speedStarts.find((index) => index >= 0 && /Sprints?/i.test(text.slice(index, index + 620))) ??
    speedStarts.find((index) => index >= 0) ??
    -1;
  const speedSection = speedStart >= 0 ? text.slice(speedStart, speedStart + 620) : text;
  setIfFound(
    result,
    "top_speed",
    metricFromMatch(
      speedSection,
      new RegExp(`Top\\s+speed\\s+(\\d+(?:\\.\\d+)?)\\s*${SPEED_UNIT_PATTERN}`, "i"),
      1
    ) ??
      metricFromMatch(
        speedSection,
        new RegExp(`(?:^|[^\\d.])(\\d+(?:\\.\\d+)?)\\s*${SPEED_UNIT_PATTERN}\\s+Top\\s+speed`, "i"),
        1
      )
  );
  const sprintsRow = metricFromRowLabel(speedSection, "\\bSprints\\b", "#?", null, 80);
  if (
    sprintsRow?.value !== null &&
    sprintsRow?.value !== undefined &&
    sprintsRow.value > 0 &&
    sprintsRow.value <= 100
  ) {
    setIfFound(result, "sprints", sprintsRow);
  }

  const speedSections = speedStarts
    .filter((index) => index >= 0)
    .map((index) => text.slice(index, index + 700));
  const candidates = speedSections
    .map((section) => metricFromRowLabel(section, "\\bSprints\\b", "#?", null, 100))
    .filter(
      (candidate): candidate is RawMetric =>
        candidate?.value !== null &&
        candidate?.value !== undefined &&
        candidate.value > 0 &&
        candidate.value <= 100
    );
  const best = candidates.length
    ? candidates.reduce((max, candidate) =>
        (candidate.value ?? 0) > (max.value ?? 0) ? candidate : max
      )
    : null;
  if (
    best &&
    (result.sprints.value === null ||
      result.sprints.value > 100 ||
      best.value! > result.sprints.value)
  ) {
    setIfFound(result, "sprints", best);
  }
}

function applyPowerLayout(
  text: string,
  result: Omit<ExtractedPlayerStats, "warnings">
) {
  const beforeLabelMatch = text.match(
    /(\d+(?:\.\d+)?)\s*#?\s*First\s+step\s+accelerations?[\s\S]{0,120}?(\d+(?:\.\d+)?)\s*#?\s*Intense\s+accelerations?/i
  );
  const afterLabelMatch = text.match(
    /First\s+step\s+accelerations?\s*(\d+(?:\.\d+)?)\s*#?[\s\S]{0,120}?Intense\s+accelerations?\s*(\d+(?:\.\d+)?)\s*#?/i
  );
  const match = beforeLabelMatch ?? afterLabelMatch;
  if (!match) return;

  setIfFound(result, "first_step_accelerations", metric(parseNumber(match[1] ?? ""), null));
  setIfFound(result, "intense_accelerations", metric(parseNumber(match[2] ?? ""), null));
}

function applyReleaseFootzoneLayout(
  text: string,
  result: Omit<ExtractedPlayerStats, "warnings">
) {
  const sectionStart = text.search(/Ball\s+release\s+footzone/i);
  if (sectionStart >= 0) {
    const section = text.slice(sectionStart, sectionStart + 360);
    if (/Laces/i.test(section) && /Inside/i.test(section) && /Other/i.test(section)) {
      const values = Array.from(section.matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*#?/g))
        .map((match) => parseNumber(match[1] ?? ""))
        .filter((value): value is number => value !== null);
      const counts = values.length >= 4 ? values.slice(1, 4) : values.slice(0, 3);
      if (counts.length === 3) {
        setIfFound(result, "release_laces_count", metric(counts[0], null));
        setIfFound(result, "release_inside_foot_count", metric(counts[1], null));
        setIfFound(result, "release_other_footzone_count", metric(counts[2], null));
        return;
      }
    }
  }

  const beforeLabelMatch = text.match(
    /Ball\s+release\s+footzone[\s\S]{0,120}?Total:\s*\d+(?:\.\d+)?\s*#?[\s\S]{0,120}?(\d+(?:\.\d+)?)\s*#?\s*Laces[\s\S]{0,120}?(\d+(?:\.\d+)?)\s*#?\s*Inside[\s\S]{0,120}?(\d+(?:\.\d+)?)\s*#?\s*Other/i
  );
  const afterLabelMatch = text.match(
    /Ball\s+release\s+footzone[\s\S]{0,120}?Total:\s*\d+(?:\.\d+)?\s*#?[\s\S]{0,120}?Laces\s+(\d+(?:\.\d+)?)\s*#?[\s\S]{0,120}?Inside\s+(\d+(?:\.\d+)?)\s*#?[\s\S]{0,120}?Other\s+(\d+(?:\.\d+)?)\s*#?/i
  );
  const match = beforeLabelMatch ?? afterLabelMatch;
  if (!match) return;

  setIfFound(result, "release_laces_count", metric(parseNumber(match[1] ?? ""), null));
  setIfFound(result, "release_inside_foot_count", metric(parseNumber(match[2] ?? ""), null));
  setIfFound(result, "release_other_footzone_count", metric(parseNumber(match[3] ?? ""), null));
}

function applyAgilityLayout(
  text: string,
  result: Omit<ExtractedPlayerStats, "warnings">
) {
  const beforeLabelTurnsMatch = text.match(
    /(\d+(?:\.\d+)?)\s*Left\s+turns?[\s\S]{0,90}?(\d+(?:\.\d+)?)\s*Back\s+turns?[\s\S]{0,90}?(\d+(?:\.\d+)?)\s*Right\s+turns?/i
  );
  const afterLabelTurnsMatch = text.match(
    /Left\s+turns?\s*(\d+(?:\.\d+)?)\s*#?[\s\S]{0,90}?Back\s+turns?\s*(\d+(?:\.\d+)?)\s*#?[\s\S]{0,90}?Right\s+turns?\s*(\d+(?:\.\d+)?)\s*#?/i
  );
  const turnsMatch = beforeLabelTurnsMatch ?? afterLabelTurnsMatch;
  if (turnsMatch) {
    setIfFound(result, "left_turns", metric(parseNumber(turnsMatch[1] ?? ""), null));
    setIfFound(result, "back_turns", metric(parseNumber(turnsMatch[2] ?? ""), null));
    setIfFound(result, "right_turns", metric(parseNumber(turnsMatch[3] ?? ""), null));
  }

  setIfFound(
    result,
    "intense_turns",
    metricFromMatch(text, /Intense\s+turns?\s+(\d+(?:\.\d+)?)\s*#?/i)
  );
  setIfFound(
    result,
    "avg_turn_entry_speed",
    metricFromMatch(
      text,
      new RegExp(`Average\\s+turn\\s+entry\\s+speed\\s+(\\d+(?:\\.\\d+)?)\\s*${SPEED_UNIT_PATTERN}`, "i"),
      1
    )
  );
  setIfFound(
    result,
    "avg_turn_exit_speed",
    metricFromMatch(
      text,
      new RegExp(`Average\\s+turn\\s+exit\\s+speed\\s+(\\d+(?:\\.\\d+)?)\\s*${SPEED_UNIT_PATTERN}`, "i"),
      1
    )
  );
}

function applyTwoFootedLayout(
  text: string,
  result: Omit<ExtractedPlayerStats, "warnings">
) {
  const touchMatch = text.match(
    /Left\s+Foot[\s\S]{0,240}?(\d+(?:\.\d+)?)\s*\((\d+(?:\.\d+)?)%\)\s*Touch\s+(\d+(?:\.\d+)?)\s*\((\d+(?:\.\d+)?)%\)/i
  );
  if (touchMatch) {
    setIfFound(result, "left_foot_touch_percentage", metric(parseNumber(touchMatch[2] ?? ""), "%"));
    setIfFound(result, "right_foot_touch_percentage", metric(parseNumber(touchMatch[4] ?? ""), "%"));
  }

  const releaseMatch = text.match(
    /Touch[\s\S]{0,220}(\d+(?:\.\d+)?)\s*\((\d+(?:\.\d+)?)%\)\s*Release\s+(\d+(?:\.\d+)?)\s*\((\d+(?:\.\d+)?)%\)/i
  );
  if (releaseMatch) {
    setIfFound(result, "left_foot_release_percentage", metric(parseNumber(releaseMatch[2] ?? ""), "%"));
    setIfFound(result, "right_foot_release_percentage", metric(parseNumber(releaseMatch[4] ?? ""), "%"));
  }

  const receiveMatch = text.match(
    /Release[\s\S]{0,220}(\d+(?:\.\d+)?)\s*\((\d+(?:\.\d+)?)%\)\s*Receive\s+(\d+(?:\.\d+)?)\s*\((\d+(?:\.\d+)?)%\)/i
  );
  if (receiveMatch) {
    setIfFound(result, "left_foot_receive_percentage", metric(parseNumber(receiveMatch[2] ?? ""), "%"));
    setIfFound(result, "right_foot_receive_percentage", metric(parseNumber(receiveMatch[4] ?? ""), "%"));
  }

  let foundKickingPower = false;
  const kickingPowerMatch = text.match(
    new RegExp(
      `Receive[\\s\\S]{0,260}(\\d+(?:\\.\\d+)?)\\s*(${SPEED_UNIT_PATTERN})\\s*Kicking\\s+power\\s+(\\d+(?:\\.\\d+)?)\\s*(${SPEED_UNIT_PATTERN})`,
      "i"
    )
  );
  if (kickingPowerMatch) {
    const leftPower = parseNumber(kickingPowerMatch[1] ?? "");
    const rightPower = parseNumber(kickingPowerMatch[3] ?? "");
    if (
      leftPower !== null &&
      rightPower !== null &&
      leftPower >= 10 &&
      rightPower >= 10
    ) {
      setIfFound(result, "left_foot_kicking_power", metric(leftPower, inferUnit(kickingPowerMatch[2] ?? "") ?? "mph"));
      setIfFound(result, "right_foot_kicking_power", metric(rightPower, inferUnit(kickingPowerMatch[4] ?? "") ?? "mph"));
      foundKickingPower = true;
    }
  }

  if (!foundKickingPower) {
    const twoFootedStart = text.search(/Two-footed|Left\s+Foot/i);
    let twoFootedSection =
      twoFootedStart >= 0 ? text.slice(twoFootedStart, twoFootedStart + 1200) : text;
    const firstTouchAfter = twoFootedSection.search(/Ball\s+possessions|One\s+Touch/i);
    if (firstTouchAfter > 0) {
      twoFootedSection = twoFootedSection.slice(0, firstTouchAfter);
    }
    const kickingPowerIndex = twoFootedSection.search(/Kicking\s+power/i);
    const kickingPowerWindow =
      kickingPowerIndex >= 0
        ? twoFootedSection.slice(Math.max(0, kickingPowerIndex - 180), kickingPowerIndex + 180)
        : twoFootedSection;
    const speedValues = Array.from(
      kickingPowerWindow.matchAll(
        new RegExp(`(?:^|[^\\d.])(\\d+(?:\\.\\d+)?)\\s*(${SPEED_UNIT_PATTERN})\\b`, "gi")
      )
    )
      .map((match) => ({
        value: parseNumber(match[1] ?? ""),
        unit: inferUnit(match[2] ?? "") ?? "mph",
      }))
      .filter((item): item is { value: number; unit: string } => item.value !== null);
    if (speedValues.length >= 2) {
      const powers = speedValues.slice(-2);
      setIfFound(result, "left_foot_kicking_power", metric(powers[0].value, powers[0].unit));
      setIfFound(result, "right_foot_kicking_power", metric(powers[1].value, powers[1].unit));
      foundKickingPower = true;
    }
  }

  if (!foundKickingPower) {
    const twoFootedStart = text.search(/Two-footed|Left\s+Foot/i);
    let twoFootedSection =
      twoFootedStart >= 0 ? text.slice(twoFootedStart, twoFootedStart + 1300) : text;
    const firstTouchAfter = twoFootedSection.search(/Ball\s+possessions|One\s+Touch/i);
    if (firstTouchAfter > 0) {
      twoFootedSection = twoFootedSection.slice(0, firstTouchAfter);
    }
    const fallback = twoFootedKickingPowerFallback(twoFootedSection);
    if (fallback) {
      setIfFound(result, "left_foot_kicking_power", fallback.left);
      setIfFound(result, "right_foot_kicking_power", fallback.right);
      foundKickingPower = true;
    }
  }

  if (touchMatch || releaseMatch || receiveMatch || foundKickingPower) {
    return;
  }

  const exactRowsMatch = text.match(
    new RegExp(
      `(\\d+(?:\\.\\d+)?)\\s*\\((\\d+(?:\\.\\d+)?)%\\)\\s*Touch\\s+(\\d+(?:\\.\\d+)?)\\s*\\((\\d+(?:\\.\\d+)?)%\\)[\\s\\S]{0,160}?(\\d+(?:\\.\\d+)?)\\s*\\((\\d+(?:\\.\\d+)?)%\\)\\s*Release\\s+(\\d+(?:\\.\\d+)?)\\s*\\((\\d+(?:\\.\\d+)?)%\\)[\\s\\S]{0,160}?(\\d+(?:\\.\\d+)?)\\s*\\((\\d+(?:\\.\\d+)?)%\\)\\s*Receive\\s+(\\d+(?:\\.\\d+)?)\\s*\\((\\d+(?:\\.\\d+)?)%\\)[\\s\\S]{0,180}?(\\d+(?:\\.\\d+)?)\\s*(${SPEED_UNIT_PATTERN})\\s*Kicking\\s+power\\s+(\\d+(?:\\.\\d+)?)\\s*(${SPEED_UNIT_PATTERN})`,
      "i"
    )
  );
  if (exactRowsMatch) {
    setIfFound(result, "left_foot_touch_percentage", metric(parseNumber(exactRowsMatch[2] ?? ""), "%"));
    setIfFound(result, "right_foot_touch_percentage", metric(parseNumber(exactRowsMatch[4] ?? ""), "%"));
    setIfFound(result, "left_foot_release_percentage", metric(parseNumber(exactRowsMatch[6] ?? ""), "%"));
    setIfFound(result, "right_foot_release_percentage", metric(parseNumber(exactRowsMatch[8] ?? ""), "%"));
    setIfFound(result, "left_foot_receive_percentage", metric(parseNumber(exactRowsMatch[10] ?? ""), "%"));
    setIfFound(result, "right_foot_receive_percentage", metric(parseNumber(exactRowsMatch[12] ?? ""), "%"));
    setIfFound(result, "left_foot_kicking_power", metric(parseNumber(exactRowsMatch[13] ?? ""), inferUnit(exactRowsMatch[14] ?? "") ?? "mph"));
    setIfFound(result, "right_foot_kicking_power", metric(parseNumber(exactRowsMatch[15] ?? ""), inferUnit(exactRowsMatch[16] ?? "") ?? "mph"));
    return;
  }

  const pairedRows: Array<{
    label: string;
    leftKey: MetricKey;
    rightKey: MetricKey;
    unit: string | null;
  }> = [
    {
      label: "Touch",
      leftKey: "left_foot_touch_percentage",
      rightKey: "right_foot_touch_percentage",
      unit: "%",
    },
    {
      label: "Release",
      leftKey: "left_foot_release_percentage",
      rightKey: "right_foot_release_percentage",
      unit: "%",
    },
    {
      label: "Receive",
      leftKey: "left_foot_receive_percentage",
      rightKey: "right_foot_receive_percentage",
      unit: "%",
    },
    {
      label: "Kicking\\s+power",
      leftKey: "left_foot_kicking_power",
      rightKey: "right_foot_kicking_power",
      unit: "mph",
    },
  ];

  for (const row of pairedRows) {
    const isPercent = row.unit === "%";
    const guard = "(?:(?!Touch|Release|Receive|Kicking\\s+power)[\\s\\S])";
    const pattern = isPercent
      ? new RegExp(
          `(\\d+(?:\\.\\d+)?)\\s*\\((\\d+(?:\\.\\d+)?)%\\)${guard}{0,80}?${row.label}${guard}{0,80}?(\\d+(?:\\.\\d+)?)\\s*\\((\\d+(?:\\.\\d+)?)%\\)`,
          "i"
        )
      : new RegExp(
          `(\\d+(?:\\.\\d+)?)\\s*(${SPEED_UNIT_PATTERN})${guard}{0,80}?${row.label}${guard}{0,80}?(\\d+(?:\\.\\d+)?)\\s*(${SPEED_UNIT_PATTERN})`,
          "i"
        );
    const match = text.match(pattern);
    if (!match) continue;

    if (isPercent) {
      setIfFound(result, row.leftKey, metric(parseNumber(match[2] ?? ""), "%"));
      setIfFound(result, row.rightKey, metric(parseNumber(match[4] ?? ""), "%"));
    } else {
      setIfFound(result, row.leftKey, metric(parseNumber(match[1] ?? ""), inferUnit(match[2] ?? "") ?? "mph"));
      setIfFound(result, row.rightKey, metric(parseNumber(match[3] ?? ""), inferUnit(match[4] ?? "") ?? "mph"));
    }
  }
}

function applyFinalPlayermakerCorrections(
  text: string,
  result: Omit<ExtractedPlayerStats, "warnings">
) {
  const cleanText = stripWorkRateValues(text);
  const highlightsStart = cleanText.search(/Highlights/i);
  const highlightsSection =
    highlightsStart >= 0 ? truncateAtNextScreen(cleanText.slice(highlightsStart, highlightsStart + 1400)) : cleanText;
  const highlightUnitValues = unitValueMatches(highlightsSection);
  const distanceUnitValues = highlightUnitValues.filter((item) =>
    ["mi", "km", "m", "yd"].includes(item.unit)
  );
  const orderedTotalDistance = distanceUnitValues.find((item) =>
    ["mi", "km"].includes(item.unit)
  );
  const orderedSprintDistance = distanceUnitValues.find((item) =>
    item !== orderedTotalDistance && ["yd", "m"].includes(item.unit) && item.value >= 100
  );
  if (orderedTotalDistance) {
    setIfFound(
      result,
      "total_distance",
      metric(orderedTotalDistance.value, orderedTotalDistance.unit)
    );
  }
  const sprintDistanceNearLabel = valuesNearLabel(
    highlightsSection,
    /Sprint\s+distance/i,
    260
  ).filter((value) => value >= 150);
  const sprintDistanceUnitNearLabel = unitValuesNearLabel(
    highlightsSection,
    /Sprint\s+distance/i,
    String.raw`(?:yd|yards?|m(?!\s*(?:\/|per|i)?\s*m?in\b))`,
    260
  ).filter((item) => item.value >= 150);
  const yardValues = yardValuesExcludingWorkRate(highlightsSection).filter((value) => value >= 150);
  if (orderedSprintDistance) {
    setIfFound(
      result,
      "sprint_distance",
      metric(orderedSprintDistance.value, orderedSprintDistance.unit)
    );
  } else if (sprintDistanceUnitNearLabel.length) {
    const found = sprintDistanceUnitNearLabel[0];
    setIfFound(result, "sprint_distance", metric(found.value, found.unit));
  } else {
    const sprintDistanceValues = sprintDistanceNearLabel.length
      ? sprintDistanceNearLabel
      : yardValues;
    if (sprintDistanceValues.length) {
      setIfFound(result, "sprint_distance", metric(Math.max(...sprintDistanceValues), "yd"));
    }
  }

  const speedPowerValues = Array.from(
    highlightsSection.matchAll(
      new RegExp(`(?:^|[^\\d.])(\\d+(?:\\.\\d+)?)\\s*(${SPEED_UNIT_PATTERN})\\b`, "gi")
    )
  )
    .map((match) => ({
      value: parseNumber(match[1] ?? ""),
      unit: inferUnit(match[2] ?? ""),
    }))
    .filter((item): item is { value: number; unit: string } => item.value !== null && item.unit !== null);
  if (speedPowerValues.length >= 2) {
    const strongestSpeedPower = speedPowerValues.reduce((max, current) =>
      current.value > max.value ? current : max
    );
    setIfFound(result, "kicking_power", metric(strongestSpeedPower.value, strongestSpeedPower.unit));
  }

  const speedSections = Array.from(cleanText.matchAll(/\bSpeed\b/gi))
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0)
    .map((index) => cleanText.slice(index, index + 700));
  const sprintCandidates = speedSections
    .map((section) => metricFromRowLabel(section, "\\bSprints\\b", "#?", null, 100))
    .filter(
      (candidate): candidate is RawMetric =>
        candidate?.value !== null &&
        candidate?.value !== undefined &&
        candidate.value > 0 &&
        candidate.value <= 100
    );
  if (sprintCandidates.length) {
    const bestSprints = sprintCandidates.reduce((max, candidate) =>
      (candidate.value ?? 0) > (max.value ?? 0) ? candidate : max
    );
    setIfFound(result, "sprints", bestSprints);
  }

  if (
    result.left_foot_kicking_power.value === null ||
    result.right_foot_kicking_power.value === null
  ) {
    const fallback = twoFootedKickingPowerFallback(cleanText);
    if (fallback) {
      setIfFound(result, "left_foot_kicking_power", fallback.left);
      setIfFound(result, "right_foot_kicking_power", fallback.right);
    }
  }
}

function ensureDurationSeconds(metric: RawMetric): RawMetric {
  if (metric.value === null) return metric;
  const unit = metric.unit?.toLowerCase() ?? null;
  if (unit === "min" || unit === "minute" || unit === "minutes") {
    return { ...metric, value: metric.value * 60, unit: "sec" };
  }
  return metric;
}

function parseExtractedStats(text: string): ExtractedPlayerStats {
  const normalized = normalizeWhitespace(text);
  const result = Object.fromEntries(ALL_KEYS.map((key) => [key, blankMetric()])) as Omit<
    ExtractedPlayerStats,
    "warnings"
  >;

  for (const def of METRIC_DEFS) {
    result[def.key] = metricFromText(normalized, def);
  }

  applyHighlightsLayout(normalized, result);
  applyFirstTouchLayout(normalized, result);
  applyReleaseFootzoneLayout(normalized, result);
  applyPowerLayout(normalized, result);
  applySpeedLayout(normalized, result);
  applyAgilityLayout(normalized, result);
  applyDribblingLayout(normalized, result);
  applyTwoFootedLayout(normalized, result);
  applyFinalPlayermakerCorrections(normalized, result);

  result.possession_duration_seconds = ensureDurationSeconds(
    result.possession_duration_seconds
  );

  const warnings = METRIC_DEFS.filter((def) => result[def.key].value === null).map(
    (def) => `${def.warningLabel} not found.`
  );

  return { ...result, warnings };
}

function buildOcrForm(file: PlayerStatsImageUpload, apiKey: string) {
  const form = new FormData();
  form.append("apikey", apiKey);
  form.append("language", "eng");
  form.append("OCREngine", process.env.OCR_SPACE_ENGINE?.trim() || "3");
  form.append("scale", "true");
  form.append("isTable", "false");
  form.append(
    "file",
    new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
    file.originalname
  );
  return form;
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1000;
  }
  return OCR_RETRY_BASE_MS * attempt;
}

async function requestOcr(file: PlayerStatsImageUpload, apiKey: string) {
  for (let attempt = 1; attempt <= OCR_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(OCR_SPACE_ENDPOINT, {
        method: "POST",
        body: buildOcrForm(file, apiKey),
      });
    } catch {
      throw new BadGatewayException(
        "OCR.space request failed before returning a response."
      );
    }

    if (response.status === 429 && attempt < OCR_MAX_ATTEMPTS) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }

    return response;
  }

  throw new ServiceUnavailableException(
    "OCR.space rate limit or quota was reached. Wait a few minutes and retry fewer images, or check the configured OCR.space account."
  );
}

async function ocrOneImage(file: PlayerStatsImageUpload): Promise<string> {
  const apiKey = process.env.OCR_SPACE_API_KEY?.trim();
  if (!apiKey) {
    throw new ServiceUnavailableException(
      "OCR_SPACE_API_KEY is not configured on the API server."
    );
  }

  const response = await requestOcr(file, apiKey);

  if (response.status === 429) {
    throw new ServiceUnavailableException(
      "OCR.space rate limit or quota was reached. Wait a few minutes and retry fewer images, or check the configured OCR.space account."
    );
  }
  if (!response.ok) {
    throw new BadGatewayException(`OCR.space request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as OcrSpaceResponse;
  const message =
    parseErrorMessage(payload.ErrorMessage) ||
    payload.ErrorDetails ||
    parseErrorMessage(payload.ParsedResults?.[0]?.ErrorMessage);
  if (payload.IsErroredOnProcessing || message) {
    throw new BadGatewayException(`OCR.space failed to process an image: ${message}`);
  }

  return (payload.ParsedResults ?? [])
    .map((row) => row.ParsedText ?? "")
    .filter(Boolean)
    .join("\n");
}

export async function extractPlayerStatsWithOcrSpace(
  files: PlayerStatsImageUpload[]
): Promise<ExtractedPlayerStats> {
  const texts: string[] = [];
  for (const [index, file] of files.entries()) {
    if (index > 0) {
      await sleep(OCR_REQUEST_SPACING_MS);
    }
    texts.push(await ocrOneImage(file));
  }
  const combined = texts.join("\n\n");
  if (!combined.trim()) {
    throw new BadGatewayException("OCR.space did not return any readable text.");
  }
  return parseExtractedStats(combined);
}

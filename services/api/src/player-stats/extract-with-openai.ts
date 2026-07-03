import OpenAI from "openai";
import {
  BadGatewayException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ExtractedPlayerStats } from "./types";

export type PlayerStatsImageUpload = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
};

const metricSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    value: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    confidence: { type: ["number", "null"] },
  },
  required: ["value", "unit", "confidence"],
};

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ball_possessions: metricSchema,
    total_distance: metricSchema,
    sprint_distance: metricSchema,
    top_speed: metricSchema,
    kicking_power: metricSchema,
    distance_with_ball: metricSchema,
    top_speed_with_ball: metricSchema,
    intense_turns_with_ball: metricSchema,
    first_step_accelerations: metricSchema,
    intense_accelerations: metricSchema,
    sprints: metricSchema,
    intense_turns: metricSchema,
    avg_turn_entry_speed: metricSchema,
    avg_turn_exit_speed: metricSchema,
    left_turns: metricSchema,
    right_turns: metricSchema,
    back_turns: metricSchema,
    one_touch_possessions_count: metricSchema,
    multi_touch_possessions_count: metricSchema,
    total_ball_possessions: metricSchema,
    possession_duration_seconds: metricSchema,
    release_laces_count: metricSchema,
    release_inside_foot_count: metricSchema,
    release_other_footzone_count: metricSchema,
    left_foot_touch_percentage: metricSchema,
    right_foot_touch_percentage: metricSchema,
    left_foot_release_percentage: metricSchema,
    right_foot_release_percentage: metricSchema,
    left_foot_receive_percentage: metricSchema,
    right_foot_receive_percentage: metricSchema,
    left_foot_kicking_power: metricSchema,
    right_foot_kicking_power: metricSchema,
    warnings: { type: "array", items: { type: "string" } },
  },
  required: [
    "ball_possessions",
    "total_distance",
    "sprint_distance",
    "top_speed",
    "kicking_power",
    "distance_with_ball",
    "top_speed_with_ball",
    "intense_turns_with_ball",
    "first_step_accelerations",
    "intense_accelerations",
    "sprints",
    "intense_turns",
    "avg_turn_entry_speed",
    "avg_turn_exit_speed",
    "left_turns",
    "right_turns",
    "back_turns",
    "one_touch_possessions_count",
    "multi_touch_possessions_count",
    "total_ball_possessions",
    "possession_duration_seconds",
    "release_laces_count",
    "release_inside_foot_count",
    "release_other_footzone_count",
    "left_foot_touch_percentage",
    "right_foot_touch_percentage",
    "left_foot_release_percentage",
    "right_foot_release_percentage",
    "left_foot_receive_percentage",
    "right_foot_receive_percentage",
    "left_foot_kicking_power",
    "right_foot_kicking_power",
    "warnings",
  ],
};

const prompt = `
You are extracting football player tracking stats from Playermaker-style mobile screenshots.

Return only values that are visibly present in the screenshots. Do not guess.
For each metric, return:
- value: number only, no unit
- unit: visible unit such as mph, kph, yd, m, mi, km, sec, %, #, or null
- confidence: 0 to 1

Important mappings:
- "Ball possessions" maps to ball_possessions.
- "Total distance" maps to total_distance.
- "Sprint distance" maps to sprint_distance.
- "Top speed" maps to top_speed.
- "Kicking power" maps to kicking_power.
- "Distance with the ball" maps to distance_with_ball.
- "Top speed with the ball" maps to top_speed_with_ball.
- "Intense turns with the ball" maps to intense_turns_with_ball.
- "First step accelerations" maps to first_step_accelerations.
- "Intense accelerations" maps to intense_accelerations.
- "Sprints" maps to sprints.
- "Intense turns" maps to intense_turns.
- "Average turn entry speed" maps to avg_turn_entry_speed.
- "Average turn exit speed" maps to avg_turn_exit_speed.
- "Left turns", "Right turns", "Back turns" map to their turn fields.
- In the First Touch screen, "One Touch Count" maps to one_touch_possessions_count.
- "Multiple touch Count" maps to multi_touch_possessions_count.
- "Ball possessions Total" maps to total_ball_possessions.
- "Total Duration" under Multiple touch maps to possession_duration_seconds.
- "Ball release footzone": Laces, Inside, Other map to release_laces_count, release_inside_foot_count, release_other_footzone_count.
- Two-footed screen percentages map to their left/right foot touch, release, and receive percentage fields.
- Left kicking power maps to left_foot_kicking_power.
- Right kicking power maps to right_foot_kicking_power.

If one of the values is not visible, use value null and add a clear warning.
`;

function openAiStatus(error: unknown): number | null {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return null;
}

function openAiMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown OpenAI error";
}

function toOpenAiHttpException(error: unknown): Error {
  const status = openAiStatus(error);
  const message = openAiMessage(error);

  if (status === 401) {
    return new ServiceUnavailableException(
      "OpenAI rejected the configured API key. Set a valid OPENAI_API_KEY in services/api/.env and restart pnpm dev:api."
    );
  }
  if (status === 429) {
    return new ServiceUnavailableException(
      "OpenAI rate limit or quota was reached. Try again later or check the configured OpenAI account."
    );
  }
  if (status === 400 && /model/i.test(message)) {
    return new ServiceUnavailableException(
      "OpenAI rejected the configured model. Check OPENAI_MODEL in services/api/.env."
    );
  }
  if (status != null) {
    return new BadGatewayException(`OpenAI extraction failed with status ${status}.`);
  }
  return new BadGatewayException("OpenAI extraction failed before returning a response.");
}

export async function extractPlayerStatsFromImages(
  files: PlayerStatsImageUpload[]
): Promise<ExtractedPlayerStats> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ServiceUnavailableException(
      "OPENAI_API_KEY is not configured on the API server."
    );
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const imageParts = files.map((file) => ({
    type: "input_image" as const,
    image_url: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
    detail: "high" as const,
  }));

  let response: Awaited<ReturnType<typeof client.responses.create>>;
  try {
    response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.5",
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }, ...imageParts],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "player_stats_image_extraction",
          strict: true,
          schema: extractionSchema,
        },
      },
    });
  } catch (error) {
    throw toOpenAiHttpException(error);
  }

  if (!response.output_text) {
    throw new BadGatewayException("OpenAI returned an empty extraction response.");
  }

  try {
    return JSON.parse(response.output_text) as ExtractedPlayerStats;
  } catch {
    throw new BadGatewayException("OpenAI returned malformed extraction JSON.");
  }
}

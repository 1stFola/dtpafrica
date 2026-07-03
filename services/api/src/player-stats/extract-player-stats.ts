import { ServiceUnavailableException } from "@nestjs/common";
import { ExtractedPlayerStats } from "./types";
import {
  extractPlayerStatsFromImages,
  PlayerStatsImageUpload,
} from "./extract-with-openai";
import { extractPlayerStatsWithOcrSpace } from "./extract-with-ocr-space";

export async function extractPlayerStatsFromUploads(
  files: PlayerStatsImageUpload[]
): Promise<ExtractedPlayerStats> {
  if (process.env.OCR_SPACE_API_KEY?.trim()) {
    return extractPlayerStatsWithOcrSpace(files);
  }
  if (process.env.OPENAI_API_KEY?.trim()) {
    return extractPlayerStatsFromImages(files);
  }
  throw new ServiceUnavailableException(
    "No OCR provider is configured. Set OCR_SPACE_API_KEY or OPENAI_API_KEY in services/api/.env and restart pnpm dev:api."
  );
}

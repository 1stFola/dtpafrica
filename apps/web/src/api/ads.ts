import { apiGet } from "./client";
import type { AdSlotKey } from "../config/adConfig";

export type RemoteAdSlot = {
  enabled: boolean;
  slotId: string;
  format: "leaderboard" | "square" | "mobile-banner" | "inline";
  fallbackImageUrl: string;
  destinationUrl: string;
  label?: string;
  placementNotes?: string;
};

export type PublicAdsConfig = {
  slots: Record<AdSlotKey, RemoteAdSlot>;
  updatedAt: string | null;
};

export function fetchPublicAdsConfig() {
  return apiGet<PublicAdsConfig>("/home/ads");
}

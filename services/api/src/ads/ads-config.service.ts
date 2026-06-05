import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  AD_SLOT_KEYS,
  ADS_CONFIG_KEY,
  DEFAULT_AD_SLOTS,
  type AdBannerFormat,
  type AdSlotConfig,
  type AdSlotKey,
  type AdsConfigPayload,
  isAdBannerFormat,
  isAdSlotKey,
} from "./ads.constants";
import { PatchAdsConfigDto } from "./dto/patch-ads-config.dto";

type StoredAdsConfig = {
  slots?: Partial<Record<string, Partial<AdSlotConfig>>>;
};

@Injectable()
export class AdsConfigService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private mergeSlot(key: AdSlotKey, patch?: Partial<AdSlotConfig>): AdSlotConfig {
    const base = DEFAULT_AD_SLOTS[key];
    if (!patch) return { ...base };

    const format =
      patch.format != null && isAdBannerFormat(patch.format) ? patch.format : base.format;

    return {
      enabled: typeof patch.enabled === "boolean" ? patch.enabled : base.enabled,
      slotId: base.slotId,
      format,
      fallbackImageUrl:
        patch.fallbackImageUrl != null ? String(patch.fallbackImageUrl) : base.fallbackImageUrl,
      destinationUrl:
        patch.destinationUrl != null && String(patch.destinationUrl).trim()
          ? String(patch.destinationUrl).trim()
          : base.destinationUrl,
      label: patch.label != null ? String(patch.label) : base.label,
      placementNotes:
        patch.placementNotes != null ? String(patch.placementNotes) : base.placementNotes,
    };
  }

  private mergeAll(stored?: StoredAdsConfig | null): AdsConfigPayload {
    const slots = {} as Record<AdSlotKey, AdSlotConfig>;
    for (const key of AD_SLOT_KEYS) {
      slots[key] = this.mergeSlot(key, stored?.slots?.[key]);
    }
    return { slots };
  }

  private parseStored(value: string | null | undefined): StoredAdsConfig | null {
    if (!value?.trim()) return null;
    try {
      const parsed = JSON.parse(value) as StoredAdsConfig | Record<string, unknown>;
      if (parsed && typeof parsed === "object" && "slots" in parsed) {
        return parsed as StoredAdsConfig;
      }
      return { slots: parsed as StoredAdsConfig["slots"] };
    } catch {
      return null;
    }
  }

  private normalizePatchSlot(key: AdSlotKey, raw: unknown): Partial<AdSlotConfig> {
    if (!raw || typeof raw !== "object") {
      throw new BadRequestException(`Slot "${key}" must be an object`);
    }
    const patch = raw as Record<string, unknown>;
    const out: Partial<AdSlotConfig> = {};

    if ("enabled" in patch) {
      if (typeof patch.enabled !== "boolean") {
        throw new BadRequestException(`Slot "${key}".enabled must be a boolean`);
      }
      out.enabled = patch.enabled;
    }
    if ("format" in patch && patch.format != null) {
      const format = String(patch.format);
      if (!isAdBannerFormat(format)) {
        throw new BadRequestException(`Slot "${key}".format is invalid`);
      }
      out.format = format as AdBannerFormat;
    }
    if ("fallbackImageUrl" in patch && patch.fallbackImageUrl != null) {
      out.fallbackImageUrl = String(patch.fallbackImageUrl);
    }
    if ("destinationUrl" in patch && patch.destinationUrl != null) {
      out.destinationUrl = String(patch.destinationUrl);
    }
    if ("label" in patch && patch.label != null) {
      out.label = String(patch.label);
    }
    if ("placementNotes" in patch && patch.placementNotes != null) {
      out.placementNotes = String(patch.placementNotes);
    }

    return out;
  }

  async getConfig(): Promise<AdsConfigPayload & { updatedAt: string | null }> {
    const row = await this.prisma.staticContent.findUnique({
      where: { key: ADS_CONFIG_KEY },
    });
    const stored = this.parseStored(row?.value);
    return {
      ...this.mergeAll(stored),
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async updateConfig(dto: PatchAdsConfigDto): Promise<AdsConfigPayload & { updatedAt: string }> {
    if (!dto.slots || typeof dto.slots !== "object") {
      throw new BadRequestException("slots object is required");
    }

    const current = await this.getConfig();
    const nextSlots = { ...current.slots };

    for (const [key, raw] of Object.entries(dto.slots)) {
      if (!isAdSlotKey(key)) {
        throw new BadRequestException(`Unknown ad slot key: ${key}`);
      }
      const patch = this.normalizePatchSlot(key, raw);
      nextSlots[key] = this.mergeSlot(key, { ...nextSlots[key], ...patch });
    }

    const payload: AdsConfigPayload = { slots: {} as Record<AdSlotKey, AdSlotConfig> };
    for (const key of AD_SLOT_KEYS) {
      payload.slots[key] = nextSlots[key] ?? this.mergeSlot(key);
    }

    const row = await this.prisma.staticContent.upsert({
      where: { key: ADS_CONFIG_KEY },
      update: { value: JSON.stringify(payload) },
      create: { key: ADS_CONFIG_KEY, value: JSON.stringify(payload) },
    });

    return {
      ...payload,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

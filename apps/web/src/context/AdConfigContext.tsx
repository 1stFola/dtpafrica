import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchPublicAdsConfig, type PublicAdsConfig } from "../api/ads";
import { defaultAdConfig, type AdSlotKey } from "../config/adConfig";
import type { AdBannerProps } from "../components/AdBanner";

type AdConfigContextValue = {
  getSlot: (key: AdSlotKey) => AdBannerProps | null;
  loading: boolean;
};

const AdConfigContext = createContext<AdConfigContextValue | null>(null);

function resolveSlot(
  key: AdSlotKey,
  remote: PublicAdsConfig["slots"][AdSlotKey] | undefined
): AdBannerProps | null {
  const defaults = defaultAdConfig[key];
  if (remote && remote.enabled === false) return null;

  return {
    slotId: defaults.slotId,
    format: remote?.format ?? defaults.format,
    fallbackImageUrl: remote?.fallbackImageUrl?.trim()
      ? remote.fallbackImageUrl
      : defaults.fallbackImageUrl,
    destinationUrl: remote?.destinationUrl?.trim()
      ? remote.destinationUrl
      : defaults.destinationUrl,
    label: remote?.label?.trim() || defaults.label,
  };
}

export function AdConfigProvider({ children }: { children: ReactNode }) {
  const [remote, setRemote] = useState<PublicAdsConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchPublicAdsConfig()
      .then((config) => {
        if (!cancelled) setRemote(config);
      })
      .catch(() => {
        if (!cancelled) setRemote(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const getSlot = useCallback(
    (key: AdSlotKey) => resolveSlot(key, remote?.slots?.[key]),
    [remote]
  );

  const value = useMemo(() => ({ getSlot, loading }), [getSlot, loading]);

  return <AdConfigContext.Provider value={value}>{children}</AdConfigContext.Provider>;
}

export function useAdSlot(key: AdSlotKey): AdBannerProps | null {
  const ctx = useContext(AdConfigContext);
  if (!ctx) {
    return defaultAdConfig[key];
  }
  return ctx.getSlot(key);
}

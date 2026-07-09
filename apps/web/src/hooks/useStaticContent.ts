import { useEffect, useMemo, useState } from "react";
import { apiGet, isAbortError } from "../api/client";

export type StaticContentMap = Record<string, string>;

export function useStaticContent(keys: readonly string[]) {
  const [content, setContent] = useState<StaticContentMap>({});

  const keyParam = useMemo(() => keys.join(","), [keys]);

  useEffect(() => {
    if (!keyParam) return;
    const controller = new AbortController();
    apiGet<StaticContentMap>(`/home/content?keys=${encodeURIComponent(keyParam)}`, controller.signal)
      .then(setContent)
      .catch((error) => {
        if (!isAbortError(error)) setContent({});
      });
    return () => controller.abort();
  }, [keyParam]);

  return content;
}

export function contentValue(content: StaticContentMap, key: string, fallback: string) {
  const value = content[key]?.trim();
  return value || fallback;
}

export function contentParagraphs(content: StaticContentMap, key: string, fallback: string[]) {
  const value = content[key]?.trim();
  if (!value) return fallback;
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

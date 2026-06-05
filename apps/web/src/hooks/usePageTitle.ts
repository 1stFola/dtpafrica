import { useEffect } from "react";

const SITE = "DirectToPro Africa";

export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE}` : SITE;
  }, [title]);
}

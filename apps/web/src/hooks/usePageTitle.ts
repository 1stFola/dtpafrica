import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SITE = "DirectToPro Africa";
const SITE_ORIGIN = "https://www.dtp.africa";

function canonicalPath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "");
}

function setMeta(selector: string, value: string) {
  const tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (tag) tag.setAttribute("content", value);
}

function setCanonical(href: string) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = href;
}

export function usePageTitle(title?: string) {
  const location = useLocation();

  useEffect(() => {
    const pageTitle = title ? `${title} - ${SITE}` : SITE;
    const canonical = `${SITE_ORIGIN}${canonicalPath(location.pathname)}`;

    document.title = pageTitle;
    setCanonical(canonical);
    setMeta('meta[property="og:url"]', canonical);
    setMeta('meta[property="og:title"]', title || SITE);
    setMeta('meta[name="twitter:title"]', title || SITE);
  }, [location.pathname, title]);
}

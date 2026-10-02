import { useEffect, useState, type RefObject } from "react";
import { pictureRect, type Rect } from "./calibration-editor";

/**
 * Where the picture sits inside the stage element, kept up to date as the stage
 * resizes, so overlays drawn as fractions of the picture land on the picture and
 * not on the letterbox bars.
 */
export function usePictureRect(stageRef: RefObject<HTMLElement | null>, proxy: { width: number; height: number }, ready = true): Rect {
  const [size, setSize] = useState({ width: 0, height: 0 });
  // The stage mounts only once everything it needs has loaded, so `ready` says
  // when to measure; the proxy's size is in the dependencies for the same reason.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !ready) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    // The stage grows when the video learns its size, so the video is watched too,
    // and its metadata event is the moment that happens.
    const video = el.querySelector("video");
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    if (video) observer?.observe(video);
    video?.addEventListener("loadedmetadata", measure);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      video?.removeEventListener("loadedmetadata", measure);
      window.removeEventListener("resize", measure);
    };
  }, [stageRef, proxy.width, proxy.height, ready]);
  return pictureRect(size, proxy);
}

import { useEffect, useMemo, useState } from "react";
import {
  resolveBenchmarkHeadshotUrls,
  resolveBenchmarkHeadshotUrlsAsync,
} from "../utils/benchmarkPlayerHeadshot";

function BenchmarkHeadshotPlaceholder() {
  return (
    <svg
      className="benchmark-player-headshot__placeholder"
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="32" cy="22" r="11" fill="currentColor" opacity="0.38" />
      <ellipse cx="32" cy="52" rx="17" ry="11" fill="currentColor" opacity="0.24" />
    </svg>
  );
}

type BenchmarkPlayerHeadshotProps = {
  playerName: string;
  className?: string;
};

export function BenchmarkPlayerHeadshot({ playerName, className }: BenchmarkPlayerHeadshotProps) {
  const initialUrls = useMemo(() => resolveBenchmarkHeadshotUrls(playerName), [playerName]);
  const [urls, setUrls] = useState(initialUrls);
  const [urlIndex, setUrlIndex] = useState(0);
  const [showPlaceholder, setShowPlaceholder] = useState(initialUrls.length === 0);

  useEffect(() => {
    let cancelled = false;

    setUrlIndex(0);
    setUrls(initialUrls);
    setShowPlaceholder(initialUrls.length === 0);

    void resolveBenchmarkHeadshotUrlsAsync(playerName).then((resolvedUrls) => {
      if (cancelled) return;

      setUrls(resolvedUrls);
      setUrlIndex(0);
      setShowPlaceholder(resolvedUrls.length === 0);
    });

    return () => {
      cancelled = true;
    };
  }, [playerName, initialUrls]);

  const rootClassName = ["benchmark-player-headshot", className].filter(Boolean).join(" ");

  if (showPlaceholder) {
    return (
      <div className={rootClassName} aria-hidden="true">
        <BenchmarkHeadshotPlaceholder />
      </div>
    );
  }

  return (
    <div className={rootClassName} aria-hidden="true">
      <img
        key={`${playerName}-${urls[urlIndex]}`}
        src={urls[urlIndex]}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => {
          if (urlIndex + 1 < urls.length) {
            setUrlIndex((index) => index + 1);
            return;
          }
          setShowPlaceholder(true);
        }}
      />
    </div>
  );
}

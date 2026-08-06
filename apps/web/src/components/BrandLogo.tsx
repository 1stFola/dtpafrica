import type { ImgHTMLAttributes } from "react";

export type BrandLogoVariant =
  | "white-horizontal"
  | "color-horizontal"
  | "white-vertical"
  | "color-vertical";

const BRAND_SRC: Record<BrandLogoVariant, string> = {
  "white-horizontal": "/brand/dtp-logo-white-horizontal.png",
  // Official vector master — stays crisp in the nav at any density.
  "color-horizontal": "/brand/dtp-logo-color-horizontal.svg",
  "white-vertical": "/brand/dtp-logo-white-vertical.png",
  // Official vector master.
  "color-vertical": "/brand/dtp-logo-color-vertical.svg",
};

export type BrandLogoSize = "header" | "footer" | "scoreboard" | "login" | "admin";

const SIZE_CLASS: Record<BrandLogoSize, string> = {
  header: "brand-logo--header",
  footer: "brand-logo--footer",
  scoreboard: "brand-logo--scoreboard",
  login: "brand-logo--login",
  admin: "brand-logo--admin",
};

export type BrandLogoProps = {
  variant?: BrandLogoVariant;
  size?: BrandLogoSize;
  className?: string;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt">;

/**
 * `app-brand-logo-blend` applies `mix-blend-mode: screen`, which knocks the
 * dark plate out from behind the *white* marks. Screen renders black as fully
 * transparent, so it must never be applied to the dark-ink marks — doing so
 * makes them vanish against a light surface.
 */
const DARK_INK_VARIANTS: ReadonlySet<BrandLogoVariant> = new Set([
  "color-horizontal",
  "color-vertical",
]);

export function BrandLogo({
  variant = "white-horizontal",
  size = "header",
  className,
  ...imgProps
}: BrandLogoProps) {
  const isDarkInk = DARK_INK_VARIANTS.has(variant);
  const classes = [
    "brand-logo",
    isDarkInk ? null : "app-brand-logo-blend",
    SIZE_CLASS[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className="app-brand-logo-wrap"
      // The wrap paints the header colour behind the mark for the screen
      // blend; dark-ink marks sit on their own surface and need it clear.
      style={isDarkInk ? { background: "transparent" } : undefined}
    >
      <img
        src={BRAND_SRC[variant]}
        alt="Direct To Pro Africa"
        className={classes}
        decoding="async"
        {...imgProps}
      />
    </span>
  );
}

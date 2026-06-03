import type { ImgHTMLAttributes } from "react";

export type BrandLogoVariant =
  | "white-horizontal"
  | "color-horizontal"
  | "white-vertical"
  | "color-vertical";

const BRAND_SRC: Record<BrandLogoVariant, string> = {
  "white-horizontal": "/brand/dtp-logo-white-horizontal.png",
  "color-horizontal": "/brand/dtp-logo-color-horizontal.png",
  "white-vertical": "/brand/dtp-logo-white-vertical.png",
  "color-vertical": "/brand/dtp-logo-color-vertical.png",
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

export function BrandLogo({
  variant = "white-horizontal",
  size = "header",
  className,
  ...imgProps
}: BrandLogoProps) {
  const classes = ["brand-logo", SIZE_CLASS[size], className].filter(Boolean).join(" ");

  return (
    <img
      src={BRAND_SRC[variant]}
      alt="Direct To Pro Africa"
      className={classes}
      decoding="async"
      {...imgProps}
    />
  );
}

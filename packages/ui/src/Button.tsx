import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type ButtonProps<T extends ElementType = "button"> = {
  as?: T;
  variant?: "primary" | "secondary";
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

export function Button<T extends ElementType = "button">({
  as,
  variant = "primary",
  children,
  className = "",
  ...rest
}: ButtonProps<T>) {
  const Component = as ?? "button";
  const classes = `dtp-btn dtp-btn--${variant} ${className}`.trim();
  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
}

"use client";

import type { ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import styles from "./ui.module.css";

export type ButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  children?: ReactNode;
  variant?: "primary" | "positive" | "accent" | "outline" | "subtle";
  size?: "small" | "default";
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
};

export function Button({ variant = "primary", size = "default", leadingIcon, trailingIcon, loading = false, disabled, className = "", children, type = "button", ...props }: ButtonProps) {
  const interactive = !disabled && !loading;
  return (
    <motion.button whileHover={interactive ? { y: -2, scale: 1.025 } : undefined} whileTap={interactive ? { y: 0, scale: 0.96 } : undefined} {...props} type={type} className={`${styles.button} ${styles[variant]} ${size === "small" ? styles.small : ""} ${className}`} disabled={disabled || loading} aria-busy={loading || props["aria-busy"] || undefined}>
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : leadingIcon}
      {children}
      {trailingIcon}
    </motion.button>
  );
}

export type IconButtonProps = Omit<ButtonProps, "children" | "leadingIcon" | "trailingIcon" | "aria-label"> & {
  icon: ReactNode;
  "aria-label": string;
};

export function IconButton({ icon, className = "", variant = "outline", ...props }: IconButtonProps) {
  return <Button {...props} variant={variant} className={`${styles.iconButton} ${className}`} leadingIcon={icon} />;
}

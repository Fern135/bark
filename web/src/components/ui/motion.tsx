"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

export const transitions = {
  responsive: { type: "spring", stiffness: 460, damping: 30, mass: 0.7 },
  gentle: { type: "spring", stiffness: 240, damping: 26 },
  fade: { duration: 0.16, ease: "easeOut" },
} as const;

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="never" transition={transitions.responsive}>{children}</MotionConfig>;
}

export function useEntrance(delay = 0) {
  return {
    initial: { opacity: 0, y: 12 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.08 },
    transition: { ...transitions.gentle, delay, opacity: transitions.fade },
  };
}

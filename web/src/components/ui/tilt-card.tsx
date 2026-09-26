"use client";

import type { ReactNode, PointerEvent } from "react";
import { motion, useMotionTemplate, useSpring } from "motion/react";
import { transitions } from "./motion";
import styles from "./advanced.module.css";

export type TiltCardProps = {
  children: ReactNode;
  className?: string;
};

export function TiltCard({ children, className = "" }: TiltCardProps) {
  const rotateX = useSpring(0, transitions.gentle);
  const rotateY = useSpring(0, transitions.gentle);
  const lightX = useSpring(50, transitions.gentle);
  const lightY = useSpring(50, transitions.gentle);
  const glow = useSpring(0, transitions.gentle);
  const background = useMotionTemplate`radial-gradient(circle at ${lightX}% ${lightY}%, rgb(255 255 255 / 65%), transparent 65%)`;

  function reset() {
    rotateX.set(0);
    rotateY.set(0);
    glow.set(0);
  }

  function follow(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    rotateX.set((0.5 - y) * 10);
    rotateY.set((x - 0.5) * 10);
    lightX.set(x * 100);
    lightY.set(y * 100);
    glow.set(1);
  }

  return <div className={`${styles.tiltFrame} ${className}`} onPointerMove={follow} onPointerLeave={reset} onPointerCancel={reset} onBlur={reset}>
    <motion.div className={styles.tiltSurface} style={{ rotateX, rotateY }}>
      {children}
      <motion.div aria-hidden="true" className={styles.tiltHighlight} style={{ background, opacity: glow }} />
    </motion.div>
  </div>;
}

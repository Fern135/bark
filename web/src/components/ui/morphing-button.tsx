"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { ReactNode } from "react";
import { Button, type ButtonProps } from "./button";
import { Icon } from "./icon";
import { transitions } from "./motion";
import styles from "./advanced.module.css";
import ui from "./ui.module.css";

export type ActionStatus = "idle" | "loading" | "success" | "error";
export type MorphingButtonProps = Omit<ButtonProps, "children" | "loading" | "leadingIcon" | "trailingIcon"> & {
  status: ActionStatus;
  label: string;
  loadingLabel?: string;
  successLabel?: string;
  errorLabel?: string;
  idleIcon?: ReactNode;
};

export function MorphingButton({ status, label, loadingLabel = "Saving your changes…", successLabel = "Saved", errorLabel = "Try again", idleIcon, disabled, variant = "primary", className = "", ...props }: MorphingButtonProps) {
  const text = { idle: label, loading: loadingLabel, success: successLabel, error: errorLabel }[status];
  return <LayoutGroup>
    <Button {...props} layout transition={transitions.responsive} style={{ borderRadius: 15 }} className={`${styles.morphButton} ${className}`}
      disabled={disabled || status === "loading"} aria-busy={status === "loading"} aria-label={text}
      variant={status === "success" ? "positive" : status === "error" ? "outline" : variant}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={status} layout="position" className={styles.morphContent} initial={{ opacity: 0, y: 10, filter: "blur(3px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -10, filter: "blur(3px)" }} transition={{ duration: 0.18 }} aria-hidden="true">
          {status === "loading" ? <span className={ui.spinner} /> : status === "success" ?
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><motion.path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, delay: 0.12 }} /></svg>
            : status === "error" ? <Icon name="undo" /> : idleIcon ?? <Icon name="upload" />}
          {text}
        </motion.span>
      </AnimatePresence>
    </Button>
  </LayoutGroup>;
}

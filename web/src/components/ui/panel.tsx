"use client";

import type { ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { useEntrance } from "./motion";
import styles from "./ui.module.css";

export type PanelProps = Omit<HTMLMotionProps<"section">, "title" | "children"> & {
  children?: ReactNode;
  title?: ReactNode;
  description?: string;
  headerAction?: ReactNode;
  footer?: ReactNode;
};

export function Panel({ title, description, headerAction, footer, children, className = "", ...props }: PanelProps) {
  const entrance = useEntrance();
  return (
    <motion.section {...entrance} {...props} className={`${styles.panel} ${className}`}>
      {(title || description || headerAction) && <header className={styles.panelHeader}>
        <div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>
        {headerAction}
      </header>}
      <div className={styles.panelBody}>{children}</div>
      {footer && <footer className={styles.panelFooter}>{footer}</footer>}
    </motion.section>
  );
}

"use client";

import { useId, useRef, useState, useLayoutEffect, type ReactNode, type KeyboardEvent } from "react";
import { LayoutGroup, motion } from "motion/react";
import { transitions } from "./motion";
import styles from "./ui.module.css";

export type TabItem = { value: string; label: string; icon?: ReactNode; content: ReactNode; disabled?: boolean };
export type TabsProps = {
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  variant?: "underline" | "segmented";
};

export function Tabs({ items, value, onValueChange, label, variant = "underline" }: TabsProps) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const panels = useRef<(HTMLDivElement | null)[]>([]);
  const [height, setHeight] = useState<number>();
  const selectedIndex = items.findIndex((item) => item.value === value);

  useLayoutEffect(() => {
    const panel = panels.current[selectedIndex];
    if (!panel) return;
    const observer = new ResizeObserver(() => setHeight(panel.offsetHeight));
    observer.observe(panel);
    return () => observer.disconnect();
  }, [selectedIndex]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const enabled = items.map((item, i) => item.disabled ? -1 : i).filter((i) => i >= 0);
    const position = enabled.indexOf(index);
    let next: number;
    switch (event.key) {
      case "ArrowRight": next = enabled[(position + 1) % enabled.length]; break;
      case "ArrowLeft": next = enabled[(position - 1 + enabled.length) % enabled.length]; break;
      case "Home": next = enabled[0]; break;
      case "End": next = enabled[enabled.length - 1]; break;
      default: return;
    }
    event.preventDefault();
    refs.current[next]?.focus();
    onValueChange(items[next].value);
  }
  return <LayoutGroup id={id}><div className={styles.tabs}>
    <div role="tablist" aria-label={label} className={`${styles.tabList} ${styles[variant]}`}>
      {items.map((item, index) => <button key={item.value} ref={(element) => { refs.current[index] = element; }} id={`${id}-tab-${index}`} type="button" role="tab" aria-selected={value === item.value} aria-controls={`${id}-panel-${index}`} tabIndex={value === item.value ? 0 : -1} disabled={item.disabled} onClick={() => onValueChange(item.value)} onKeyDown={(event) => navigate(event, index)} className={styles.tab}>
        {value === item.value && <motion.span aria-hidden="true" layoutId="selection" className={styles.tabIndicator} transition={transitions.responsive} />}
        <span className={styles.tabLabel}>{item.icon}{item.label}</span>
      </button>)}
    </div>
    <motion.div className={styles.tabViewport} initial={false} animate={{ height: height ?? "auto" }} transition={transitions.gentle}>
      {items.map((item, index) => {
        const active = value === item.value;
        return <motion.div key={item.value} ref={(element) => { panels.current[index] = element; }} id={`${id}-panel-${index}`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`} aria-hidden={!active} inert={!active} tabIndex={active ? 0 : -1} className={styles.tabPanel}
          style={{ position: active ? "relative" : "absolute", pointerEvents: active ? "auto" : "none" }}
          initial={false} animate={active ? { opacity: 1, x: 0, visibility: "visible" } : { opacity: 0, x: index < selectedIndex ? -24 : 24, transitionEnd: { visibility: "hidden" } }} transition={{ duration: 0.22, ease: "easeOut" }}>
          {item.content}
        </motion.div>;
      })}
    </motion.div>
  </div></LayoutGroup>;
}

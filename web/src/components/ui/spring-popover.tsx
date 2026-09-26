"use client";

import { useId, useState, type ReactElement, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { AnimatePresence, motion } from "motion/react";
import { Button, IconButton, type ButtonProps } from "./button";
import { Icon } from "./icon";
import { transitions } from "./motion";
import styles from "./advanced.module.css";

export type SpringPopoverProps = {
  trigger: ReactElement;
  title: string;
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode | ((close: () => void) => ReactNode);
};

export function SpringPopover({ trigger, title, children, onCloseAutoFocus }: SpringPopoverProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>{trigger}</Popover.Trigger>
    <AnimatePresence>
      {open && <Popover.Portal forceMount>
        <Popover.Content asChild forceMount sideOffset={12} collisionPadding={16} align="start" aria-labelledby={id} onCloseAutoFocus={onCloseAutoFocus}>
          <motion.div className={styles.popover} initial="closed" animate="open" exit="closed"
            variants={{ closed: { opacity: 0, scale: 0.9, y: -6 }, open: { opacity: 1, scale: 1, y: 0, transition: { ...transitions.responsive, delayChildren: 0.045, staggerChildren: 0.045 } } }}>
            <div className={styles.popoverHeading}><h3 id={id}>{title}</h3><Popover.Close asChild><IconButton size="small" aria-label="Close popover" icon={<Icon name="close" size={16} />} /></Popover.Close></div>
            <div className={styles.popoverBody}>{typeof children === "function" ? children(() => setOpen(false)) : children}</div>
            <Popover.Arrow className={styles.popoverArrow} width={16} height={8} />
          </motion.div>
        </Popover.Content>
      </Popover.Portal>}
    </AnimatePresence>
  </Popover.Root>;
}

export function PopoverAction({ className = "", ...props }: ButtonProps) {
  return <Button {...props} variant="subtle" className={`${styles.popoverAction} ${className}`} variants={{ closed: { opacity: 0, x: -8 }, open: { opacity: 1, x: 0 } }} />;
}

"use client";

import { useId, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { IconButton } from "./button";
import { Icon } from "./icon";
import { transitions } from "./motion";
import styles from "./advanced.module.css";

export type ExpandCardProps = {
  title: string;
  subtitle: string;
  description: string;
  artwork: ReactNode;
  children: ReactNode;
  tone?: "blue" | "purple" | "green";
};

export function ExpandCard({ title, subtitle, description, artwork, children, tone = "blue" }: ExpandCardProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <LayoutGroup id={id}>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <motion.button type="button" className={styles.expandTrigger} style={{ borderRadius: 20 }} layoutId="surface" aria-label={`Explore ${title}`}>
          <motion.div layoutId="artwork" className={`${styles.cardArtwork} ${styles[tone]}`} style={{ borderRadius: 14 }}>{artwork}</motion.div>
          <div className={styles.cardCaption}>
            <div><motion.h3 layoutId="title">{title}</motion.h3><p>{subtitle}</p></div><Icon name="arrow" size={20} />
          </div>
        </motion.button>
      </Dialog.Trigger>
      <AnimatePresence>
        {open && <Dialog.Portal forceMount>
          <Dialog.Overlay asChild forceMount>
            <motion.div className={styles.scrim} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transitions.fade} />
          </Dialog.Overlay>
          <div className={styles.dialogPosition}>
            <Dialog.Content asChild forceMount>
              <motion.div className={styles.expandedCard} layoutId="surface" style={{ borderRadius: 24 }} transition={transitions.gentle}>
                <motion.div layoutId="artwork" className={`${styles.expandedArtwork} ${styles[tone]}`} style={{ borderRadius: 18 }}>{artwork}</motion.div>
                <div className={styles.expandedBody}>
                  <Dialog.Title asChild><motion.h3 layoutId="title">{title}</motion.h3></Dialog.Title>
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, delay: 0.12 }}>
                    <Dialog.Description>{description}</Dialog.Description>
                    {children}
                  </motion.div>
                </div>
                <Dialog.Close asChild><IconButton className={styles.dialogClose} aria-label={`Close ${title}`} icon={<Icon name="close" />} /></Dialog.Close>
              </motion.div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>}
      </AnimatePresence>
    </Dialog.Root>
  </LayoutGroup>;
}

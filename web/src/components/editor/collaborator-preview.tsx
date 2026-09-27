"use client";

import { useId } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Button, IconButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { nunito } from "@/lib/fonts";
import s from "./editor.module.css";

const members = [
  { name: "You", initial: "Y", role: "Owner", presence: "Online", color: "blue" },
  { name: "Alex", initial: "A", role: "Editor", presence: "Online", color: "purple" },
  { name: "Sam", initial: "S", role: "Viewer", presence: "Away", color: "peach" },
] as const;

export function CollaboratorPreview() {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <div className={s.collaborators}>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={s.collaboratorTrigger}
            aria-label="Collaborators preview, 3 sample members"
          >
            {members.map((member) => (
              <span
                key={member.name}
                className={s.collaboratorBubble}
                data-color={member.color}
                title={member.name}
                aria-hidden="true"
              >
                <svg viewBox="0 0 40 40" fill="none" focusable="false">
                  <path d="M7 40v-7a13 13 0 0 1 26 0v7" fill="currentColor" />
                  <path d="M16 25h8v5a4 4 0 0 1-8 0" fill="#efbb94" />
                  <rect x="12" y="8" width="16" height="20" rx="8" fill="#ffe0bd" />
                  <path d="M11 18v-5a9 9 0 0 1 18 0v5l-4-7c-3 4-8 5-14 4" fill="#463849" />
                  <circle cx="17" cy="19" r="1" fill="#463849" />
                  <circle cx="23" cy="19" r="1" fill="#463849" />
                  <path d="M18 23q2 2 4 0" stroke="#a66054" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </span>
            ))}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className={s.collaboratorMenu}
            style={{ fontFamily: nunito.style.fontFamily }}
            align="end"
            sideOffset={10}
            collisionPadding={12}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
          >
            <div className={s.collaboratorHeading}>
              <div>
                <span className={s.previewBadge}>Preview</span>
                <h2 id={titleId}>Collaborators</h2>
              </div>
              <Popover.Close asChild>
                <IconButton
                  icon={<Icon name="close" size={17} />}
                  aria-label="Close collaborators preview"
                  variant="subtle"
                  size="small"
                />
              </Popover.Close>
            </div>
            <p id={descriptionId} className={s.collaboratorDescription}>
              A little world, built together. Sample members below.
            </p>
            <ul className={s.collaboratorRoster} aria-label="Sample collaborators">
              {members.map((member) => (
                <li key={member.name}>
                  <span className={s.collaboratorAvatar} data-color={member.color} aria-hidden="true">
                    {member.initial}
                  </span>
                  <div className={s.collaboratorMember}>
                    <strong>{member.name}</strong>
                    <span>{member.role}</span>
                  </div>
                  <span className={s.collaboratorPresence} data-away={member.presence === "Away"}>
                    <span aria-hidden="true" />
                    {member.presence}
                  </span>
                </li>
              ))}
            </ul>
            <div className={s.collaboratorInvite}>
              <Button disabled leadingIcon={<Icon name="plus" size={17} />}>
                Invite collaborator
              </Button>
              <p>Invites and live collaboration are coming soon.</p>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

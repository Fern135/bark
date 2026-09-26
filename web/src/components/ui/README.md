# Bark UI

Open `/components` for interactive examples. These components use CSS Modules and
the `--bark-*` foundations in `src/app/globals.css`; they do not require Bootstrap
component classes or JavaScript.

| Module | Exports | Usage |
| --- | --- | --- |
| `button` | `Button`, `IconButton` | `variant`: primary, positive, accent, outline, subtle. `size`: default or small. `loading` disables activation. Icon buttons require `aria-label`. |
| `panel` | `Panel` | Content with optional `title`, `description`, `headerAction`, and `footer`. |
| `tabs` | `Tabs`, `TabItem` | Controlled `value` / `onValueChange`; `items` contain unique values, labels, content, optional icons and disabled flags. Supply an enabled value and a group `label`. |
| `fields` | `TextInput`, `Select`, `Slider`, `Switch` | Native inputs with associated labels and standard element props. |
| `icon` | `Icon`, `IconName` | Decorative SVGs; label the containing control instead. |

`TextInput` supports text, search, and number types. `Select` accepts an `options`
array and optional disabled placeholder. Both associate `description` and `error`
text with the input and support caller-supplied IDs and descriptions.

`Slider` is controlled with a numeric `value` and `onValueChange`, with optional
`min`, `max`, `step`, and `formatValue`. Use `min < max` and an in-range value.
`Switch` supports native `checked` / `onChange` or `defaultChecked` props.

Tabs activate on Left/Right arrows, Home, and End, skip disabled items, and keep
inactive panels mounted but hidden. Tab moves focus into the selected panel.
The showcase owns its example state; components do not save data or call services.

## Motion

`MotionProvider` in the root layout explicitly enables full motion with
`reducedMotion="never"`, as requested for Bark. There is no OS preference override
in individual controls or CSS. Buttons use hover/press springs; panels enter once
as they come into view; tab indicators share layout animations scoped to each tab
group. Tabs slide directionally, resize their container using ResizeObserver, and
keep content mounted so switching preserves local state. Inactive panels are inert
and hidden from the accessibility tree, including while fading out.
Validation and feedback use short fades. Native input, select, range, and switch
behavior stays immediate. The showcase also animates filtering and object scale.

`ButtonProps` and `PanelProps` include Motion's typed element props. Their motion
defaults can be overridden for a particular use. Reuse `transitions` and
`useEntrance` from `motion.tsx` for matching timing.

### Advanced components

Try these at `/components#motion`:

- `MorphingButton`: controlled `status` (`idle`, `loading`, `success`, `error`), optional `idleIcon`,
  `label`, optional state labels, and normal Button props. Size and text morph;
  success draws a checkmark. The caller owns the async action and result. Only the
  showcase simulates a save with a timer; it also includes a failure/retry demo.
- `SpringPopover`: a button `trigger`, `title`, and `children` (or a render function
  receiving `close`). Use `PopoverAction` for staggered choices. Radix handles
  collision positioning, outside dismissal, Escape, and focus restoration. Optional
  `onCloseAutoFocus` lets navigation menus focus and scroll to their destination after closing.
- `ExpandCard`: `title`, `subtitle`, `description`, `artwork`, `children`, optional
  blue/purple/green `tone`. The card, artwork, and title share layout identities
  within a unique group. Its Radix dialog traps focus and supports Escape, outside
  dismissal, scroll locking, and returning focus to the original card.
- `TiltCard`: wrap a visual card with `children`; optional `className`. Mouse
  position drives spring rotation and a moving highlight. Touch does not tilt or
  intercept scrolling. Pointer leave, cancellation, and blur reset the surface.

The advanced components use the free Motion library and Radix primitives; no
Motion+ source or subscription is required.

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/fields";
import { Icon } from "@/components/ui/icon";

export function Example() {
  const [scale, setScale] = useState(1);
  return (
    <>
      <Slider label="Scale" value={scale} onValueChange={setScale}
        min={0.5} max={2} step={0.1} formatValue={(value) => `${value.toFixed(1)}×`} />
      <Button variant="positive" leadingIcon={<Icon name="play" />}
        onClick={() => setScale(1)}>Reset scale</Button>
    </>
  );
}
```

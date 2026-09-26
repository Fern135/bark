# Gameplay and placement validation

Validated locally on 2026-09-26 with Babylon 9.28.0 and real Havok 1.3.14.

## Automated checks

- `npm run typecheck` passes.
- `npm run build` passes and emits ESM plus declarations.
- `npm test` passes all 33 tests using real Havok and Babylon NullEngine, including the actual trusted demo adapter.
- `npm run build:test` passes. Vite reports the existing non-fatal large-chunk warning for the Babylon playground bundle.

Foundation coverage includes authored restoration, physics/collider edits, hierarchy rules, transforms, filters, triggers, queries, asset ownership, lifecycle cleanup, input edges, bounded clock ordering, JSON round trips, and failed/cancelled/replaced loads.

New checks cover detached JSON-only properties; old-project defaults; character speed normalization, turning without replacing bodies, slope grounding, single jumps and respawn; interaction distance/occlusion/visibility; kinematic collisions and continuous movement; easing/rotation and action settlement; pause/resume; feedback expiration and limits; Stop from inside completion/contact delivery; picking rays across render scales; whole-prefab capacity checks; and snapped placement, conservative overlap rejection, collider-sized support offsets, fresh duplicate IDs, ground fallback, and cached-model preview cleanup.

The game test exercises coin collection, property-driven HUD changes, opening a timed door, checkpoint activation, falling/respawn, and exact Stop restoration.

## Browser checks

Chrome was used against development on port 5173 and the production preview on port 4173. Verified local WASM/GLB/texture rendering and shadows, placement commit and snapping, duplicate cancellation, editing-only placement controls, coin HUD progress, interaction prompts and E input, door movement to Y=5.5, checkpoint activation, fall respawn to the checkpoint, inspector focus isolation, and Stop restoration to tick zero with cleared feedback. The production page reported no console errors or warnings.

Checks found and fixed picking offsets caused by double-applying hardware scaling and stale transform form values when selecting a simulated object. Browser respawn/collection checks used inspector teleports to reach each scenario; sustained movement and precise physics timing are covered by the real-Havok demo tests. Scene swaps and repeated viewport remounts were also exercised.

## Limits of this validation

Browser automation does not prove the absence of every GPU or input-listener leak; automated checks verify bounded resource counts and disposal semantics. The previous file-chooser timeout remains a browser-automation limitation: JSON file selection and downloaded-file inspection were not repeated in this pass. Project parsing and round trips are tested automatically. Placement deliberately uses conservative combined bounds, and the character controller does not provide step climbing or moving-platform riding.

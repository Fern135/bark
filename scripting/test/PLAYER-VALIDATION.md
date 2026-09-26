# Portable game player validation

Verified September 26, 2026 on Windows, Node/npm and installed headless Chrome with software WebGL (`BARK_BROWSER_CHANNEL=chrome`). The website and backend were not changed by this feature.

| Check | Result |
| --- | --- |
| Engine typecheck, library build, playground build | Passed |
| Engine tests | 40 passed (real Havok) |
| Scripting typecheck, ESM/declaration/worker build, multipage playground build | Passed |
| Scripting tests | 33 passed; includes portable file codec and real-Havok player lifecycle tests |
| Complete development browser suite | 19 passed |
| Production browser scenarios | All 4 applicable scenarios passed across the full run and targeted rerun |
| Built-library consumer | Passed in development browser tests; its duplicate is intentionally skipped in the production suite because it uses Vite's module resolver |
| Package exports and distribution contents | Node imported `@bark/scripting/player`; `npm pack --dry-run --json` includes its ESM, declarations, bundled worker, player documentation and Python runtime files |

The first production run timed out on the initial Script Lab page before its Prepare button appeared; the elapsed time was abnormally long (32 minutes despite the 120-second test timeout). The other three production scenarios passed. The affected portable-export scenario passed on a targeted rerun in 12.7 seconds without code changes. The cause of the initial startup stall was not established; it is not counted as an uninterrupted green full-suite run.

## Covered behavior

- Normalized blocks/Python round trips, saved block backups and IDs, detached snapshots, invalid JSON/version/reference diagnostics, explicit relative URL resolution, corrupt embedded assets, external GLB buffer rejection, packaging cancellation and duplicate asset fetches.
- Real-Havok authored restoration: runtime property edits, destroyed entities, simulated time and feedback disappear on Stop; export keeps authored defaults. Pause/Resume retains the current session. Restart allocates a fresh worker. No worker is created during load.
- Invalid imports preserve a running game. Failed external asset loads recover the old authored scene. Replacement loads, external abort, Stop, disposal and reentrant observers cannot resurrect old work. Preparation errors retain their structured diagnostic and permit recovery.
- Script Lab exports a game containing a local GLB, PNG and JPEG. Both development and production players import the resulting file with original asset URLs blocked. Imported models and textures render, and no Python assets are requested before Play.
- The new player runs both Python and exported Blockly scripts. Browser controls exercise focus isolation, input, HUD, Pause/Resume, Stop, Restart, invalid import recovery, scene replacement, target prompts, coin collection and the animated gate. Existing browser scenarios cover the full checkpoint/respawn game and authoring regressions.
- Canvas resizing, React Strict Mode initialization and repeated built-library player creation/disposal. Initialization abort and disposal during preparation reject pending operations; repeated successful mounts create independent workers. The built entry point loads its emitted worker, not a source-only substitute.
- Development and production screenshots were inspected. Transient screenshots and build/test artifacts remain ignored rather than committed.

## Limits

Verification used desktop Chrome and software WebGL. Firefox, Safari, mobile devices, hardware-specific GPU behavior and deployment under a non-root URL prefix were not tested. Remote-host CORS policy is controlled by the asset host; browser export reports fetch failures but does not bypass that policy. Portable files were tested with blocked original URLs while the host continued serving Havok, Python and application code locally; the file is not a standalone executable or a service-worker offline installation. Vite reports the existing large Babylon/Blockly bundle warning; builds complete successfully.

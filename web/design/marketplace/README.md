# Bark game collection

`/games` now opens community discovery; the original collection described below is at
`/games?source=demos`. `/games/[slug]` still plays bundled demos, while UUID paths play
public saved games. **Open in editor** remains available for bundled demos only.
See [publishing](../publishing/README.md) for the public publishing flow and isolated player.

## Visual sources

`concept.png` was generated with the built-in imagegen tool using the original world-code UI reference and definitive Byte character sheet. It is a concept, not a production screenshot. Exact concept and asset prompts are recorded in `prompts.json`.

Production artwork lives in `web/public/images/games/` as compressed WebP. These are cover illustrations, not gameplay captures. Byte retains his orange coat, cream markings, blue collar, and white cursor pendant. Actual gameplay captures live in `web/public/games/screenshots/`. The demos use the existing engine starter models.

The frontend uses Nunito, the shared Bark color tokens, shared buttons and icons, and the installed Motion library. Motion includes an offscreen-aware floating hero, staggered card entrances, hover lift and image zoom, spring filter selection, animated grid rearrangement, and player/HUD transitions. It preserves the existing full-motion policy.

## Content and behavior

- Six locally served demo worlds, attributed to Bark. No database, publishing, account integration, community counters, comments, or payments.
- Search, category, and sort live in the URL. Newest uses the catalog's fixed demo dates; Featured uses its curated ordering.
- Each game file uses the existing version-1 `{ version, project, script }` format. JSON loads through the codec; scripts execute only on Play. Engine/Pyodide files are served from `/runtime/`.
- Player controls include Pause/Resume, Restart, Stop, and fullscreen. Hiding the browser tab pauses gameplay. Canvas focus owns keyboard input. Navigation disposes the worker and engine.
- The current demo controls require a keyboard. Browsing and game details are responsive; touch devices show the keyboard requirement.
- Editor changes are local, retain unsaved-change warnings, and can be exported as self-contained JSON. Catalog originals are never overwritten.
- Regenerate the demo JSON after intentionally editing `scripts/create-marketplace-games.mjs` with `node scripts/create-marketplace-games.mjs`. Each game has a completion HUD; Rainbow Rally also records the run time.

## Validation

The focused Chrome suite in `tests/marketplace.spec.ts` covers filtering, direct links, responsive layouts, keyboard-driven completion of all six games, playback/reset, fullscreen, worker cleanup, editor handoff, portable export, and failed-load recovery. It captures the implementation previews and actual gameplay images.

Use an isolated production output when a development server is already running:

```powershell
$env:BARK_BUILD_DIR = '.cache/marketplace-build'
npm run build
npm run lint
npx playwright test
```

The default build directory remains `.next`. The test server reads `BARK_BUILD_DIR` and copies public/runtime assets into the standalone host. Refresh that server after generating new public screenshots.

Verified September 26, 2026: production build and ESLint passed; all 33 scripting tests passed; the four existing editor browser scenarios and nine marketplace scenarios passed, including focused reruns after test synchronization fixes. All six demo objectives were completed with actual keyboard input, and desktop/tablet/mobile screenshots were visually inspected. The build retains the existing non-fatal dynamic worker URL and Google Sans fallback-metrics warnings; this host supplies an explicit, browser-tested worker factory.

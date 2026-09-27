# Public publishing

`concept.png` is the generated UI reference, not an implementation screenshot. The exact
built-in imagegen prompt and supplied source images are recorded in `prompt.json`.
The original eight UI/character references were reviewed before generation. The panel
uses the existing Byte wave asset, real HTML controls, Radix focus/dismissal behavior,
and Motion springs. Community covers are captures of saved worlds, never generated
claims about gameplay.

The purple Publish button saves before posting, then opens a compact success panel.
My Games exposes the same controls. Community discovery is the default `/games` view;
the curated demos remain available in their own tab. Published game content follows
saved edits immediately; only owners control visibility.

`tests/integration/publishing.spec.ts` writes desktop/mobile screenshots here while
testing real account, persistence, publication, isolated playback, and unpublishing.
`tests/community.spec.ts` covers unavailable/empty/retry states and the demo tab.

The integration run covers anonymous discovery and Python gameplay, embedded GLB
assets, pause/resume, fullscreen, restart, worker disposal on Stop, live updates,
public 404 after unpublishing, Blocks playback, clipboard feedback, cover failure,
save failure, guest sign-in, untouched worlds, offline conflicts, repeated clicks,
and publishing the new ID after saving a recovery copy. Desktop, tablet, mobile,
keyboard focus, and panel dismissal were checked against the generated concept.

The public iframe uses `sandbox="allow-scripts"` without same-origin permission.
A one-use MessageChannel transfers the public document. Its CSP allows only the
bundled player, runtime assets, embedded data/blob assets, and Bark artwork. Python
runs in a credential-free classic blob worker that imports the existing scripting
worker; the classic bootstrap is required by Chrome's opaque-origin worker model.
The browser tests verify parent storage/cookies are inaccessible and a Python
attempt to fetch an authenticated Canvas endpoint never sends an API request.

Local validation on 2026-09-26 used the production Next build, Chrome, and Django
with the opt-in SQLite/locmem test settings. Seven publishing integration tests and
ten marketplace backend tests passed. The PostgreSQL concurrent-read test is
included but skipped on SQLite; Docker's PostgreSQL/Redis environment was not
available for that check. Frontend lint and production build passed.

All 15 editor/community/demo regression cases also passed across the main run and
focused follow-ups. The Rainbow Rally test initially overshot sideways into gate
posts because worker position samples lag key releases. Its test route now centers
between posts and clears each gate before turning; gameplay code was unchanged.
The final mobile search touch-target check passed after correcting flex sizing.

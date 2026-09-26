# Bark starter artwork

Selected assets from [Kenney Nature Kit](https://kenney.nl/assets/nature-kit) and [Kenney Platformer Kit](https://kenney.nl/assets/platformer-kit), distributed under CC0. Original license files are included here. `manifest.json` records the original model filenames and normalized dimensions.

The models are modified for Bark: centered origins, consistent size and forward direction, embedded texture images, matte materials, a static idle pose for characters, and smoothed normals for rounded surfaces. The original animations remain in the GLBs; the editor does not expose animation playback controls.

To regenerate, extract the source packs into `.cache/editor-assets/nature` and `.cache/editor-assets/platformer` at the repository root, then run `node web/scripts/prepare-catalog.mjs`. With the editor running, run `node web/scripts/render-catalog.mjs http://127.0.0.1:3000` to render the checked-in thumbnails using the engine. Neither source downloads nor an external asset service are needed to run the app.

# Bark auth UI

## References and artwork

The login and signup concepts use the saved Bark UI references and `../references/byte-character-sheet.png`. Byte retains his orange coat, cream markings, navy eyes, blue collar, and white cursor-shaped pendant.

Generated with the built-in image-generation tool. Exact prompts are in `prompts.json`.

- `login-concept.png` and `signup-concept.png`: visual concepts.
- `../../public/images/auth/byte-welcome.png`: login illustration.
- `../../public/images/auth/byte-adventure.png`: signup illustration.
- `../../public/images/auth/google-g.png`: official Google mark downloaded from https://developers.google.com/static/identity/images/g-logo.png. Button styling follows the light theme in https://developers.google.com/identity/branding-guidelines and uses Google Sans.

Concept text is exploratory. The production pages use real HTML and do not claim that authentication or sharing is available.

## Routes and behavior

`/login` has email and password. `/signup` adds a display name. Both offer password visibility, local required-field/email validation, a Google button, and reciprocal navigation. The landing header provides account links on desktop and in its mobile menu; Start creating still opens the creation demo.

These are UI previews only. Form submit is prevented; valid forms and Google clicks show honest inline notices. There are no auth calls, OAuth scripts/windows, credential storage, fake success states, password reset pages, or backend changes. Values stay in component memory while mounted and reset on route changes.

The shared auth shell uses existing Panel, Button, TextInput, PasswordInput, Icon, and Motion foundations. Full motion remains enabled. Decorative loops pause outside the viewport. Mobile reduces the illustration to a short header above the form.

## Validation

Production build passed with `/login` and `/signup` prerendered. The build reports warnings for the separate editor's scripting worker and Google Sans fallback metrics. Focused ESLint passed for the auth, landing, shared UI, and font files. Repository-wide lint currently reports errors in the editor work being developed separately.

Browser checks passed for both routes at desktop and mobile widths, plus login at tablet width; empty and malformed forms; password visibility and Enter submission; Google preview feedback; route changes clearing fields; desktop/mobile account navigation; and Start creating opening the existing creation demo. Checks used dummy values. No horizontal overflow was observed at the checked mobile and tablet widths. `login-preview.png` and `signup-preview.png` show the implemented pages.

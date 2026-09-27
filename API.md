# Bark API

Every request goes through the gateway at **http://localhost:8080** (`APP_PORT` in `.env`).
The browser never talks to Django or the websocket service directly.

| Prefix | Served by |
| --- | --- |
| `/api/` | Django (`server/`) |
| `/ws/` | Websocket service (`ws/`) |
| `/admin/` | Django admin (uses Django's own login, not the JWT) |

## How auth works

- **Login sets a JWT in an HttpOnly cookie** called `access_token`. JavaScript can't read it, and
  the browser sends it automatically with every request to `/api/` and `/ws/`. It lasts
  **1 week** (`JWT_ACCESS_TTL_MINUTES`). After that the user logs in again.
- **Every POST needs a CSRF token.** Call `GET /api/auth/csrf/` once when the app loads. It
  sets the `csrftoken` cookie, and the shared axios instance (`web/src/lib/api.ts`) sends it back
  as the `X-CSRFToken` header. Without it, Django answers **403**.
- **All bodies are JSON** (`Content-Type: application/json`). So are all responses.
  Errors look like `{"error": "message"}`, sometimes with `"details": [...]`.

```ts
import { api } from "@/lib/api";

await api.get("/auth/csrf/");                              // once, on app load
await api.post("/auth/login/", { username, password });    // browser now holds the JWT cookie
```

---

## Endpoints

| Method | URL | JWT required | CSRF required | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/api/auth/csrf/` | No | No | Get the CSRF cookie |
| POST | `/api/auth/register/` | No | Yes | Create an account |
| POST | `/api/auth/login/` | No | Yes | Log in, sets the JWT cookie |
| GET | `/api/auth/me/` | **Yes** | No | The logged-in user |
| POST | `/api/auth/logout/` | No | Yes | Clear the JWT cookie |
| POST | `/api/auth/forgot-password/` | No | Yes | Email a password reset link |
| POST | `/api/auth/reset-password/` | No | Yes | Set a new password using the emailed token |
| POST | `/api/auth/forgot-username/` | No | Yes | Email the username |
| GET | `/api/auth/demo-inbox/?email=` | No | No | **Demo only.** Read the emails the app "sent" |
| WS | `/ws/` | **Yes** | No | Real-time collaboration |
| any | `/api/canvas/...` | **Yes** | Yes (writes) | Saved games: see [Canvas](#canvas-game-library-apicanvas) |

Apart from `/me/`, the `/api/auth/` endpoints don't need a JWT, because they're how you get
one. See [Protecting endpoints](#protecting-endpoints) for adding your own.

### Rate limits

| Limit | Where | Applies to | Response |
| --- | --- | --- | --- |
| 10 requests/minute per IP (burst of 10) | Gateway (`proxy/nginx.conf`) | POST login, register, forgot-password, reset-password, forgot-username | 429 |
| 5 failed logins per account in 15 minutes | Django (`@rate_limit`) | POST login | 429 + `Retry-After` |
| 300 requests/minute per user | Django (`@rate_limit`) | Every `/api/canvas/` endpoint | 429 + `Retry-After` |
| 20 requests/second per IP | Gateway | Everything else under `/api/` | 429 |

A locked account refuses even the correct password until the 15 minutes pass. Resetting the
password unlocks it immediately.

### GET `/api/auth/csrf/`

Sets the `csrftoken` cookie. No body.

**200** `{"message": "CSRF cookie set"}`

### POST `/api/auth/register/`

```json
{ "username": "alice", "email": "alice@example.com", "password": "Correct-Horse-9" }
```

The password must pass Django's password validators: at least 8 characters, not too common,
not all numbers, and not too similar to the username or email.

| Status | Body |
| --- | --- |
| 201 | `{"message": "User created successfully"}` |
| 400 | `{"error": "Missing required fields"}` |
| 400 | `{"error": "Invalid email format"}` |
| 400 | `{"error": "Email already registered"}` |
| 400 | `{"error": "User already exists"}` |
| 400 | `{"error": "Password is too weak", "details": ["This password is too common."]}` |

Registering doesn't log the user in. Call login afterwards.

### POST `/api/auth/login/`

```json
{ "username": "alice", "password": "Correct-Horse-9" }
```

`username` can also be the account's email.

| Status | Body |
| --- | --- |
| 200 | `{"message": "Logged in", "user": {"user_id": "…uuid…", "username": "alice", "email": "alice@example.com"}}` |
| 400 | `{"error": "Missing required fields"}` or `{"error": "Invalid JSON body"}` |
| 401 | `{"error": "Invalid username or password"}` (same for unknown user and wrong password) |
| 429 | `{"error": "Too many failed login attempts. Try again in 15 minutes or reset your password."}` |

On 200 the response also sets the cookie:
`access_token=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`.
`user_id` is the user's public id. It's also the JWT's `sub` claim and the id ws uses.

### GET `/api/auth/me/`

**Requires the JWT cookie.** No body. Call it on page load to check whether someone is logged in.

| Status | Body |
| --- | --- |
| 200 | `{"user": {"user_id": "…uuid…", "username": "alice", "email": "alice@example.com"}}` |
| 401 | `{"error": "Authentication required"}` (not logged in, expired, or invalid token) |

### POST `/api/auth/logout/`

No body. **200** `{"message": "Logged out"}` and the cookie is deleted.

### POST `/api/auth/forgot-password/`

```json
{ "email": "alice@example.com" }
```

Emails a link to `{FRONTEND_URL}/reset-password?token=…`. The token expires after 60 minutes
(`PASSWORD_RESET_MINUTES`) and stops working once the password is changed. The frontend page at
that URL reads `token` from the query string and posts it to `/api/auth/reset-password/`.

| Status | Body |
| --- | --- |
| 200 | `{"message": "If an account exists for that email, we've sent instructions to it."}` |
| 400 | `{"error": "A valid email is required"}` |

The 200 is identical whether or not the account exists, so this can't be used to find out who
has an account.

### POST `/api/auth/reset-password/`

```json
{ "token": "<token from the email link>", "password": "Brand-New-Pass-7" }
```

| Status | Body |
| --- | --- |
| 200 | `{"message": "Password updated"}`. The user then logs in with the new password. |
| 400 | `{"error": "This reset link is invalid or has expired"}` (bad, expired or already used token) |
| 400 | `{"error": "Password is too weak", "details": [...]}` |
| 400 | `{"error": "Missing required fields"}` |

### POST `/api/auth/forgot-username/`

```json
{ "email": "alice@example.com" }
```

Emails the username registered to that address. Same responses as forgot-password.

### GET `/api/auth/demo-inbox/?email=alice@example.com`

**Demo only.** Emails aren't really sent while `DEMO_EMAIL=1` (the default). They're saved, and
this endpoint returns the latest 20 for an address, newest first. Use it to show a "demo inbox"
in the UI so the reset flow can be shown live.

| Status | Body |
| --- | --- |
| 200 | `{"email": "alice@example.com", "messages": [{"subject": "Reset your Bark password", "body": "…link…", "from": "Bark <no-reply@localhost>", "sent_at": "2026-09-26T13:40:00+00:00"}]}` |
| 400 | `{"error": "A valid email is required"}` |
| 404 | Demo inbox disabled (`DEMO_EMAIL=0`) |

> Anyone who knows an email address can read its demo inbox, including its reset links.
> Keep `DEMO_EMAIL=1` for demos only.

The same emails are listed in the Django admin under **Demo emails**.

---

## Canvas: game library (`/api/canvas/`)

The dashboard's saved games. Every endpoint here **requires the JWT cookie**, needs the CSRF
header on writes (like all POST/PUT/PATCH/DELETE requests), and only sees **your own games**:
another user's game answers 404. (Collaborators come later, with live collaboration.)

A game is stored as the engine's `GameDocument`, split into sections so the editor can
save one small change at a time:

```jsonc
{
  "version": 1,
  "project": {
    "version": 1, "name": "My Game",
    "entities": [ { "id": "ground", "transform": {...}, "visual": {...}, ... } ],
    "assets": [], "materials": [], "prefabs": [],
    "properties": {}, "settings": {...}, "cameras": {...}, "input": {...}
  },
  "script": { "language": "python", "source": "print(\"Hello from Bark!\")\n" }
}
```

A new game without a document starts from the default above (`server/canvas/defaults.py`).
Keys the server doesn't know yet are kept and returned unchanged. Key order inside objects
may change (Postgres `jsonb`); JSON treats key order as meaningless.

**`revision`:** every write returns the game's new `revision`, which goes up by 1 on each
change. Compare it with the one you loaded to notice changes from another tab.

The frontend autosaves whole documents after 1.5 seconds without edits. It sends
`If-Match: "<revision>"` on game-detail PUT, PATCH and DELETE. The optional header is
checked atomically under the game row lock; a stale value returns **412** with
`{"error": "This game changed in another tab.", "revision": <current>}` without writing.
A malformed header returns 400. Clients omitting it retain the previous behavior.
Section/entity/library endpoints retain their existing contracts.

Creation also accepts an optional `id` UUID. Retrying POST with the same UUID and owner
returns the existing game with 200 without changing it; first creation returns 201.
An id owned by another user returns a generic 409 without revealing any game data.
The frontend keeps the first creation payload until acknowledged, so a lost response
cannot create duplicate games or silently discard edits made while the request was pending.
Autosave also sends `X-Bark-Owner: <user_id>` on creation and whole-document writes.
If another tab has changed the login cookie to a different account, the server returns
401 instead of saving the previous account's draft into the new account. This header is
an identity precondition, not authentication; the JWT still supplies authorization.

| Method | URL | Body | Success |
| --- | --- | --- | --- |
| GET | `/api/canvas/games/` | | 200 `{"games": [summary, ...]}` newest first |
| POST | `/api/canvas/games/` | `{"name"?, "document"?}` | 201 game |
| GET | `/api/canvas/games/<id>/` | | 200 game |
| PUT | `/api/canvas/games/<id>/` | whole `GameDocument` | 200 game |
| PATCH | `/api/canvas/games/<id>/` | `{"name": "New name"}` | 200 game |
| DELETE | `/api/canvas/games/<id>/` | | 204 |
| GET | `/api/canvas/games/<id>/<section>/` | | 200 `{"revision", "<section>": value}` |
| PUT | `/api/canvas/games/<id>/<section>/` | the section's whole new value | 200 `{"revision", "<section>": value}` |
| GET | `/api/canvas/games/<id>/entities/` | | 200 `{"revision", "entities": [...]}` |
| POST | `/api/canvas/games/<id>/entities/` | entity with a new `id` | 201 `{"revision", "entity"}` |
| GET | `/api/canvas/games/<id>/entities/<entity_id>/` | | 200 `{"revision", "entity"}` |
| PUT | `/api/canvas/games/<id>/entities/<entity_id>/` | whole entity | 200 `{"revision", "entity"}` |
| PATCH | `/api/canvas/games/<id>/entities/<entity_id>/` | only the keys to change | 200 `{"revision", "entity"}` |
| DELETE | `/api/canvas/games/<id>/entities/<entity_id>/` | | 200 `{"revision", "deleted": [ids]}` |
| GET | `/api/canvas/games/<id>/<library>/` | | 200 `{"revision", "<library>": [...]}` |
| POST | `/api/canvas/games/<id>/<library>/` | item with a new `id` | 201 `{"revision", "item"}` |
| GET | `/api/canvas/games/<id>/<library>/<item_id>/` | | 200 `{"revision", "item"}` |
| PUT | `/api/canvas/games/<id>/<library>/<item_id>/` | whole item | 200 `{"revision", "item"}` |
| DELETE | `/api/canvas/games/<id>/<library>/<item_id>/` | | 200 `{"revision", "deleted": id}` |

- `<section>`: `settings`, `cameras`, `input`, `properties` or `script`.
- `<library>`: `assets`, `materials` or `prefabs`.
- **summary:** `{"id", "name", "revision", "created_at", "updated_at"}`.
- **game:** a summary plus `"document"` (the whole `GameDocument`).

### Details

- **Create:** with no body, the game starts from the default document. `"name"` renames it,
  and `"document"` starts from your own document instead. Each user can have up to 100 games.
- **Sections:** `PUT` replaces the whole section. Send all of `settings`, not only
  `gravity`. `input` maps actions to key-code lists (`{"jump": ["Space"]}`). `script` is
  `{"language": "python", "source": "..."}` or `{"language": "blocks", "workspace": {...}}`.
- **Entities** keep their order, and new ones are added at the end. `id` and `transform` are
  required, `id` can't be changed, and `parentId` must name another entity in the game, with
  no loops. `PATCH` replaces each key you send whole: sending `transform` replaces the whole
  transform. `DELETE` also deletes the entity's children and grandchildren.
- **Limits:** 2000 entities, 500 items per library, and 200,000 characters of script. Request
  bodies can be up to 10 MB, because assets may be embedded as base64 `data:` URLs.

| Error | When |
| --- | --- |
| 400 `{"error": "..."}` | Invalid body; the message says which part, e.g. `entity 'hat': parent 'head' does not exist` |
| 401 | Not logged in |
| 404 | The game, entity or item doesn't exist, or isn't yours |
| 405 | Method not supported on that URL |
| 409 | `POST` with an `id` that's already used |
| 429 | Over `CANVAS_REQUESTS_PER_MINUTE` (300 per minute per user by default, shared by all canvas endpoints) |

```ts
const { data: game } = await api.post("/canvas/games/", { name: "Maze" });
await api.patch(`/canvas/games/${game.id}/entities/ground/`, { visible: false });
await api.put(`/canvas/games/${game.id}/script/`, { language: "python", source: "print('hi')\n" });
const { data } = await api.get(`/canvas/games/${game.id}/`);   // data.document -> engine
```

---

## Protecting endpoints

Two decorators live in `server/lib/decorators/`. They work on both sync and async views:

```python
from lib.decorators import jwt_required, rate_limit
from lib.decorators.rate_limit import client_ip

@require_GET
@jwt_required                    # 401 unless the request has a valid JWT
async def my_projects(request):
    request.user_id              # the JWT's sub (User.user_id)
    request.jwt_claims           # all claims

@jwt_required(load_user=True)    # also loads the User row -> request.jwt_user
async def me(request): ...

@require_POST
@rate_limit("forgot-password", key=client_ip, limit=5, window=60 * 60)   # 5 per IP per hour
async def forgot_password(request): ...
```

- **`jwt_required`** accepts the `access_token` cookie, or `Authorization: Bearer <jwt>` for
  non-browser clients.
- **`rate_limit`** options:
  - `key=`: who to count: `client_ip`, or `body_field("username", "email")`.
  - `count_statuses=`: count only some responses, e.g. `{401}` to count failed logins only.
  - `reset_statuses=`: responses that clear the counter, e.g. `{200}`.
  - Counters are stored in redis, so every server worker shares them.

Put `@require_GET` / `@require_POST` outermost, then `@jwt_required` / `@rate_limit`.

---

## Websocket: `/ws/`

| | |
| --- | --- |
| URL | `ws://localhost:8080/ws/` (`wss://` over HTTPS) |
| JWT required | **Yes.** The `access_token` cookie is sent automatically after login. |
| Allowed origins | Only `WS_ALLOWED_ORIGINS` (the frontend). Other origins get HTTP 403. |

```ts
import { openSocket } from "@/lib/socket";
const socket = openSocket();   // uses the login cookie
```

Without the cookie, the first message must be `{"type": "auth", "token": "<jwt>"}` within
5 seconds. A missing, invalid or expired JWT closes the socket with code **1008**. On success the
server sends `{"type": "ready", "user": "<user_id>"}`.

After that, the socket speaks the collaboration protocol (`join`, `lock`, `unlock`, `commit`,
`presence`, `heartbeat`). The full message reference is in
[ws/COLLAB-PROTOCOL.md](ws/COLLAB-PROTOCOL.md).

---

## Settings that change API behaviour

All in `.env` (see `.env.example`):

| Setting | Default | Effect |
| --- | --- | --- |
| `JWT_ACCESS_TTL_MINUTES` | `10080` (1 week) | How long a login lasts |
| `JWT_COOKIE_SECURE` | `1` | Cookie only sent over HTTPS or `http://localhost` |
| `JWT_ACCESS_COOKIE` | `access_token` | Cookie name (server and ws both read it) |
| `DEMO_EMAIL` | `1` | Save emails to the demo inbox instead of sending them |
| `FRONTEND_URL` | `http://localhost:8080` | Base of links in emails |
| `PASSWORD_RESET_MINUTES` | `60` | Reset link lifetime |
| `WS_ALLOWED_ORIGINS` | `http://localhost:8080` | Origins allowed to open `/ws/` |
| `LOGIN_MAX_FAILURES` | `5` | Failed logins before an account is locked |
| `LOGIN_LOCKOUT_MINUTES` | `15` | How long the lock lasts |
| `CANVAS_REQUESTS_PER_MINUTE` | `300` | Canvas requests per user per minute |
# Public marketplace

Saved-game summaries include `publication: {is_public}` for owners and collaborators.
All existing games start private. Publication does not increment the document revision.

| Endpoint | Access and behavior |
| --- | --- |
| `GET /api/marketplace/games/?q=&page=1` | Anonymous. Searches game/creator names, newest first publication first, 24 per page. Returns `{games, count, page, has_more}`; list rows contain metadata only. |
| `GET /api/marketplace/games/<id>/` | Anonymous. Latest coherent saved document and public metadata; 404 for private, unpublished, or deleted games. |
| `GET /api/marketplace/games/<id>/publication/` | Owner only. Returns `{id, is_public, published_at}`. |
| `PUT /api/marketplace/games/<id>/publication/` | Owner only, CSRF protected. Body `{is_public: boolean}`; optional `X-Bark-Owner` guards account switches. Idempotent; first publication date survives unpublish/republish. |
| `GET /api/marketplace/games/<id>/cover/` | Anonymous only while public; PNG or 404. |
| `PUT /api/marketplace/games/<id>/cover/` | Owner only, CSRF protected. `{revision, png}` with base64 PNG (maximum 400 KB, 800×600). Returns 409 if unpublished or document revision changed; never changes visibility. |

Public responses use `no-store`. Metadata includes `id`, `name`, `creator` (username),
`revision`, `published_at`, `updated_at`, and `cover_url`; no email or member roster.
Publishing controls are limited to 60 requests per minute per account. Unpublishing
blocks future reads; a game already downloaded into a player remains playable.

# Shared workspaces

Each saved Canvas game has one owner. Game summaries/details additionally return
`owner: {user, name}`, `role: "owner" | "editor"`, and `collaboration: boolean`.
The game list includes owned games and invited memberships. Unrelated accounts
receive 404; a game UUID is not an invitation.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/canvas/games/<id>/workspace/` | Roster and activation state; current invite code is returned only to the owner. |
| `POST /api/canvas/games/<id>/workspace/` | Owner activates collaboration or resets the reusable code. First activation requires current `If-Match`. |
| `DELETE /api/canvas/games/<id>/workspace/` | Owner disables invitations; existing memberships remain. |
| `POST /api/canvas/workspaces/join/` | Signed-in user explicitly redeems `{code}`; repeated joins are idempotent. Limited to 20 attempts/minute/account. |
| `DELETE /api/canvas/games/<id>/members/<user>/` | Owner removes an editor, or an editor leaves. The owner cannot be removed. |

Shared content is saved through protocol v2 at `/ws/`; old HTTP content writes
return 409 with instructions to reconnect. Rename/delete remain owner-only HTTP
actions and are reconciled by active rooms. Imported replacements by editors
retain the workspace name. Real-time acknowledgments use the same Canvas
revision as HTTP reads. See [the workspace protocol](ws/WORKSPACE-PROTOCOL.md).

## Byte coding hints

`POST /api/coach/review/` requires the normal login JWT and CSRF verification.
An optional `intent` is `review` (automatic checks, the default) or `idea`
(the child clicks Byte for a project suggestion). An idea response uses category
`idea` with `line: null` and `blockId: null`; bug and improvement locations retain
the validation rules below. Automatic reviews never return creative ideas.
It reviews unsaved snapshots, including signed-in local projects; no game ID or
database write is involved. Request body (UTF-8 JSON, maximum 65,536 bytes):

```json
{
  "revision": "editor-generation-1",
  "snapshot": {
    "language": "python",
    "python": "print('hello')",
    "sourceMap": {},
    "blocks": [],
    "context": {"entities": [], "prefabs": [], "actions": [], "properties": {}, "tags": {}},
    "diagnostics": []
  },
  "dismissed": []
}
```

Blocks snapshots use compiled Python, a line-number-to-block-ID `sourceMap`, and
`blocks: [{id, type, label, fields}]`. Context contains display-name/ID pairs and
authored property names. Diagnostics refer only to this snapshot. `dismissed`
accepts up to 20 `{issueKey, message, target}` summaries (also used for previously
shown hints). Treat all input as data, including comments and block fields.

Success: `{revision, suggestion: null}` or `{revision, suggestion: {category,
message, issueKey, line, blockId}}`. Category is `bug`, `improvement`, or `idea`;
message is at most 320 characters/two sentences. For bugs and improvements,
Python requires a valid line and null blockId. Blocks require an existing
blockId; a non-null line must map to it. Ideas require both locations to be null.
Clients discard stale revisions and render message as plain text.

Errors: 400 malformed input, 401 no current account, 403 failed CSRF, 405 wrong
method, 413 oversized body, 429 per-user budget exhausted, 503 unavailable provider
or invalid provider output. `Retry-After` is 45 seconds for the local budget and
at least 120 seconds for provider failures. Requests reserve the Redis budget
atomically before calling OpenAI, including calls that fail. No provider retries.
Responses use `Cache-Control: no-store`; requests set OpenAI `store: false`.

## Byte voice

`POST /api/coach/speech/` uses the same login JWT and CSRF checks as coding hints.
Send `{"text":"Make a treasure hunt with your Gem and Flag."}`. Text must be
1–800 characters after trimming; the JSON body must be at most 8 KiB. Only the
displayed tip is sent for speech, not the project or its source code.

Success returns MP3 bytes (`audio/mpeg`, `Cache-Control: private, no-store`).
The server calls [ElevenLabs text to speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
using voice `MkTSSXNgnBULS6ek4pon`, model `eleven_flash_v2_5`, and output format
`mp3_44100_128`. Voice/model selection and the API key are server-side only;
clients cannot override them. Provider calls time out after 20 seconds, accept at
most 2 MiB of audio, and do not retry automatically. Each account is limited to
one concurrent request and six requests per minute, including failed calls.

Errors: 400 malformed input, 401 no current account, 403 failed CSRF, 405 wrong
method, 413 oversized body, 429 request limit (`Retry-After`), 503 provider/key
unavailable (`Retry-After: 120`). Errors never include provider details or keys.

Set `ELEVENLABS_API_KEY` in the root `.env` using a key with Text to Speech access
and access to the selected voice. `ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL_ID`
have the defaults above; `BYTE_VOICE_ENABLED=0` disables the endpoint. These
settings belong to Django; never use a `NEXT_PUBLIC_` key. After changing `.env`,
recreate the server so Compose reloads it (a restart alone does not reload env):

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --no-deps server
```

Byte speaks after a user clicks him and an AI review finishes, or reads the local
fallback if AI is unavailable. Sound is on initially; the **Sound on/off** toggle
in his bubble remembers the browser's choice and silences speech. Byte's click
does not play a synthesized sound effect; audio comes from ElevenLabs only.
**Hear tip** replays the current message. Up to eight clips are cached in memory
for replay, scoped to the current assistant/account. Closing the bubble, switching
editor tabs, hiding the browser tab, changing the tip, or muting cancels playback
and discards stale responses. Speech needs a signed-in account; guests still get
text tips. Missing credentials or blocked audio never prevent reading the bubble.

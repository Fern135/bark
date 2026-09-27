# bark

**Production hosting:** [Oracle Always Free deployment](deploy/README.md) covers the
separate HTTPS Compose stack, release tooling, private backups, recovery and checks.

**API reference:** [API.md](API.md) lists every endpoint, its body, and whether it needs a JWT.

| Directory | What it is | Port (internal only) |
| --- | --- | --- |
| `web/` | Next.js (TypeScript, Bootstrap 5, axios) | 3000 |
| `engine/` | `@bark/engine`: Babylon.js + Havok game engine (browser library) | build-only |
| `scripting/` | `@bark/scripting`: Blockly/Python (Pyodide) scripting (browser library) | build-only |
| `server/` | Django API (JWT + view decorators) | 8000 |
| `ws/` | Python websocket service (FastAPI + asyncpg) | 8001 |
| `proxy/` | nginx gateway, the **only** public entrypoint | 8080 → `APP_PORT` |
| _db_ | PostgreSQL 17, shared by `server` and `ws` | 5432 |

```
browser ──► proxy :8080 ─┬─ /        ─► web
                         ├─ /api/    ─► server ─┐
                         ├─ /admin/  ─► server  ├─► db
                         └─ /ws/     ─► ws ─────┘
```

`web`, `server`, `ws` and `db` sit on an `internal: true` Docker network. Nothing can reach them
directly from outside. Django also joins `coach_egress` for outbound OpenAI requests;
the other application/data services have no internet route. The browser only talks to the gateway, so every
API call comes from the Next.js frontend on the same origin. The ws service also rejects any
socket whose `Origin` isn't in `WS_ALLOWED_ORIGINS`, and any connection without a valid JWT.

`engine` and `scripting` never run as containers. The web image builds both browser packages
from the repository root (see [engine/ and scripting/](#engine-and-scripting)).

---

## Byte coding hints

Signed-in users get occasional advice in the Code tab, with a per-account browser
toggle. Configure `OPENAI_API_KEY` in the root `.env` (never a `NEXT_PUBLIC` variable).
`BYTE_HINTS_ENABLED=0` disables provider calls; an empty key also leaves hints unavailable.
`OPENAI_MODEL` defaults to `gpt-5.4-mini-2026-03-17`. Restart Django after changing settings.
The editor waits five seconds after a code edit, limits reviews/hints to one per
45 seconds, and sends a bounded script/context snapshot. Hints never edit or save code.
OpenAI requests use `store: false`; Bark does not retain review source or history.

Run `python manage.py test coach` from `server/` and the `byte-hints*.spec.ts`
Playwright tests from `web/`. See `server/coach/fixtures.json` for the live quality
check corpus and `server/coach/smoke.py` for the opt-in provider check.

## Setup (first time)

```bash
cp .env.example .env
# then replace every "change-me" with a real secret:
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
```

`JWT_SECRET` must be the same for `server` and `ws`. Both read it from `.env`.

## Run everything (one command)

```bash
docker compose up -d --build
```

Open http://localhost:8080

The web image creates its optional `public` asset directory during the build. Shell entrypoints use LF line endings, enforced by `.gitattributes`, including on Windows checkouts. Docker Desktop's Linux engine must be running before building or starting the stack.

## Run in dev mode (hot reload)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

This bind-mounts `web/`, `engine/`, `scripting/`, `server/` and `ws/` into their containers. It runs `next dev`,
`manage.py runserver` (with `DJANGO_DEBUG=1`) and `uvicorn --reload`.

Changes in `engine/`, `scripting/` or `web/package.json` are picked up when you rerun this
command, not by hot reload. On start, the web container refreshes outdated `node_modules`
volumes for all three JavaScript packages from the freshly built image, so no `-V` is needed.


<!-- migration -->
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
docker compose exec server python manage.py migrate
```

<!-- create new app -->
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec server python manage.py startapp <app_name>
```


## Other useful Docker commands

```bash
docker compose ps                          # status of every service
docker compose logs -f                     # follow all logs
docker compose logs -f server              # follow one service
docker compose down                        # stop everything
docker compose down -v                     # stop AND delete the database volume (destructive)
docker compose restart ws                  # restart one service
docker compose up -d --build web           # rebuild + restart one service

docker compose exec server python manage.py makemigrations
docker compose exec server python manage.py migrate
docker compose exec server python manage.py createsuperuser
docker compose exec server python manage.py shell
docker compose exec server python manage.py test --parallel auto   # Django tests (redis DB 15, never the app's cache)
docker compose logs server | grep '\[tests\]'   # results of the tests that run on every server start
docker compose exec db psql -U bark -d bark    # Postgres shell
```

In dev mode, add `-f docker-compose.yml -f docker-compose.dev.yml` after `docker compose`.

---

## server/ (Django)

The Django project is `server/server/` (settings in `server/server/settings.py`, WSGI module
`server.wsgi`, set by `DJANGO_WSGI_MODULE` in `.env`). Environment values are loaded by
`server/config/Config.py` and used in `settings.py`.

On start, the container runs `migrate` and then gunicorn. Set `DJANGO_MIGRATE_ON_START=0` to skip
the migration. `settings.py` should read its values from the environment, not hard-code them:

| Env var | Use in settings.py |
| --- | --- |
| `DJANGO_SECRET_KEY` | `SECRET_KEY` |
| `DJANGO_DEBUG` | `DEBUG = os.environ.get("DJANGO_DEBUG") == "1"` |
| `DJANGO_ALLOWED_HOSTS` | `ALLOWED_HOSTS` (comma-separated) |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `CSRF_TRUSTED_ORIGINS` (comma-separated) |
| `POSTGRES_DB/USER/PASSWORD/HOST/PORT` | `DATABASES["default"]` (`ENGINE: django.db.backends.postgresql`) |
| `JWT_SECRET`, `JWT_ALGORITHM`, `JWT_ISSUER`, `JWT_AUDIENCE` | signing/verifying tokens |

The gateway sends `X-Forwarded-Proto`, so set
`SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")`. Put
`argon2.PasswordHasher`/`Argon2PasswordHasher` first in `PASSWORD_HASHERS`.

**JWT contract with `ws/`:** the ws service accepts a token only if all of these hold:

- it is signed with `JWT_SECRET` / `JWT_ALGORITHM`
- it has `sub` (the user id), `iat` and `exp`
- its `iss` equals `JWT_ISSUER` and its `aud` equals `JWT_AUDIENCE`
- its `type` is `"access"` (or it has no `type` claim)

The ws service reads the token from the HttpOnly cookie named `JWT_ACCESS_COOKIE`
(`access_token`) when present. Otherwise the client must send `{"type": "auth", "token": "..."}`
as its first message.

## web/ (Next.js)

### Preview the marketing frontend locally

Use Node.js 22 to match the Docker image. From the repository root:

```bash
cd web
npm ci
npx next dev
```

Open http://localhost:3000. The homepage runs without backend services or a local
`.env` file. Edit `web/src/app/page.tsx` to update it; the dev server reloads changes.

This direct Next.js command previews the marketing page and component showcase
without preparing engine assets. Use the Docker stack for the integrated runtime;
`npm run dev` and `npm run build` run the engine asset preparation hooks described below.

Open http://localhost:3000/components for the interactive Bark UI showcase.
Reusable controls and their usage notes live in `web/src/components/ui/`.

The homepage at `/` is Bark's animated marketing landing page, including a local
creation demo. Design references, the generated concept, and asset notes are in
`web/design/`. The demo keeps customization in page state and does not save or
publish projects.

For API and WebSocket integration, use the Docker dev stack above and open
http://localhost:8080. The local Next.js server alone does not proxy `/api` or `/ws/`.

Run the frontend checks from `web/`:

```bash
npm run lint
npx next build
```

The build checks TypeScript and generates `.next/standalone/server.js` for the
production Docker image. The Dockerfile also copies the static assets needed by
that server.

### Accounts and saved worlds

Email/password signup and login use Django's HttpOnly session cookie. Signup logs in
automatically. Recovery pages support password and username reminders; when `DEMO_EMAIL=1`,
they show the demo inbox instead of sending real email. Google sign-in is hidden.

`/games` is the public community collection; `/games?source=demos` retains the six Bark demos.
`/my-games` lists the current account's saved
worlds, with edit, play, rename and delete controls. Saved games open at `/editor?id=<uuid>`
and play at `/my-games/<uuid>`. Guests can use `/editor` and export JSON without an account.
The editor's sign-in action preserves the guest draft and returns to it after authentication.

Authenticated edits autosave after 1.5 seconds of inactivity. Save status is separate from
playback and exporting a file does not mark cloud changes saved. IndexedDB keeps local
recovery drafts per account/project; restore prompts appear for unsaved work. Changing
accounts never transfers another account's draft. Conflict actions reload the saved version
or save local work as a new copy. Offline/server failures retry with backoff; validation
errors require correction and Retry save. Keep the tab open or export JSON if local storage
is unavailable. Whole-document saves retain the API's 10 MB request limit.

Run the real integration suite against the running Docker gateway (demo email enabled):

```bash
cd web
npm run test:integration
```

`BARK_INTEGRATION_URL` overrides the default `http://localhost:8080`;
`BARK_BROWSER_CHANNEL` selects a browser (defaults to installed Chrome). Tests create unique
test accounts and worlds, so use a development database. The suite exercises real cookies,
CSRF, guest-draft adoption, autosave, reopen/play, conflicts, recovery and account expiry.
The ordinary Playwright suite remains standalone and excludes integration tests.

For backend checks without Docker, install `server/requirements.txt` in an isolated Python
environment and run:

```bash
python server/manage.py test canvas authenticator --settings=server.test_settings --noinput
```

This opt-in configuration uses SQLite and an
in-memory cache; it does **not** prove PostgreSQL row locking or Redis behavior. The normal
Docker test command remains the production-stack validation path. No schema migration is
needed for this integration.

### Publishing games

Owners publish directly from the editor or My Games. Publishing waits for cloud saves;
afterward every successful save is public, including collaborator edits. Only the owner
can change visibility. Public links at `/games/<uuid>` work without an account. Unpublish
removes discovery and prevents new downloads; already-open play sessions continue.
Community games have no remix action. Covers are best-effort snapshots captured without
executing Python, with Bark artwork as the fallback.

Community playback uses an opaque-origin `sandbox="allow-scripts"` iframe, a dedicated
static player bundle, and a blob worker that inherits the frame's restrictive CSP.
The frame receives only the public game over a MessageChannel; its allowed network paths
are static runtime files and artwork, never `/api` or `/ws`. Runtime files have anonymous
CORS headers. Editor saves embed model/texture assets using `serializeGame`; documents
submitted directly to the API must also embed their assets to play in this frame.

`npm run prepare:editor` builds the public player under the ignored
`web/public/community-runtime/` directory. Docker builds run this automatically, and
server startup applies the new marketplace migration. No separate runtime service is needed.
Run focused integration coverage with `npm run test:integration -- tests/integration/publishing.spec.ts`.
Design references and the generated publishing concept are in `web/design/publishing/`.

### API clients

- `src/lib/api.ts` is the shared axios instance. In the browser it calls `/api` (same origin).
  During SSR it calls `http://server:8000/api` over the internal network. It already sends
  Django's `csrftoken` cookie as the `X-CSRFToken` header.
- `src/lib/socket.ts` has `openSocket()`, which connects to `/ws/`.
- Bootstrap CSS is imported in `src/app/layout.tsx`.
- `src/lib/game.ts` has the URLs and worker factory that engine/scripting need (see below).

## engine/ and scripting/

Both are browser libraries (rendering, physics and Python all run in the user's tab), bundled
into web through local `file:` dependencies. `web/Dockerfile` uses the repository root as its
build context, installs all three packages, and builds the engine and scripting packages before
Next.js. They have no running service or network endpoint.

For local development, run `npm ci` in `engine/`, `scripting/`, and `web/`, then `npm run dev`
in `web/`. Open `/editor` to build a world or `/games` for the game library.

The `npm run dev` / `npm run build` hooks run `prepare:editor` to build the packages and copy
runtime files into `web/public/` (gitignored). Both the editor's `/runtime/` paths and the
existing URLs below are generated. The web container has no internet, so everything is served locally:

| URL | What |
| --- | --- |
| `/pyodide/` | Pinned Pyodide (Python) files, ~13 MB |
| `/havok/HavokPhysics.wasm` | Havok physics WASM |
| `/scripting/worker.js` | Scripting's Python worker |

Use them from a `"use client"` component, importing dynamically inside an effect:

```tsx
const { createGamePlayer } = await import("@bark/scripting/player");
const player = await createGamePlayer({
  canvas,
  havokWasmUrl: HAVOK_WASM_URL,       // from @/lib/game
  pythonRuntimeUrl: PYODIDE_URL,
  workerFactory: createPythonWorker,  // required under Next.js
});
```

`workerFactory` is needed because Next's bundler can't resolve the worker URL baked into
scripting's build. The build prints a harmless `Module not found: Can't resolve <dynamic>`
warning for that line.

Rebuild just the packages and web with `docker compose build web`.

## ws/ (websockets)

- `app/main.py`: the `/ws/` endpoint (origin check → JWT auth → message loop, currently echo)
- `app/auth.py`: JWT validation
- `app/db.py`: asyncpg pool to the same Postgres as Django. Always use `$1, $2` parameters.

## Python dependencies

`server/requirements.txt` and `ws/requirements.txt` pin every package, sub-dependencies included,
to an exact version. Before changing a version, check it for known vulnerabilities:

```bash
pip install pip-audit
pip-audit -r server/requirements.txt
pip-audit -r ws/requirements.txt
```

---

## Git cheat sheet

### Branches

```bash
git checkout main && git pull              # start from an up-to-date main
git checkout -b feature/my-feature         # create + switch to a new branch
git switch -c feature/my-feature           # same thing, newer syntax
git push -u origin feature/my-feature      # push branch and set upstream
git branch                                 # list local branches
git branch -a                              # list local + remote branches
git switch main                            # switch branches
git branch -d feature/my-feature           # delete a merged local branch
git push origin --delete feature/my-feature  # delete the remote branch
```

### Rebase

```bash
# Put your branch on top of the latest main
git fetch origin
git rebase origin/main

# If there are conflicts: fix the files, then
git add <file>
git rebase --continue
# or give up and go back to how things were
git rebase --abort

# Clean up your last N commits (squash / reword / reorder) before opening a PR
git rebase -i HEAD~3

# After rebasing a branch you already pushed
git push --force-with-lease                # safer than --force; refuses if someone else pushed
```

### Everyday

```bash
git status                                 # what changed
git diff                                   # unstaged changes
git diff --staged                          # staged changes
git add -p                                 # stage changes hunk by hunk
git commit -m "message"
git commit --amend                         # edit the last commit (before pushing)
git log --oneline --graph --decorate --all # compact history tree
git pull --rebase                          # pull without a merge commit
```

### Undo / recover

```bash
git restore <file>                         # discard unstaged changes to a file
git restore --staged <file>                # unstage a file
git reset --soft HEAD~1                    # undo last commit, keep changes staged
git revert <commit>                        # new commit that undoes <commit> (safe on shared branches)
git reflog                                 # find "lost" commits after a bad reset/rebase
```

### Stash

```bash
git stash                                  # shelve uncommitted work
git stash -u                               # include untracked files
git stash list
git stash pop                              # re-apply and drop the latest stash
```

### Misc

```bash
git cherry-pick <commit>                   # copy a commit onto the current branch
git merge --no-ff feature/my-feature       # merge keeping a merge commit
git tag -a v1.0.0 -m "v1.0.0" && git push origin v1.0.0
git clean -fdn                             # preview removing untracked files (-f to actually do it)
git blame <file>                           # who changed each line
```
# Collaborative workspaces

Open a saved game and choose **Collaborators → Invite collaborators**. The first
invite switches that game to live editing. Owners manage reusable codes, members,
name, and deletion; invitees are editors. Redeem codes at `/join`; joined games
appear under **My Games → Shared with me**. Resetting/disabling a code does not
remove existing members.

Live editing uses Canvas persistence through the websocket service. Different
objects and block stacks can be edited concurrently; locks protect the same
object, script, or world section. Python has one active editor. Disconnection
pauses shared changes and preserves pending work locally. Play sessions remain
local and never broadcast runtime state.

Apply `python manage.py migrate` in `server` before starting websocket workers.
The ws Docker build now uses the repository root and includes Django's shared
transaction code. Keep PostgreSQL/JWT settings identical between services and
configure Redis for multiple workers. Legacy standalone collaboration tables are
left untouched; websocket startup no longer owns migrations.

Validation: Django `canvas.test_collaboration`, pytest `ws/tests`, and
`npm --prefix web run test:integration -- collaboration.spec.ts`. Browser tests
default to the Docker gateway; `BARK_INTEGRATION_URL` overrides the URL and
`BARK_TEST_OUTPUT` isolates test artifacts. Use PostgreSQL and multiple websocket
workers with Redis for concurrency proof; SQLite/LocalBus is development only.

For a gateway run with two socket instances: `docker compose up -d --build --scale ws=2`.
Then run `npm --prefix web run test:integration -- collaboration.spec.ts`. The
proxy balances socket connections across the instances; Redis distributes edits.
On Windows, Docker Desktop requires Virtual Machine Platform and virtualization
to be enabled. An unavailable Linux engine leaves this validation unverified.

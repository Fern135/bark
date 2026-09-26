# bark

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
from outside, and they cannot reach the internet. The browser only talks to the gateway, so every
API call comes from the Next.js frontend on the same origin. The ws service also rejects any
socket whose `Origin` isn't in `WS_ALLOWED_ORIGINS`, and any connection without a valid JWT.

`engine` and `scripting` never run as containers. Their images only build the packages, and web's
image build is the only thing that uses them (see [engine/ and scripting/](#engine-and-scripting)).

---

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
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -V
```

This bind-mounts `web/`, `server/` and `ws/` into their containers. It runs `next dev`,
`manage.py runserver` (with `DJANGO_DEBUG=1`) and `uvicorn --reload`.

`-V` (`--renew-anon-volumes`) makes web use freshly built packages. Without it, dev mode keeps
the old `node_modules` volume and ignores changes to `engine/`, `scripting/` or `web/package.json`.
Changes in `engine/` or `scripting/` are picked up when you rerun this command, not by hot reload.


<!-- migration -->
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -V
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

- `src/lib/api.ts` is the shared axios instance. In the browser it calls `/api` (same origin).
  During SSR it calls `http://server:8000/api` over the internal network. It already sends
  Django's `csrftoken` cookie as the `X-CSRFToken` header.
- `src/lib/socket.ts` has `openSocket()`, which connects to `/ws/`.
- Bootstrap CSS is imported in `src/app/layout.tsx`.
- `src/lib/game.ts` has the URLs and worker factory that engine/scripting need (see below).

## engine/ and scripting/

Both are browser libraries (rendering, physics and Python all run in the user's tab), bundled
into web. They connect to web **only through Docker**:

1. `engine/Dockerfile` builds `@bark/engine` into a build-only image.
2. `scripting/Dockerfile` builds `@bark/scripting` against that engine image. It gets it through
   the `engine` build context in `docker-compose.yml`.
3. `web/Dockerfile` copies both into `node_modules/@bark/` via its `engine` and `scripting`
   build contexts.

They have `scale: 0` in `docker-compose.yml`: compose builds them but never creates a container,
and they join no network, so `server`, `ws`, `db` and `proxy` cannot reach them. `web/package.json`
does not reference them, so `web` only runs through docker compose. Outside Docker, `npm run dev`
in `web/` stops with an explanation.

Before `next dev` / `next build`, `web/scripts/copy-game-assets.mjs` copies the runtime files into
`web/public/` (gitignored). The web container has no internet, so everything is served locally:

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

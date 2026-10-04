# Improvement plan

> **Status: implemented in 2.0.0.** You approved all the defaults below, with one change: Baileys is pinned to **6.7.24, the latest stable release, in both services** (7.x is still a release candidate). Deviations made during implementation, with reasons:
> - `ruhend-scraper` turned out to contain obfuscated code, and every free download API was dead or paywalled when checked, so all downloaders now use **yt-dlp** (a system tool installed alongside ffmpeg).
> - The AI features use **Claude via the official Anthropic SDK** (your own key), because the free AI endpoints no longer worked.
> - `.imagine` and `.sora` were removed: no working provider remains.
> - Docker images could not be built on the development machine (the Docker daemon was not running); the compose file was validated.
>
> See [CHANGELOG.md](../CHANGELOG.md) for everything that changed.

This is the ordered list of changes for Phase 4. Nothing here has been done yet. Each step will be one or more small commits, and the project stays runnable after every commit. Finding IDs (P-xx, B-xx, D-xx, R-xx) refer to [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

## Decisions I need from you

Each decision has a recommended default. Reply "approve" to accept all defaults, or name the ones you want changed.

| # | Decision | Options | Recommended |
|---|---|---|---|
| 1 | **Baseline commit** | (a) commit the untouched code as-is. The hardcoded secrets (Mega password, Telegram token, API keys) then live in local git history. (b) commit the untouched code with only the secret values blanked out. | **(a)**, as you asked, on the condition that **this history is never pushed**. DEPLOYMENT.md will explain how to publish a clean history (`git checkout --orphan`) if you ever want a public repo. The secrets must be rotated either way. |
| 2 | **How the pairing service delivers the session** (P-07) | (a) write the session folder directly to a path on the server that the bot reads (nothing leaves the server). (b) keep sending `creds.json` to your WhatsApp chat. (c) both, chosen by `PAIR_DELIVERY=local\|whatsapp`. | **(c), default `local`.** |
| 3 | **`.vv` (reveal view-once)** (B-13) | owner only / remove / keep public | **owner only** |
| 4 | **Global `.ban`** (B-11) | owner/sudo only / per-group bans by group admins | **owner/sudo only.** Group admins already have `.kick`, `.warn` and antilink. |
| 5 | **Features that upload user images to public hosts or send chat text to third parties** (`.tourl`, `.remini`, `.removebg`, misc canvas commands, `.chatbot`) | keep enabled / disabled unless turned on in `.env` | **Keep enabled, except `.chatbot`, which defaults off.** Each one is marked "uses external service" in `.help`. The chatbot no longer sends history. |
| 6 | **Tech stack** (see §4) | stay JavaScript + JSON files / TypeScript / SQLite | **Stay JavaScript + JSON files** (with atomic writes) for this pass. TypeScript and SQLite are offered as later, separate steps. |
| 7 | **Baileys version** (D-02) | both services pinned to `7.0.0-rc14` / both pinned to `6.7.24` | **Both on `7.0.0-rc14`, pinned exactly.** The bot code already depends on v7 LID handling. It is a release candidate (the npm "latest" tag), which the docs will state. |

## 1. Ordered changes

Legend for **Risk**: what could break. **Affects**: existing behaviour you will notice.

### Step 0. Repository setup
| What | Why | Risk | Affects |
|---|---|---|---|
| `git init` at the workspace root and commit the untouched code as the baseline (see Decision 1). | Reversibility; a clean diff for every later change. | none | none |
| Root `.gitignore` (ASCII) for `node_modules/`, `.env*` (except `.env.example`), every session folder, `qr_sessions/`, `baileys_store.json`, runtime `data/*.json`, `tmp/`, `temp/`, `logs/`. Delete `MD-main/.gitignore` (UTF-16, ineffective). Add `.gitattributes` (LF line endings). | R-01: prevents committing creds. | none | none |

### Step 1. Pairing service: critical fixes (P-01, P-02, P-03, P-08)
| What | Why | Risk | Affects |
|---|---|---|---|
| Move `pair.html` into `public/` and serve only that folder. | P-02 | low | none for users |
| Validate `number` (string, digits only, valid E.164) **before** any filesystem work. Create temp session dirs with `mkdtemp` under `SESSIONS_DIR`, outside `public/`. Remove the user-controlled `rmSync`. | P-01, P-08 | low | invalid input now gets a clean 400 |
| Delete `mega.js` and the Mega instructions in the README. | P-03 (dead code holding credentials) | none | none |
| Async error wrapper. Remove the global `uncaughtException` swallowers. | P-08 | low | errors become visible in logs |

### Step 2. Pairing service: lifecycle, abuse limits, config (P-04, P-05, P-06, P-09, P-10)
| What | Why | Risk | Affects |
|---|---|---|---|
| `config.js`: reads `.env`, validates, fails fast. Variables: `PORT`, `HOST` (default `127.0.0.1`), `PAIR_ACCESS_TOKEN` (required), `PAIR_DELIVERY`, `SESSION_OUTPUT_DIR`, `SESSIONS_DIR`, `MAX_CONCURRENT_SESSIONS`, `RATE_LIMIT_*`, `PAIR_TIMEOUT_SECONDS`, `LOG_LEVEL`, `TRUST_PROXY`. | One source of config. | low | you must create `.env` |
| Access token: the page asks for it and the API requires it in a header. | P-05: strangers can't use your server. | low | you enter a token once per browser session |
| Per-IP rate limiting, a global concurrency cap, a hard per-request timeout, bounded retries with exponential backoff. **Always `sock.end()`** after delivery, timeout or error, then delete the temp folder in `finally`. | P-04, P-05 | medium: needs care with Baileys' "restart required" (515) during pairing | the server no longer stays linked to your account |
| Delivery modes (Decision 2). `local` copies the finished session folder to `SESSION_OUTPUT_DIR` (the bot's `session/`, never overwriting an existing registered session without `PAIR_OVERWRITE=true`). `whatsapp` keeps today's behaviour without promo messages. | P-07, P-10 | low | see Decision 2 |
| `helmet` + CSP, `x-powered-by` off, axios CDN replaced with `fetch`, icons removed or self-hosted, `GET /healthz`. Redact phone numbers in logs and never log codes. | P-09 | low | the page looks slightly plainer |
| Remove the README link to the third-party hosted instance. | P-06 | none | none |
| Pin dependencies, drop `path`, `phone`, `qrcode-terminal` and `body-parser`, commit the lockfile, `engines: >=22.12`. | D-02 | low | none |

### Step 3. Bot: remove dangerous and unwanted code (B-01, B-14, P-06, B-16)
| What | Why | Risk | Affects |
|---|---|---|---|
| Delete `commands/update.js` and the `.update` route. | B-01 remote code execution | none | **`.update` removed.** Updating is done on the server (documented). |
| Delete both `fs.watchFile` self-reloads. | B-14 | none | none |
| Delete dead files: `commands/pair.js`, `commands/gif.js`, `commands/sticker-alt.js`, `lib/ytdl2.js`, `lib/myfunc2.js`, `lib/sticker.js`, `lib/antilinkHelper.js`, `lib/tempCleanup.js`, unused helpers in `lib/uploader.js`, `data/owner.json`, `data/premium.json`, `.github/FUNDING.yml`, broken npm scripts. | dead code, upstream numbers | none | none |
| Remove the newsletter "forwarded" decoration, the connect promo, upstream channel and support links, and upstream branding defaults. Bot name and owner name come from config. | B-16 | none | replies no longer show "Forwarded from Akram MD"; `.github` shows *your* configured repo URL or is hidden if unset |

### Step 4. Bot: configuration module
| What | Why | Risk | Affects |
|---|---|---|---|
| `src/config.js` loads `.env` once, validates types, and **refuses to start** with a clear message if required values are missing or invalid. Required: `OWNER_NUMBERS` (comma-separated, with country code). Optional: `BOT_NAME`, `OWNER_NAME`, `PREFIX` (default `.`), `MODE` (`public`/`private`), `SESSION_DIR`, `DATA_DIR`, `TMP_DIR`, `LOG_LEVEL`, `HEALTH_PORT`/`HEALTH_HOST`, `PAIRING_NUMBER`, size limits, feature flags, and every API key (`NEWSAPI_KEY`, `OPENWEATHER_KEY`, `TENOR_KEY`, `TELEGRAM_BOT_TOKEN`, `PRINCETECH_KEY`, …). | B-05 and Goal 4 | low | **you must move your settings to `.env`**; `settings.js` and `config.js` are removed |
| Commands whose key is missing are disabled at load time and left out of `.help`, with a log line explaining why. | B-05 | low | **`.news`, `.weather`, `.emojimix`, `.tg`, `.remini` stop working until you add your own keys** |
| `.env.example` with every variable explained. | Goal 4 | none | none |

### Step 5. Bot: permissions (B-02, B-06, B-11, B-19)
| What | Why | Risk | Affects |
|---|---|---|---|
| `src/core/permissions.js`: exact JID matching after normalisation, LID → PN resolution through Baileys' LID mapping, owner set from config, `fromMe` = owner, levels `owner > sudo > groupAdmin > user`, fail closed. One cached group-metadata lookup per message. | B-02 | **medium**: LID handling must be right, or *you* lose owner rights | owner checks become strict and correct |
| Only owners manage sudo. Sudo cannot run owner-only commands that affect code, the session, or global state (`.clearsession`, `.setpp`, `.mode`, `.sudo`). | B-06 | low | sudo users lose some powers |
| Global ban is owner/sudo only, and owners can never be banned. `.sudo list` is owner only. | B-11, B-19 | low | group admins can no longer use `.ban` (Decision 4) |
| Unit tests with `node:test` for normalisation, owner/sudo/admin decisions and the bypass cases from the audit. | Goal 2 | none | none |

### Step 6. Bot: safe network and media layer (B-03, B-04, B-08, B-09, B-17, B-18)
| What | Why | Risk | Affects |
|---|---|---|---|
| `src/core/http.js`: `safeFetch` / `downloadToBuffer`. https only (http allowed only for an allowlist of known APIs), DNS resolution with private, loopback and link-local IPs rejected, redirect re-validation, timeouts, byte caps. | B-03, B-08 | medium: some third-party APIs may return unusual URLs | downloads larger than the cap are refused with a message |
| Every media send uses a **Buffer**. No `{ url }` from external data is ever passed to Baileys. | B-03 | low | none |
| Remove `link-preview-js`. `generateHighQualityLinkPreview: false`. | B-04 | none | bot replies no longer show link previews |
| Size check (`fileLength`) before every WhatsApp media download. Mimetype allowlists. ffmpeg through `spawn` with an argument array, `-protocol_whitelist file,pipe`, a timeout and duration caps. `.attp` uses `textfile=`. | B-09, B-17 | low | oversized media is rejected politely |
| Strict host validation for `.fb`, `.ig`, `.tt`, `.ytmp4`; encode all query parameters. | B-08, B-18 | low | none |

### Step 7. Bot: command framework (Goal 3)
| What | Why | Risk | Affects |
|---|---|---|---|
| `src/commands/<category>/<name>.js`, one file per command, exporting `{ name, aliases, category, description, usage, permissions: { level, groupOnly, privateOnly, botAdmin }, cooldown, requires: { env: [...] }, run(ctx) }`. | extensibility | — | — |
| `src/core/commandLoader.js`: recursive auto-load, schema validation, duplicate name/alias detection (fails at startup), skipping commands whose requirements are missing. | — | low | — |
| `src/core/dispatcher.js`: prefix parsing (keeps original casing for arguments), mode check, ban check, **all** permission checks, per-user+command cooldowns (bounded LRU), a central try/catch with a user-safe error reply, and logging. | removes about 40 copies of permission and error code | **medium**: many commands to port | — |
| `ctx` helpers: `reply`, `react`, `quoted`, `mentions`, `args`, `text`, `download(maxBytes)`, `isGroup`, `groupMetadata()` (cached), `sendMedia(buffer)`, `config`, `log`, `store`. | consistent, safe APIs | — | — |
| `.help` and `.help <command>` generated from metadata, grouped by category, showing aliases, usage and permissions. | Goal 3/4 | none | the menu looks different but is always accurate |
| `src/commands/_template.js` (commented, never loaded) and one fully worked example. | Goal 3/4 | none | none |
| Port all existing commands category by category (General, Admin, Owner, Sticker/Image, Textmaker, Downloaders, AI, Fun, Misc, Anime, Pies, Games), keeping names and aliases. | keep features | medium | behaviour preserved except where listed in §2 |
| Unit tests for the loader (valid/invalid/duplicate), dispatcher permission enforcement and cooldowns. | Goal 2 | none | none |

### Step 8. Bot: event listeners and state (B-07, B-10, B-12, B-13, B-15, R-03)
| What | Why | Risk | Affects |
|---|---|---|---|
| `src/listeners/*.js` auto-loaded for non-command message hooks (antilink, antibadword, antitag, mention reply, chatbot, games, antidelete, autoread, autotyping, PM blocker), each declaring `{ name, on: 'message' \| 'group-participants' \| 'call' \| 'status', priority, run(ctx) }`. | extensibility | medium | none |
| `src/core/state.js`: JSON store with in-memory cache and atomic writes (temp file + rename). Mode lives in its own file and **fails closed**. Message counters are batched in memory and flushed every 30 s. | B-10 | low | none |
| Migrate existing `data/*.json` automatically on first start (same files, same keys where possible; `messageCount.json` split into `mode.json` + `messageCounts.json`). | keep your settings | low | none |
| Antidelete: LRU (5,000 messages), 24 h TTL, media cap 10 MB, temp files deleted on eviction. | B-07 | low | very old or very large deleted messages are no longer recovered |
| Chatbot: neutral persona configurable through `CHATBOT_PERSONA`, sends only the current message, off by default. | B-12, B-15 | low | different reply style |
| `.vv` per Decision 3. | B-13 | none | see decision |
| Bounded store (`MAX_STORE_CHATS`), game timeouts. | R-03 | low | none |

### Step 9. Bot: reliability (R-02, R-03, R-04)
| What | Why | Risk | Affects |
|---|---|---|---|
| `src/core/connection.js`: one socket at a time, old listeners removed, exponential backoff with jitter (1 s → 60 s), reset on success, restart-required (515) handled immediately. | R-02 | medium | none |
| Logged out: move `session/` to `session.loggedout-<timestamp>/`, log clear instructions, exit with code 2. PM2/Docker restart policy is documented so it doesn't loop. | R-02: no silent data loss | low | the bot stops instead of silently waiting |
| SIGINT/SIGTERM: stop accepting messages, flush state and store, close the socket, exit 0 within 10 s. | R-02 | low | none |
| Structured logging with `pino` and a redact list (creds, keys, tokens, phone numbers partially masked). | Goal 2 | low | log format changes |
| Health endpoint (`127.0.0.1:HEALTH_PORT/healthz`): connection state, uptime, last message time. Docker `HEALTHCHECK` uses it. | Goal 2 | none | none |
| Remove the 400 MB self-kill and `global.gc` timer; use PM2 `max_memory_restart` or Docker `mem_limit` instead. | R-03 | low | none |
| Fix `.warnings`, retry cache, double status handling, and `chatId` in catch (or removed by the dispatcher). | R-04 | low | `.warnings` shows real counts |

### Step 10. Dependencies (D-01, D-02)
| What | Why | Risk | Affects |
|---|---|---|---|
| Remove the 24 unused packages and the dead-code ones (`node-id3`, `node-youtube-music`, `youtube-yts`, `ytdl-core`). Replace `gtts` with a direct request through `safeFetch`. Upgrade `sharp`, `axios`, `file-type` (or drop `file-type` and sniff magic bytes). Pin exact versions. Commit `package-lock.json`. `"engines": { "node": ">=22.12" }`. | D-01, D-02 | medium: `sharp` and `file-type` major upgrades change APIs | none intended |
| Run `npm audit` and record the result in CHANGELOG. Anything left gets a justification. | D-01 | none | none |

### Step 11. Deployment artefacts
`ecosystem.config.js` (both apps, `max_memory_restart`, no restart loop on exit code 2), a `Dockerfile` for each service (Node 22 slim, ffmpeg, non-root `node` user, `npm ci --omit=dev`, `HEALTHCHECK`), and a root `docker-compose.yml` (named volumes for session and data, `restart: unless-stopped`, pairing service bound to `127.0.0.1`, `profiles: [pairing]` so it only runs when asked).

### Step 12. Documentation
`README.md`, `docs/DEPLOYMENT.md`, `docs/USAGE.md`, `docs/ADDING_FEATURES.md`, `docs/TROUBLESHOOTING.md`, `CHANGELOG.md`, all as specified in your brief.

## 2. Summary of user-visible behaviour changes
- **Removed:** `.update`; Mega helpers; the newsletter "forwarded" label; promo messages after pairing and on connect; upstream links; the unwired `.pair`, `.gif` and `.move`.
- **Need your own API key:** `.news`, `.weather`, `.emojimix`, `.tg`, `.remini`. Hidden until configured.
- **Stricter permissions:** exact owner matching; sudo can't add sudo or change code, session or mode; `.ban` is owner/sudo only; `.sudo list` is owner only; `.vv` per Decision 3.
- **Limits:** media size caps, per-command cooldowns, bounded antidelete.
- **Chatbot:** off by default, neutral persona, no history sent.
- **Pairing service:** requires an access token, is rate limited, and saves the session locally by default.
- **Logged out:** the session is moved aside, not deleted, and the bot exits with instructions.
- **No link previews** in bot replies.
- **Config** moves from `settings.js` to `.env`. Existing `data/*.json` settings are migrated automatically.

## 3. Session format compatibility
Both services keep using the **Baileys multi-file auth state** (`creds.json` + key files in one folder). The only change is *where* the pairing service puts it (Decision 2). The bot keeps reading `MD-main/session/` by default (configurable through `SESSION_DIR`). An existing `creds.json` keeps working with no migration. Pinning both services to the same Baileys version removes the current 6.x → 7.x cross-version risk.

## 4. Optional stack changes (not part of this pass unless you approve)
| Option | Benefit | Cost / risk | My view |
|---|---|---|---|
| **TypeScript** | type safety for command metadata and `ctx`; better editor help | build step; every file rewritten; Baileys types are large | Worth it later. The command framework is designed so it can be adopted file by file. |
| **SQLite** (`better-sqlite3`) instead of JSON files | atomic transactions, no corruption, queries for top members and warnings | native module (build tools on some hosts); data migration | Good second step if the bot sits in many busy groups. JSON with atomic writes is enough for one owner. |
| **ESM** for the bot (match Baileys 7 and the pairing service) | one module system | touches every file | Not needed: Node ≥ 22.12 can `require()` Baileys 7. Revisit together with TypeScript. |
| **Folder rename** (`MD-main` → `bot`, `Bot_Pair_Code-main` → `pairing`) | clearer docs and compose file | paths in your existing deployment change | Optional. I'll keep the current names unless you say otherwise. |
| **Drop the pairing service** entirely | smaller attack surface; the bot can already pair from the terminal (`npm run pair`) | no web page for headless panels | Keep it, but off by default (Compose profile), and document terminal pairing as the primary method. |

## 5. Verification plan (no WhatsApp connection, no real phone number)
- `npm ci` in both services. `node --check` on every file. ESLint (flat config, `eslint:recommended` + `no-unused-vars`, `n/no-missing-require`).
- `node --test`: command loader (valid, invalid schema, duplicate alias, missing env → skipped), permission engine (owner PN/LID, substring bypass cases, empty owner → config error, sudo limits, group admin), cooldowns, config validation, `safeFetch` URL and IP filtering, path validation in the pairing service.
- Boot the pairing service and `curl` `/healthz`. Confirm `/mega.js`, `/package.json` and `/../` return 404. Confirm `/pair` without a token gets 401 and with a bad number gets 400.
- Bot: start with a missing `.env` (expect a clear config error). Run `npm run check`, a dry-run that validates config, loads every command and listener, and prints the generated help without opening a WhatsApp connection.
- `npm audit` before and after.

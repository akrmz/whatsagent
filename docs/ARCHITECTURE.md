# Architecture

This describes the current (2.0) design. The original code is described in [archive/ARCHITECTURE_ORIGINAL.md](archive/ARCHITECTURE_ORIGINAL.md).

## Overview

```
┌──────────────────────────── your server ─────────────────────────────┐
│                                                                       │
│  Bot_Pair_Code-main  (optional, only while pairing)                   │
│  POST /api/pair|/api/qr ──► temporary Baileys socket ──► WhatsApp      │
│         │ (token, rate limit, timeout)          │                     │
│         └────────── copies session folder ──────┴──► MD-main/session  │
│                                                          │            │
│  MD-main (the bot)                                       ▼            │
│  connection ──► dispatcher ──► listeners / commands ──► WhatsApp      │
│       │             │                                                 │
│   /healthz      state (data/*.json), in-memory caches                 │
└───────────────────────────────────────────────────────────────────────┘
```

Both services use **Baileys 6.7.24**, pinned, with the standard Baileys *multi-file auth state*: one folder containing `creds.json` plus key files. That folder is the only thing the two services share.

## Pairing service (`Bot_Pair_Code-main/`)

ESM, Express 5.

| File | Role |
|---|---|
| `index.js` | Loads config, creates the logger, pairing manager and app, listens, handles shutdown |
| `src/config.js` | Reads `.env`, validates everything, refuses to start without `PAIR_ACCESS_TOKEN` |
| `src/server.js` | Routes: `GET /healthz`, static `public/`, `POST /api/pair`, `POST /api/qr`, `GET /api/status/:id`. Helmet with a strict CSP, JSON body limit, constant-time token check, rate limiter, generic error responses |
| `src/pairing.js` | Pairing manager: concurrency cap, one job per number, per-job temp folder, Baileys socket lifecycle (pairing code or QR, handling of WhatsApp's 515 restart, timeout), always ends the socket and deletes the folder |
| `src/delivery.js` | `local`: copy the session into `SESSION_OUTPUT_DIR` (never overwrites a working session unless `PAIR_OVERWRITE=true`). `whatsapp`: send `creds.json` to the account's own chat |
| `src/rateLimit.js`, `src/phone.js`, `src/logger.js` | Fixed-window IP limiter, E.164 validation, pino with redaction and number masking |
| `public/` | The page (`pair.html`, `app.js`, `style.css`). No external resources |

Flow: the page sends the token and number. The server validates them, starts a job, requests a pairing code from WhatsApp and returns it. The page then polls `/api/status/:id`. When the phone links, the server saves the creds, waits for pending key writes, delivers, ends the socket and deletes the temp folder.

## Bot (`MD-main/`)

CommonJS, Node ≥ 22.12 (Baileys 6.7.24 is ESM; Node's `require(esm)` loads it).

### Startup (`src/main.js`)

1. `loadEnvFile()`, then `buildConfig()`. On any invalid value it prints every problem and exits with code 1.
2. Logger, state (with migration of old data files), identity map, permissions, AI client (if a key is set).
3. `detectCapabilities()`: checks the ffmpeg and yt-dlp binaries, font file and API keys.
4. `loadCommands()` / `loadListeners()`: walk `src/commands/**` and `src/listeners/**`, validate metadata, reject duplicates, skip definitions whose `requires` are not met.
5. Dispatcher, connection manager, health server, signal handlers. Then `connection.start()`.

### Connection (`src/core/connection.js`)

- If `SESSION_DIR` has no registered session and `PAIRING_NUMBER` is empty, it waits and re-checks every 10 s (`waiting-for-session`).
- Otherwise it creates one Baileys socket: `generateHighQualityLinkPreview: false`, `getMessage` from the bounded store, cached group metadata, a bounded retry cache. `sendMessage` is wrapped to record outgoing message IDs, so the bot never processes its own messages.
- With `PAIRING_NUMBER`, it requests a pairing code on the first QR event and prints it to stdout (not to the logger).
- On close: `loggedOut` moves the session aside and waits for a new one. `restartRequired` reconnects at once. `connectionReplaced` and `forbidden` back off long. Anything else gets exponential backoff (1 s → 60 s plus jitter), reset after a successful open.

### Message pipeline (`src/core/dispatcher.js`)

```
messages.upsert (notify)
  ├─ own sent message?  → ignore
  ├─ status@broadcast   → "status" listeners
  ├─ newsletter/broadcast → ignore
  ├─ build ctx (src/core/context.js)
  ├─ message:pre listeners (priority order; "stop" ends processing)
  │     antidelete(5) autoread(10) message-counter(30) antibadword(40) antilink(41) pmblocker(50)
  ├─ banned? → ignore (owners never)
  ├─ parse "<prefix>name args"
  │    ├─ unknown → message:post listeners
  │    │     games(10) antitag(20) mention-reply(30) chatbot(40) autotyping(90)
  │    └─ command:
  │          private mode & not owner/sudo → ignore
  │          group-only / private-only check
  │          permissions.allows(command.permission)   (owner > sudo > groupAdmin > user)
  │          bot-admin check
  │          cooldown (per user+command, LRU; owner/sudo exempt)
  │          run(ctx)  → UserError/MediaError shown; HttpError → "service not responding";
  │                       anything else logged, user sees a generic message
  │          command:after listeners (auto-reaction, typing)
group-participants.update → welcome/goodbye, promote/demote announcements
call                      → anticall
```

### Identity and permissions (`src/core/identity.js`, `src/core/permissions.js`)

WhatsApp identifies people by phone-number JIDs (`…@s.whatsapp.net`) or anonymous LIDs (`…@lid`), with optional device suffixes. `IdentityMap` normalizes JIDs and learns PN↔LID pairs from message keys (6.7: `senderPn`/`participantPn`/`senderLid`/`participantLid`; 7.x: `remoteJidAlt`/`participantAlt`) and from group participant lists (`jid` in 6.7, `phoneNumber` in 7.x, `lid`). Bounded to 20,000 entries.

Levels: **owner** (`fromMe`, an exact match against `OWNER_NUMBERS` or `OWNER_LIDS` through any known alias), **sudo** (the stored list, matched through aliases), **groupAdmin** (admin in the current group's participant list, matched through aliases; sudo and owner always qualify), **user**. Unknown levels fail closed. Nothing uses substring matching.

### Commands (`src/commands/**`) and listeners (`src/listeners/**`)

Each module exports a definition, or an array of them, with metadata (see [ADDING_FEATURES.md](ADDING_FEATURES.md)). `.help` is rendered from that metadata by `src/services/help.js`.

### Shared services (`src/services/`)

| Service | Role |
|---|---|
| `settings.js` | Names and defaults of the state files (same names and shapes as the original bot) |
| `moderation.js` | Warn/kick/delete enforcement, shared `on/off/set/get` handler |
| `targets.js` | Resolve @mentions, the replied-to author and typed numbers into JIDs; detect the bot itself |
| `external.js` | Wrappers for the free third-party APIs, image verification, public file-host uploads, avatar lookup |
| `stickers.js` | Sticker settings from config |
| `ytdlp.js` | yt-dlp runner: no shell, generic extractor disabled, size, duration and time limits, site-exact URL matching |
| `ai.js` | Claude via `@anthropic-ai/sdk`: model/effort from config, server-side refusal fallback on supported models, refusal handling, typed error mapping |
| `games.js`, `tictactoe.js` | Game state in TTL-bounded LRUs |
| `help.js` | Menu and per-command help |
| `updater.js` | Owner `.update`: fetches the configured git remote/branch, fast-forward only, refuses with local changes, `npm ci` when the lockfile changed, validates with `src/check.js`, rolls back on failure, restarts through PM2/Docker. Also checks the latest yt-dlp nightly (GitHub releases API) and runs `--update-to nightly`. Everything through `spawn` without a shell |

### Safety primitives (`src/core/`)

| Module | Guarantees |
|---|---|
| `http.js` | HTTPS only (HTTP only where explicitly allowed). Private, loopback, link-local, CGNAT, multicast and reserved IPs refused **at connect time** through a custom `lookup` (no DNS-rebinding window); IP literals checked before connecting. Redirects followed manually and re-validated. Timeouts. Body size caps, also after decompression |
| `media.js` | WhatsApp media downloads check the declared size first and stop at the byte cap. ffmpeg via `spawn` (no shell) with `-protocol_whitelist file,pipe`, `-nostdin`, kill on timeout. Temp folders always removed. One sticker pipeline with size fallbacks |
| `state.js` | JSON stores cached in memory. Debounced **atomic** writes (temp file + rename, mode 600). Corrupt files moved aside. Bot mode fails closed |
| `lru.js` | Size- and TTL-bounded cache used for everything that could otherwise grow without limit |
| `store.js` | Last N messages per chat for at most M chats, in memory only |
| `health.js` | `GET /healthz`: 200 when connected, 503 otherwise |

### Data on disk

| Path (default) | Contents |
|---|---|
| `session/` | WhatsApp login (Baileys multi-file auth state) |
| `session.loggedout-*`, `session.new-*`, `session.bak-*` | Sessions moved aside after logout, or by the pairing service |
| `data/mode.json` | `{ isPublic }` |
| `data/userGroupData.json` | Per-group antilink/antitag/antibadword/welcome/goodbye/chatbot settings, sudo list, auto-reaction |
| `data/warnings.json`, `data/banned.json`, `data/messageCounts.json` | Warnings per group/user, global ban list, message counters |
| `data/antidelete.json`, `autoread.json`, `autotyping.json`, `autoStatus.json`, `anticall.json`, `pmblocker.json`, `mention.json` | Feature toggles |
| `assets/mention_custom.*` | Media set with `.setmention` |
| `tmp/` | Per-operation temp folders (auto-removed) and antidelete media (bounded) |

### External services

WhatsApp (via Baileys); GitHub (`fetchLatestBaileysVersion`; also `api.github.com` when `GITHUB_REPO` is set); the configured AI provider (api.anthropic.com, generativelanguage.googleapis.com, or OPENAI_BASE_URL, default api.openai.com); sites reached by yt-dlp (YouTube, TikTok, Facebook, Instagram, X, Reddit, SoundCloud, Pinterest, Vimeo, Dailymotion, Twitch, Threads, Snapchat — only the link the user sent); translate.google(apis).com, api.mymemory.translated.net, lrclib.net, icanhazdadjoke.com, uselessfacts.jsph.pl, opentdb.com, shizoapi.onrender.com, api.shizo.top, api.princetechn.com, api.some-random-api.com, api.siputzx.my.id, en.ephoto360.com (through `mumaker`), and api.telegram.org, tenor.googleapis.com, newsapi.org, api.remove.bg only with your keys; keyless: api.open-meteo.com and geocoding-api.open-meteo.com (`.weather`, `.time`, `.prayer`), api.aladhan.com, api.alquran.cloud, *.wikipedia.org, api.dictionaryapi.dev, open.er-api.com, pps.whatsapp.net (`.getpp`), tinyurl.com (`.short`), news.google.com (`.news`, RSS), api.coingecko.com (`.crypto`), api.aladhan.com for `.autoazkar city` (hisnmuslim.com only when a developer runs `scripts/fetch-hisnmuslim.js`; the bot itself reads the bundled `assets/hisnmuslim-ar.json`), generativelanguage.googleapis.com `/interactions` and api.openai.com `/images`, `/audio` (`.imagine`, `.transcribe`, when keys are set), any public web page the user links to `.summarize` (http or https, private addresses blocked); public file hosts qu.ax, uguu.se, telegra.ph (`.tourl`, `.remini` and image effects).

### Dependencies (bot)

| Package | Purpose |
|---|---|
| `@whiskeysockets/baileys` 6.7.24 | WhatsApp Web protocol |
| `@anthropic-ai/sdk` | Claude for `.ai` and the chatbot |
| `sharp` | Image processing (blur, sticker → PNG) |
| `node-webpmux` | Sticker metadata (EXIF) |
| `pino`, `pino-pretty` | Logging |
| `mumaker` | ephoto360 text effects (small, readable scraper) |
| dev: `eslint`, `@eslint/js`, `globals` | Linting |

System tools: `ffmpeg`, `yt-dlp`, a bold TTF font (all in the Docker image).

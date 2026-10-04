# Architecture of the ORIGINAL code (archived, before the 2.0 rewrite)

This document describes the code as it was found, before any changes (Phase 1 of the audit). It is kept for reference. For the current design see [../ARCHITECTURE.md](../ARCHITECTURE.md); for the findings see [../SECURITY_AUDIT.md](../SECURITY_AUDIT.md).

## 1. What each folder is

Your assumptions were broadly right, with corrections:

| Folder | Your assumption | What the code actually shows |
|---|---|---|
| `Bot_Pair_Code-main/` | Pairing-code / session generator | **Correct.** An Express web server with a page (`pair.html`) and two endpoints (`/pair` and `/qr`). Each request opens a *temporary* Baileys connection, links it to a WhatsApp account by pairing code or QR, and then **sends the resulting `creds.json` to that account's own WhatsApp chat as a document**. It does **not** produce a "session ID" string, and it does **not** upload anything to Mega or Pastebin. `mega.js` contains upload/download helpers and hardcoded Mega credentials, but nothing imports it, and its `megajs` dependency is not even installed. |
| `MD-main/` | Multi-device bot that consumes the session | **Mostly correct.** It is a Baileys multi-device bot with about 100 commands. It does **not** load a session ID string. It expects you to put a `creds.json` file into `MD-main/session/` (see the placeholder file `session/upload creds file here`). If no registered creds are present, it can also pair by itself: it prints a pairing code in the terminal. **The bot does not need the pairing service at all.** |

Other facts worth knowing up front:

- Neither folder is a git repository, and there is no lockfile in either folder.
- There are no Dockerfiles, Procfiles, or CI workflows. The only `.github` file is `MD-main/.github/FUNDING.yml`.
- There is no README for `MD-main`.
- The two folders use **different Baileys major versions**: the pairing service resolves `^6.7.21` (currently 6.7.24, "legacy") and the bot resolves `^v7.0.0-rc.9` (currently 7.0.0-rc14, the "latest" tag, still a release candidate).
- The upstream code is a rebrand of "Knight Bot" by "Mr Unique Hacker". Branding strings for "Knight Bot", "Akram MD" and "Ak Bot" are mixed throughout.

## 2. Pairing service (`Bot_Pair_Code-main/`)

### 2.1 Files

| File | Purpose |
|---|---|
| `package.json` | ESM (`"type": "module"`), Node >= 20, `npm start` → `node index.js`. Dependencies: Baileys 6, express, body-parser, awesome-phonenumber, pino, qrcode, qrcode-terminal, plus unneeded `path` and `phone` packages. |
| `index.js` | Creates the Express app, serves **the whole project directory as static files**, routes `/` → `pair.html`, mounts `/pair` and `/qr`, and listens on `PORT` (default 8000). |
| `pair.js` | `GET /pair?number=<digits>`: the pairing-code flow. |
| `qr.js` | `GET /qr`: the QR-code flow. |
| `pair.html` | Single-page UI. It loads Font Awesome and **axios 1.0.0-alpha.1** from cdnjs (no SRI) and calls `/pair` or `/qr`. |
| `mega.js` | Unused helpers to upload and download files on Mega, with **hardcoded Mega account credentials** (`mega.js:5-6`). It imports `megajs`, which is not in `package.json`. |
| `README.md` | Tells users to put Mega credentials in `mega.js` and links a third-party hosted instance (`knight-bot-paircode.onrender.com`). |
| `.gitignore` | Ignores `node_modules`, `.env`, logs, `tmp/` and `temp/`. Its "Session files" section is **empty**, so session folders are not ignored. |

### 2.2 Startup flow

1. `node index.js` imports `pair.js` and `qr.js`. Each module registers its own global `process.on("uncaughtException")` handler, which silently swallows many Baileys errors.
2. It sets `EventEmitter.defaultMaxListeners = 500`.
3. It applies the `bodyParser.json()`, `bodyParser.urlencoded()` and `express.static(__dirname)` middleware.
4. It listens on `process.env.PORT || 8000`.

### 2.3 Pairing-code flow (`GET /pair?number=...`)

1. `dirs = "./" + (number || "session")` (`pair.js:29`). **The raw, unsanitised query value becomes a folder path.**
2. `fs.rmSync(dirs, { recursive: true, force: true })` (`pair.js:32` → `pair.js:21`). This runs **before** the number is cleaned.
3. The number is stripped to digits and validated with `awesome-phonenumber`. An invalid number returns 400.
4. `useMultiFileAuthState(dirs)` creates a per-number folder in the project root. `fetchLatestBaileysVersion()` contacts GitHub, and `makeWASocket` opens a connection.
5. After 3 seconds, `requestPairingCode(num)` returns an 8-character code, formatted `XXXX-XXXX`. The code is logged (`pair.js:160`) and returned as JSON `{ code }`.
6. The user enters the code in WhatsApp → Linked devices. Baileys emits `connection: "open"` and `creds.update`, which writes `creds.json`.
7. On open, the service:
   - reads `dirs/creds.json` and **sends it as a document to the user's own chat** (`pair.js:84-92`),
   - sends a promotional YouTube thumbnail and link, then a "do not share this file" text,
   - deletes the folder after 1 s.
   **The socket is never closed.** The server stays connected as a linked device of that account until the process restarts.
8. On `connection: "close"` with a status other than 401, it calls `initiateSession()` again immediately, with no backoff and no attempt limit (`pair.js:145-146`).

### 2.4 QR flow (`GET /qr`)

1. It creates `./qr_sessions/session_<Date.now()><Math.random base36>`.
2. It opens a socket. The first `qr` event is turned into a PNG data URL and returned as `{ qr, message, instructions }`.
3. On open, it sends `creds.json`, the same promo, and the same warning to `creds.me.id`, then deletes the folder after 15 s. **The socket is not closed.**
4. On a 515 or 503 close it reconnects up to 3 times after 2 s each. After 30 s without a response it returns 408 and deletes the folder, **but leaves the socket running**.

### 2.5 Session format produced

It produces a single Baileys **multi-file auth state `creds.json`** (JSON with `noiseKey`, `signedIdentityKey`, `registrationId`, `me`, `account`, and so on). Signal key files (`pre-key-*.json`, `session-*.json`, `app-state-sync-*.json`) are **not** delivered; Baileys recreates them on first connect. No "session ID" string, Base64 blob, or remote paste is involved.

## 3. Bot (`MD-main/`)

### 3.1 Top-level files

| File | Purpose |
|---|---|
| `package.json` | CommonJS, `npm start` → `node index.js`. It declares 50 dependencies, of which **24 are never required by any code** (see §7). The `cleanup`, `reset-session` and `docker:build` scripts point at files that don't exist or are malformed. The engine is declared `>=18`, but Baileys 7 requires `>=20`. |
| `index.js` | Process entry point: socket creation, pairing, connection and reconnection handling, event wiring, the call blocker, and global error handlers. |
| `main.js` | Message router: one **1,725-line `switch(true)`** that maps text prefixes to command functions. It also handles group participant events and status events. |
| `settings.js` | Hardcoded config: bot name, owner name, owner number, a Giphy API key, a mode string that is never read, store limits, version, and the update ZIP URL. |
| `config.js` | Loads `.env` through dotenv. Defines `global.APIs`, a map of 11 third-party API hosts, and `global.APIKeys`, which includes two real-looking keys. Exports `WARN_COUNT = 3`. Only `WARN_COUNT` is used anywhere. |
| `session/` | Where `creds.json` and the Baileys key files live. It contains only a placeholder file today. |
| `data/*.json` | Persistent state as JSON files (see §5). |
| `assets/` | Five images (verified as real PNG/JPEG/WebP). `bmc_qr.png` is a Buy-Me-a-Coffee QR code. |
| `.gitignore` | **Saved as UTF-16 LE, which git cannot parse**, so none of its rules (`session/`, `.env`, `node_modules/`) take effect. |

### 3.2 `lib/`

| File | Used? | Purpose |
|---|---|---|
| `isOwner.js` | yes | `isOwnerOrSudo(sender, sock, chatId)` is the owner check. It has several bypasses (see the audit). |
| `isAdmin.js` | yes | Fetches group metadata and fuzzy-matches the sender and the bot across PN and LID formats against `admin`/`superadmin`. |
| `isBanned.js` | yes | Reads `data/banned.json` on every message. |
| `index.js` | yes | Get/set helpers over `data/userGroupData.json` for antilink, antitag, antibadword, welcome, goodbye, chatbot, warnings and sudo. Every call reads and rewrites the whole file synchronously. |
| `lightweight_store.js` | yes | In-memory message, contact and chat store. It keeps the last N messages per chat and dumps everything to `baileys_store.json` every 10 s. |
| `antilink.js` | yes | Link detection and its delete/kick/warn action. |
| `antibadword.js` | yes | Bad-word detection and its action, plus the command handler. |
| `reactions.js` | yes | Optional ⏳ reaction on commands, controlled by `.areact`. |
| `messageConfig.js` | yes | `channelInfo`: a "forwarded from newsletter" decoration pointing at the upstream channel. |
| `exif.js` | yes | Image/video → WebP conversion through fluent-ffmpeg, plus sticker EXIF. |
| `converter.js` | yes | Generic `ffmpeg` spawn wrapper (`toAudio`, `toPTT`, `toVideo`). |
| `uploadImage.js` | yes | Uploads images to **qu.ax**, falling back to **telegra.ph**, to get a public URL. |
| `uploader.js` | yes (`url.js`) | Uploads to telegra.ph or uguu.se. The ezgif and flonime helpers are unused. |
| `welcome.js` | yes | Welcome/goodbye command parsing. |
| `tictactoe.js` | yes | Game logic. |
| `myfunc.js` | yes (`index.js`) | Mixed helpers (`smsg`, `getBuffer`, ...). It also **hot-reloads itself through `fs.watchFile`**. |
| `myfunc2.js` | only via `ytdl2.js` | Helpers, including `buffergif`, which shells out to ffmpeg with `exec`. |
| `ytdl2.js` | **unused** | YouTube downloader. It requires `@distube/ytdl-core`, which is not installed, so it would crash if loaded. |
| `sticker.js` | **unused** | Broken sticker helpers that reference undefined `conn`, `m` and `util`. |
| `antilinkHelper.js`, `tempCleanup.js` | **unused** | — |

### 3.3 Startup flow (`node index.js`)

1. `require("./main")` executes `main.js` top-level code:
   - creates `./temp`, overrides `TMPDIR`/`TEMP`/`TMP`, and starts a 3-hourly temp cleaner;
   - requires every command module. Some have **load-time side effects**: `cleartmp.js` wipes `tmp/` and `temp/` immediately and then every 6 h, `antidelete.js` starts a 60 s temp-size checker, and `autostatus.js` creates `data/autoStatus.json`;
   - `require("./config.js")` runs `dotenv.config()`.
2. `store.readFromFile()` loads `baileys_store.json`. Timers start: store write every 10 s, `global.gc()` every 60 s, and a RAM check every 30 s that calls `process.exit(1)` above 400 MB RSS.
3. `phoneNumber = "911234567890"` (a placeholder) makes `pairingCode` always true. `data/owner.json` is read only to print it to the console.
4. `startXeonBotInc()`:
   1. `fetchLatestBaileysVersion()` (contacts GitHub) and `useMultiFileAuthState("./session")`.
   2. `makeWASocket` with a fake browser string `["Ubuntu","Chrome","20.0.04"]`, `markOnlineOnConnect: true` and `generateHighQualityLinkPreview: true`.
   3. Wires `creds.update`, `messages.upsert` (twice), `contacts.update`, `group-participants.update`, `status.update`, `messages.reaction` and `call`.
   4. If not registered: asks for a number on stdin. If stdin is not a TTY it uses `settings.ownerNumber`. It then prints a pairing code after 3 s.
   5. On `open`: logs the user object and **sends "Bot Connected Successfully… Make sure to join below channel" to its own number**, decorated with the upstream newsletter.
   6. On `close`: on 401 or loggedOut it **deletes `./session`** and stops. Otherwise it waits 5 s and calls `startXeonBotInc()` again (fixed delay, no limit, old socket not cleaned up).
5. It registers global `uncaughtException`/`unhandledRejection` handlers that only log.
6. It watches its own file with `fs.watchFile`. On any change it `require`s itself again, which **starts a second bot instance** in the same process.

### 3.4 How the bot loads the session

It uses `useMultiFileAuthState("./session")` only. Creds come from one of two places:
- you copy the `creds.json` received from the pairing service into `MD-main/session/creds.json`, or
- the bot pairs itself on first run (terminal pairing code).

No environment variable such as `SESSION_ID` exists. The `docker:build` script mentions one, but no code reads it.

### 3.5 How commands are discovered and executed

There is **no discovery**. Every command module is required by hand at the top of `main.js` (lines 42-193), and `handleMessages` dispatches with a long `switch (true)` of `userMessage.startsWith(".xxx")` / `=== ".xxx"` cases (`main.js:503-1629`).

Message pipeline (`handleMessages`):
1. Ignore anything that isn't `type === "notify"` or has no message body.
2. Autoread (if enabled), then antidelete store (if enabled), then revocation handling.
3. Compute `senderIsSudo` and `senderIsOwnerOrSudo` (owner check on **every** message).
4. Handle legacy button responses (`channel`, `owner` and `support` send upstream links).
5. Lowercase the text, then read `data/messageCount.json` to get public/private mode.
6. Ban check, which reads `data/banned.json`. 10 % of the time it replies "you are banned".
7. A bare `1`-`9` or `surrender` is a tic-tac-toe move.
8. `incrementMessageCount`: reads and rewrites `data/messageCount.json` on every message.
9. In groups: badword detection and antilink.
10. PM blocker (if enabled): sends a notice to non-sudo DMs and blocks them.
11. Not a command → autotyping, then in groups antitag, mention reply and chatbot.
12. Private mode → only `fromMe` or owner/sudo may continue.
13. Partial admin/owner pre-checks: lists at `main.js:405-442`. Many commands repeat their own checks inside.
14. Dispatch through the `switch`.
15. Post-command: typing indicator and ⏳ reaction.

The prefix is hardcoded to `.`. Help text is a hand-written string in `commands/help.js` that has already drifted from the real command list. For example, `.hijab` is listed but doesn't exist, and `.jid` exists but is barely documented.

### 3.6 Event handlers

| Event | Handler |
|---|---|
| `messages.upsert` | `index.js:153` → `handleMessages`. A second listener at `index.js:477` handles statuses again, so statuses are processed twice. |
| `group-participants.update` | `main.js:handleGroupParticipantUpdate`: promote/demote announcements (public mode only), plus welcome and goodbye. |
| `status.update`, `messages.reaction` | `autostatus.handleStatusUpdate` (auto-view and react to statuses if enabled). |
| `call` | Anticall: reject, message, then block the caller (if enabled). |
| `contacts.update` | Updates the store. |

## 4. Command inventory (as wired in `main.js`)

Permission legend: **A** = group admin (checked inside the command or in `main.js`), **O** = owner/sudo/fromMe, **G** = groups only, — = anyone.

| Category | Commands (aliases) | Perm | Implementation / external service |
|---|---|---|---|
| General | `.help .menu .bot .list` | — | static text + image |
| | `.ping`, `.alive`, `.owner` (vCard), `.jid` | — | local |
| | `.tts <text>` | — | `gtts` → translate.google.com |
| | `.joke`, `.quote`, `.fact`, `.news`, `.weather <city>` | — | icanhazdadjoke, shizoapi, uselessfacts, newsapi.org (hardcoded key), openweathermap (hardcoded key) |
| | `.lyrics <title>` | — | lyricsapi.fly.dev |
| | `.8ball <q>` | — | local |
| | `.groupinfo .infogp .infogrupo`, `.staff .admins .listadmin` | G | local |
| | `.vv` (reveal view-once) | — | local |
| | `.translate .trt` | — | translate.googleapis.com, mymemory, api.dreaded.site |
| | `.ss .ssweb .screenshot <url>` | — | api.siputzx.my.id |
| | `.tourl .url` | — | uploads media to telegra.ph / uguu.se |
| | `.git .github .sc .script .repo` | — | api.github.com (upstream repo) |
| Admin | `.ban`, `.unban` | A in groups / O in DM | global `data/banned.json` |
| | `.promote`, `.demote`, `.kick`, `.mute [min]`, `.unmute` | A | — |
| | `.delete .del [n]` | A | uses the store |
| | `.warn`, `.warnings` | A / — | `data/warnings.json` (`.warnings` reads the wrong structure and always says 0) |
| | `.antilink on/off/set/get`, `.antitag ...`, `.antibadword ...` | A, G | — |
| | `.tag <msg>`, `.tagall`, `.tagnotadmin`, `.hidetag <msg>` | A | — |
| | `.welcome on/off/set`, `.goodbye ...` | A, G | some-random-api.com welcome images |
| | `.chatbot on/off` | A, G | zellapi.autos |
| | `.resetlink .revoke .anularlink`, `.setgdesc`, `.setgname`, `.setgpp` | A | — |
| | `.clear` | G | deletes one bot message |
| Owner | `.mode public/private`, `.settings`, `.autostatus [react] on/off`, `.autoread`, `.autotyping`, `.areact .autoreact .autoreaction`, `.anticall`, `.pmblocker on/off/status/setmsg`, `.antidelete on/off`, `.cleartmp`, `.clearsession .clearsesi`, `.setpp`, `.mention on/off`, `.setmention` | O | local |
| | `.sudo add/del/list` | O (list: anyone) | `userGroupData.sudo` |
| | **`.update [zipUrl]`** | O | **git fetch/reset/clean + npm install, or downloads and unpacks a ZIP from any URL, then restarts** |
| Sticker / image | `.sticker .s`, `.simage`, `.crop`, `.take .steal`, `.attp`, `.emojimix .emix`, `.tg .stickertelegram .tgsticker .telesticker`, `.blur`, `.removebg .rmbg .nobg`, `.remini .enhance .upscale`, `.igs`, `.igsc` | — | ffmpeg, sharp, Tenor (hardcoded key), Telegram Bot API (hardcoded token), siputzx, princetechn (hardcoded key), ruhend-scraper |
| Textmaker | `.metallic .ice .snow .impressive .matrix .light .neon .devil .purple .thunder .leaves .1917 .arena .hacker .sand .blackpink .glitch .fire` | — | ephoto360 via `mumaker` |
| Downloaders | `.play .mp3 .ytmp3 .song`, `.music`, `.video .ytmp4`, `.spotify`, `.instagram .insta .ig`, `.fb .facebook`, `.tiktok .tt` | — | eliteprotech, yupra, okatsu, apis-keith, hanggts, siputzx, ruhend-scraper |
| AI | `.gpt`, `.gemini`, `.imagine .flux .dalle`, `.sora` | — | zellapi, vapis, siputzx, ryzendesu, giftedtech, shizoapi, okatsu |
| Fun | `.compliment`, `.insult`, `.flirt`, `.shayari .shayri`, `.goodnight .lovenight .gn`, `.roseday`, `.character`, `.waste…`, `.ship` (G), `.simp`, `.stupid .itssostupid .iss`, `.truth`, `.dare` | — | shizoapi, princetechn, some-random-api |
| Misc canvas | `.heart .horny .circle .lgbt .lolice .simpcard .tonikawa .its-so-stupid .namecard .oogway .oogway2 .tweet .ytcomment .comrade .gay .glass .jail .passed .triggered` | — | some-random-api (uploads the image first) |
| Anime | `.animu <type>`, `.nom .poke .cry .kiss .pat .hug .wink .facepalm .face-palm .animuquote .quote <x> .loli` | — | some-random-api |
| Pies | `.pies <country>`, `.china .indonesia .japan .korea .india .malaysia .thailand` | — | api.shizo.top (third-party image content) |
| Games | `.tictactoe .ttt`, bare `1`-`9` / `surrender`, `.hangman`, `.guess`, `.trivia`, `.answer`, `.topmembers` | — | opentdb.com |

Not wired at all (dead code): `commands/pair.js` (calls a **third-party pairing server**), `commands/gif.js`, `commands/sticker-alt.js`, `.move` (references an undefined function).

## 5. Where data is stored

All paths are relative to `MD-main/`, and all files are plaintext.

| Path | Contents | Growth |
|---|---|---|
| `session/` | `creds.json` (**full account credentials**) and Signal key files | grows with contacts and groups |
| `baileys_store.json` | last 20 messages **per chat**, all contacts, chats | unbounded number of chats |
| `data/messageCount.json` | `isPublic` (bot mode) **and** per-chat, per-user message counters | unbounded; rewritten on every message |
| `data/userGroupData.json` | antilink, antitag, antibadword, welcome, goodbye, chatbot, warnings, sudo list, autoReaction | small |
| `data/banned.json` | global ban list | small |
| `data/warnings.json` | warnings used by `.warn` | small |
| `data/antidelete.json`, `autoread.json`, `autotyping.json`, `autoStatus.json`, `anticall.json`, `pmblocker.json`, `mention.json` | feature toggles | tiny |
| `data/owner.json`, `data/premium.json` | two **upstream** phone numbers (not yours). `owner.json` is only printed and `premium.json` is unused | — |
| `assets/mention_custom.*` | media set by `.setmention` | 1 MB cap |
| `tmp/`, `temp/` | ffmpeg and download temp files, plus antidelete media copies | cleaned by three overlapping timers |
| In memory | antidelete `messageStore` Map (**unbounded**), chatbot memory Maps (**unbounded**), game state | unbounded |

Pairing service: `./<number>/` and `./qr_sessions/session_*/` are temporary creds folders under the project root, which are **served publicly** by `express.static`.

## 6. Configuration and environment variables

| Name | Where read | Default | Meaning |
|---|---|---|---|
| `PORT` | pairing `index.js:17` | 8000 | HTTP port |
| `UPDATE_ZIP_URL` | bot `commands/update.js:157` | — | fallback ZIP URL for `.update` |
| `TMPDIR`, `TEMP`, `TMP` | **written** by `main.js:8-10` | `./temp` | redirected temp dir |
| (`.env` loading) | bot `config.js:1` | — | dotenv is loaded, but no other variable is read |

Hardcoded configuration in `settings.js`: `packname`, `author`, `botName`, `botOwner`, `ownerNumber` (yours, but **missing the country code**), `giphyApiKey` (a real key; `gif.js` is not wired), `commandMode` (never read), `maxStoreMessages` (20), `storeWriteInterval` (10000), `description`, `version`, `updateZipUrl`.

Hardcoded values elsewhere: `index.js:94` placeholder phone number, `global.botname`, `global.channelLink`, `global.ytch`, upstream newsletter JID `120363161513685998@newsletter` (in about 40 places), and the API keys listed in the audit.

## 7. Dependencies

### Pairing service (Baileys 6.7.24 resolved)

| Package | Purpose | Notes |
|---|---|---|
| `@whiskeysockets/baileys` ^6.7.21 | WhatsApp Web protocol | unofficial; preinstall runs an engine check |
| `express` ^4.21.2, `body-parser` ^1.20.3 | HTTP server | body-parser is unnecessary (no POST routes) |
| `awesome-phonenumber` 7.2.0 | phone validation | pinned |
| `pino` 9.5.0 | Baileys logger | pinned |
| `qrcode` ^1.5.4 | QR → PNG data URL | |
| `qrcode-terminal` ^0.12.0 | imported, never used | remove |
| `path` ^0.12.7 | npm userland copy of a core module | remove (core `path` is used anyway) |
| `phone` 3.1.55 | never used | remove |
| `megajs` | imported by `mega.js` but **not declared** | `mega.js` is dead code |

`npm audit` (lockfile generated in a scratch copy): **0 vulnerabilities**.

### Bot (Baileys 7.0.0-rc14 resolved, 569 packages in the tree)

**Used:** `@whiskeysockets/baileys`, `@hapi/boom`, `awesome-phonenumber`, `axios`, `chalk`, `cheerio`, `dotenv`, `file-type`, `fluent-ffmpeg` (deprecated), `form-data`, `fs-extra`, `gtts`, `human-readable`, `jimp`, `libphonenumber-js`, `moment-timezone`, `mumaker`, `node-cache`, `node-fetch`, `node-webpmux`, `pino`, `ruhend-scraper`, `sharp`, `yt-search`, `ytdl-core` (imported but unused in `main.js`).

**Only used by dead code:** `node-id3`, `node-youtube-music`, `youtube-yts` (`lib/ytdl2.js`).

**Never required:** `@adiwajshing/keyed-db`, `@ffmpeg/ffmpeg`, `@types/node`, `cookie`, `events`, `jsdom`, `libsignal` (deprecated, "contains protocol/security bugs"), `link-preview-js` (**see below**), `performance-now`, `phin`, `qrcode`, `qrcode-reader`, `qrcode-terminal`, `request` (deprecated, critical advisory), `safe-stable-stringify`, `set-cookie`, `tough-cookie`, `translate-google-api`, `ws`, `yargs`, `yargs-parser`, `youtubedl-core`.

`link-preview-js` is never required by bot code, but **Baileys dynamically imports it when present** and uses it to fetch every URL that appears in the bot's outgoing text (`Utils/link-preview.js`). Installing it silently turns on server-side URL fetching.

Packages with install scripts: `@whiskeysockets/baileys` (engine check), `sharp` (native binary download), `protobufjs` (two copies), `es5-ext` (a postinstall message). All packages come from registry.npmjs.org; none come from GitHub or other URLs.

`npm audit`: **25 vulnerable packages (5 critical, 11 high, 7 moderate, 2 low)**. Nearly all come from unused or dead-code dependencies. Details are in the audit.

## 8. External services and URLs contacted

**WhatsApp:** `web.whatsapp.com` and WhatsApp media hosts (via Baileys). **GitHub** `raw.githubusercontent.com` (`fetchLatestBaileysVersion`, on every start or pairing request) and `api.github.com` (`.github` command).

**Third-party APIs (all unauthenticated or with public demo keys, no SLA):** shizoapi.onrender.com, api.shizo.top, api.some-random-api.com / some-random-api.com, api.siputzx.my.id, okatsu-rolezapiiz.vercel.app, eliteprotech-apis.zone.id, api.yupra.my.id, apis-keith.vercel.app, api.hanggts.xyz, zellapi.autos, vapis.my.id, api.ryzendesu.vip, api.giftedtech.my.id, api.princetechn.com, lyricsapi.fly.dev, api.dreaded.site, api.mymemory.translated.net, translate.googleapis.com, tenor.googleapis.com, api.telegram.org, newsapi.org, api.openweathermap.org, api.giphy.com (unwired), opentdb.com, uselessfacts.jsph.pl, icanhazdadjoke.com, en.ephoto360.com (via mumaker), Instagram/TikTok/YouTube (via ruhend-scraper and yt-search).

**Public file hosts (user media is uploaded here):** telegra.ph, uguu.se, qu.ax.

**Image fallbacks:** i.imgur.com, img.pyrocdn.com, img.youtube.com, i.ytimg.com, telegra.ph.

**Defined but unused (`config.js` `global.APIs`):** api.xteam.xyz, api.dhamzxploit.my.id, api.lolhuman.xyz, violetics.pw, api.neoxr.my.id, zenzapis.xyz, api.akuari.my.id, apimu.my.id, fg-nrtm.ddns.net, bochil.ddns.net, api-fgmods.ddns.net. Unused helpers also reference ezgif.com and flonime.my.id.

**Third-party pairing server:** `knight-bot-paircode.onrender.com` (in `commands/pair.js`, which is unwired, and in the pairing service README).

**Browser side (pair.html):** cdnjs.cloudflare.com (Font Awesome, axios alpha), plus links to YouTube, Telegram, a WhatsApp channel and GitHub.

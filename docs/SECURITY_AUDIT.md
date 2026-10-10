# Security audit

## Remediation status (2.0.0, 2026-10-04)

Every finding below was fixed in 2.0.0, except the items that need **you** ("Actions you must take" at the end). Details are in [CHANGELOG.md](../CHANGELOG.md).

| Finding | Status |
|---|---|
| P-01 … P-10 (pairing service) | Fixed. Service rewritten (`Bot_Pair_Code-main/src/`), covered by 18 tests. |
| B-01 remote update | Fixed: the dangerous command was removed. 2.1.0 adds a restricted `.update`: owner only, fast-forward commits from your own configured git remote/branch only, no URL or arguments accepted, validated with `npm run check`, rolled back on failure. Residual risk: control of your GitHub account means control of the bot; use 2FA. |
| B-02 owner bypass, B-06 sudo escalation, B-11, B-19 | Fixed: `src/core/permissions.js`, with tests for each bypass |
| B-03 local file read via `{url}` | Fixed: all external media is fetched by the safe client and sent as a buffer |
| B-04 link-preview SSRF, B-08, B-18 | Fixed: `link-preview-js` removed, previews off, SSRF-safe client (`src/core/http.js`), exact host matching |
| B-05 hardcoded secrets | Removed from code. **You must still rotate them.** |
| B-07, R-03 unbounded memory | Fixed: LRU/TTL limits everywhere |
| B-09, B-17 media and ffmpeg | Fixed: size caps, no shell, protocol whitelist, `.attp` via a text file |
| B-10 fail-open mode | Fixed: atomic writes, fails closed |
| B-12, B-15 chatbot | Fixed: only the triggering message is sent, neutral persona |
| B-13 `.vv` | Owner only (your decision) |
| B-14 hot reload, B-16 promo | Removed |
| D-01, D-02 dependencies | Fixed: 0 known vulnerabilities, everything pinned, lockfiles committed. Baileys 6.7.24 in both services until 2.33.0; 7.0.0-rc14 from 3.0.0 (owner's decision), reviewed: no install-time scripts besides a Node version check, its new dependencies (`libsignal` 6.0.0 from npm, `whatsapp-rust-bridge` WebAssembly) make no network or shell calls in their JavaScript, and nothing is installed from git any more |
| R-01 .gitignore | Fixed (root `.gitignore`) |
| R-02 reconnect/logout/shutdown | Fixed: `src/core/connection.js`, graceful shutdown |
| R-04 correctness bugs | Fixed or removed with the old router |
| **New during implementation:** `ruhend-scraper` obfuscated dependency | Removed; replaced by yt-dlp |
| **Found in a later review:** B-20 CSV formula injection in `.export` | Fixed in 3.20.1: formula-like cells are prefixed with `'`; `.import` removes it again |
| **Found in a later review:** B-25 a long run of spaces froze the bot for seconds (regex backtracking) | Fixed in 3.61.1: whitespace is squeezed before every parser of outside text; a timing test guards it |
| **Found in a later review:** B-24 strangers could fill the disk with seller-offer photos | Fixed in 3.49.1: at most 100 waiting offers and 400 photos, expired after 30 days |
| **Found in a later review:** B-23 clients' notices kept reaching a member after their sudo was removed | Fixed in 3.43.1: notices, reminders and the rotation only use members who are still the owner or sudo |
| **Found in a later review:** B-22 the customer assistant answered every private chat and could relay links | Fixed in 3.36.0: personal chats are left alone (`[IGNORE]`, `.assistant ignore`), links removed unless trusted |
| **Found in a later review:** B-21 clients' details shown in groups with outsiders | Fixed in 3.30.1: client commands work only in a private chat with the bot or a group of staff only |

Residual risks that remain by design: the bot still relies on an unofficial WhatsApp library (ban risk); some fun commands call free third-party APIs that can change or disappear; features that upload images (`.tourl`, `.remini`, image effects) put pictures on public hosts (this is stated in `.help`); `libsignal` is installed from GitHub (pinned to a commit in the lockfile).

---

Scope: every file in `Bot_Pair_Code-main/` and `MD-main/`, read in full. No code was changed. Line numbers refer to the files as they are today. **Secret values are never reproduced here.** Only their locations are given.

How this was verified:
- Each file was read in full, without sampling.
- I grepped for `eval`, `new Function`, `vm`, `child_process`, dynamic `require`/`import`, Base64 and hex blobs, `fromCharCode`, invisible Unicode, group invite and newsletter-follow calls, and phone numbers.
- I confirmed that the asset files are real images.
- I generated lockfiles in a scratch copy and ran `npm audit` there.
- I read the relevant Baileys 7.0.0-rc14 source (`Utils/messages-media.js`, `Utils/link-preview.js`, `Socket/messages-send.js`) to confirm two library behaviours that the findings below depend on.

## Overall verdict

- **No obfuscation, `eval`, `new Function`, `vm`, or code downloaded and executed at startup.** I found no auto-joining of groups, auto-following of channels/newsletters, hidden chat commands, or telemetry beacons.
- The real dangers are design flaws:
  1. The pairing web server lets **any stranger delete arbitrary directories** on your server and **download in-flight session credentials** over HTTP.
  2. The bot has a built-in **remote code update command** (`.update <url>`) behind an **owner check that can be bypassed**.
  3. Media "URLs" returned by about a dozen untrusted third-party APIs are passed to Baileys, which **reads local files** when a URL is not http(s). A malicious API could make the bot send you, or a group, your own `session/creds.json`.
  4. Link previews (enabled by an otherwise unused dependency) give anyone in a chat a **server-side request forgery** primitive.
  5. Real API keys, a Telegram bot token, and Mega account credentials are hardcoded.

## Findings summary

| ID | Sev | Area | Title |
|---|---|---|---|
| P-01 | **Critical** | Pairing | Path traversal → recursive delete of any directory |
| P-02 | **Critical** | Pairing | Whole project, including in-flight `creds.json` and `mega.js`, served publicly |
| P-03 | **Critical** | Pairing | Hardcoded Mega account email and password |
| B-01 | **Critical** | Bot | `.update` downloads and installs code from any URL, or `git reset`s to upstream, then restarts |
| B-02 | **Critical** | Bot | Owner check can be bypassed (substring match, group-participant logic, empty-owner case) |
| B-03 | **High** | Bot | Untrusted third-party API responses can make Baileys read and send local files (session theft) |
| B-04 | **High** | Bot | SSRF via automatic link previews (`link-preview-js` installed, previews on) |
| B-05 | **High** | Bot | Hardcoded third-party secrets (Telegram bot token, NewsAPI, OpenWeather, Tenor/Google, Giphy, two `config.js` keys, princetechn) |
| B-06 | **High** | Bot | Sudo users can create more sudo users and run `.update` (privilege escalation) |
| P-04 | **High** | Pairing | Pairing sockets never closed: server stays a linked device of every account forever |
| P-05 | **High** | Pairing | No rate limiting or concurrency cap; reconnect loop without limit or backoff |
| P-06 | **High** | Pairing/Bot | Third-party hosted pairing server referenced (README, `commands/pair.js`) |
| B-07 | **High** | Bot | Antidelete stores every message and all media in memory and on disk with no limit |
| D-01 | **High** | Deps | 25 vulnerable packages (5 critical); `sharp` libvips CVEs on untrusted images |
| R-01 | **High** | Both | `.gitignore` broken (UTF-16) or empty for sessions → creds and `.env` would be committed |
| B-08 | Medium | Bot | SSRF in `.fb` (substring host check, server-side fetch) |
| B-09 | Medium | Bot | Unbounded media downloads and ffmpeg on arbitrary user documents |
| B-10 | Medium | Bot | Bot mode fails open to *public* on file corruption; JSON rewritten on every message |
| B-11 | Medium | Bot | Any group admin can globally ban users, including the owner |
| B-12 | Medium | Bot | User data sent to third parties (chatbot history, images to public hosts) |
| B-13 | Medium | Bot | `.vv` lets anyone reveal other people's view-once media |
| B-14 | Medium | Bot | Hot-reload `fs.watchFile` starts duplicate bot instances |
| B-15 | Medium | Bot | Chatbot persona instructs the bot to insult users with slurs (ban/reputation risk) |
| P-07 | Medium | Pairing | Session file delivered as a WhatsApp document (persists in chat history and backups) |
| P-08 | Medium | Pairing | Malformed `number` crashes the handler (request hangs; errors swallowed) |
| D-02 | Medium | Deps | Unpinned versions, prerelease Baileys with caret, no lockfile, mismatched Baileys majors |
| R-02 | Medium | Both | Reconnect without backoff; logged-out handling deletes the session; no graceful shutdown |
| R-03 | Medium | Bot | Unbounded in-memory state (store chats, chatbot memory, games) and RSS self-kill |
| B-16 | Low | Bot | Unwanted promotional behaviour (newsletter "forwarded" tag on replies, connect message, upstream links) |
| B-17 | Low | Bot | ffmpeg invoked through `exec` with shell strings; fragile drawtext escaping in `.attp` |
| B-18 | Low | Bot | Unencoded user input in third-party URLs (`.weather`, `.translate`) |
| B-19 | Low | Bot | `.sudo list` reveals sudo JIDs to anyone |
| P-09 | Low | Pairing | No security headers, axios *alpha* from CDN without SRI, pairing code logged |
| P-10 | Low | Pairing | Promotional messages sent to every user who pairs |
| R-04 | Low | Bot | Assorted correctness bugs that hide errors (`.warnings`, `.move`, catch-block `ReferenceError`, retry cache cleared per message) |
| B-20 | Low | Bot | `.export` wrote text from strangers (WhatsApp names, notes, lead-ads answers) into CSV cells that Excel could run as formulas (found in the 3.20.1 review of the new code; fixed) |
| B-21 | Medium | Bot | Client commands showed clients' names, phone numbers, budgets and notes in whatever group they were typed in, including groups with clients or other brokers (found in the 3.30.1 review; fixed) |
| B-22 | Medium | Bot | The customer assistant sent every private message from a non-staff number to the AI provider and saved the sender as a client (family and friends of an agent using their own number included); a client could also try to make it repeat a payment or phishing link (found in the 3.36.0 review; fixed) |
| B-23 | Medium | Bot | A team member whose sudo was removed kept getting the notices of clients assigned to them (names, numbers, what they wrote, handoffs, self-booked viewings and their reminders), and the rotation kept giving them new clients (found in the 3.43.1 review; fixed) |
| B-24 | Medium | Bot | Seller intake (3.45) let anyone start an offer and send photos; offers waiting for the agent were never trimmed or expired, so new numbers could keep adding about 160 photos an hour until the disk filled (found in the 3.49.1 review; fixed) |
| B-25 | High | Bot | Catastrophic regex backtracking: optional words between `s*` in the text parsers made a message with a property word and ~290 spaces take seconds to parse (6 s for "عايز شقة قسط" in 3.60), freezing the whole bot. Anyone could send it with `.agent requests on`, in a watched brokers group, or in a lead-ad form (found in the 3.61.1 review; fixed) |

---

## Critical

### P-01 — Path traversal → recursive delete of any directory
- **Where:** `Bot_Pair_Code-main/pair.js:28-32`, `pair.js:18-25`
- **What:** `let dirs = "./" + (num || "session")` uses the raw query string, and `removeFile(dirs)` calls `fs.rmSync(dirs, { recursive: true, force: true })` **before** the number is sanitised on line 35.
- **Abuse:** `GET /pair?number=..` deletes the parent of the app directory. `?number=../../home/ubuntu` deletes a home directory. `?number=.` deletes the app itself. No authentication is needed, and the request works even though the later phone validation fails.
- **Fix:** Validate first (digits only, 7-15 chars, `awesome-phonenumber` valid). Never build paths from input. Create per-request directories with `fs.mkdtemp(path.join(SESSIONS_ROOT, "pair-"))` under a dedicated root outside the static web root, and assert that the resolved path stays inside that root before any delete.

### P-02 — Project directory served publicly, including in-flight credentials
- **Where:** `Bot_Pair_Code-main/index.js:26` (`app.use(express.static(__dirname))`), with `pair.js:29,51` and `qr.js:34,45` writing creds under that directory.
- **What:** Every file in the project root is downloadable: source, `package.json`, `mega.js` (with Mega credentials), and the temporary session folders.
- **Abuse:**
  1. `GET /mega.js` reveals the Mega account credentials.
  2. Account takeover: an attacker calls `/pair?number=<victim>`, persuades the victim to enter the code ("verify your account"), then polls `GET /<victim-number>/creds.json` during the 1-second (pair) or 15-second (QR) window, or **indefinitely if the send step fails**, and gets a full, working session for the victim's account.
- **Fix:** Serve only an explicit `public/` folder containing `pair.html` and assets. Keep session directories outside any served path. Remove `mega.js`.

### P-03 — Hardcoded Mega credentials
- **Where:** `Bot_Pair_Code-main/mega.js:5-6` (email and password literals). Also see P-02.
- **What/abuse:** Anyone with the source, or with HTTP access to the server, can log in to that Mega account. The README tells users to paste their own credentials here, so they would be committed to version control.
- **Fix:** Delete `mega.js` (it is unused; `megajs` is not even installed). **Change that Mega account's password and review its contents** (see "Actions you must take").

### B-01 — Remote code update command
- **Where:** `MD-main/commands/update.js` (whole file). Key lines: `154-159` (URL from the argument, settings, or env), `51-107` (downloads over `http` or `https`, following redirects), `109-135` (shell `unzip`/`7z`/PowerShell), `205` (copies over the codebase), `31-49` (`git fetch` → `git reset --hard origin/main` → `git clean -fd`), `284` (`npm install`), `245` (`pm2 restart all`, which restarts **every** PM2 app on the host). Wired at `main.js:1580-1588`.
- **What:** Any user who passes the owner/sudo check can replace the bot's code with an arbitrary ZIP and restart it. If the folder is a git clone, the update pulls whatever the upstream remote publishes.
- **Abuse:** Combined with B-02 or B-06, this is full remote code execution on your server, which means theft of `session/creds.json` and takeover of the account. Even without a bypass, it gives the upstream repository owner a code-push channel into your server.
- **Fix:** Remove the command entirely. Update through your own `git pull` and PM2/Docker restart on the server (documented in DEPLOYMENT.md).

### B-02 — Owner check can be bypassed
- **Where:** `MD-main/lib/isOwner.js`
  - `:71` `if (senderId.includes(ownerNumberClean)) return true`. Any JID that *contains* the owner digits as a substring passes. This includes LIDs, which are random 14-15 digit numbers, and other numbers that contain yours.
  - `:5-6,71` If `ownerNumber` is empty, `"x".includes("")` is `true`, so **everyone is owner**.
  - `:38-63` The `participants.find(...)` predicate includes `pIdClean === ownerNumberClean`, which matches *the owner's own participant entry* no matter who sent the message. Then `:59-61` returns `true`. So in any group where the owner is present with a phone-number ID, **every member using an `@lid` address is treated as owner**. `participantLidNumeric === botLidNumeric` can also match on empty strings.
- **Abuse:** Gain owner rights and run `.update <evil zip>` (B-01), `.sudo add`, `.mode`, `.setpp`, `.clearsession`, `.antidelete`, `.pmblocker` and so on.
- **Fix:** One central `isOwner(senderJid)` that normalises the sender with Baileys `jidNormalizedUser`/`jidDecode` and compares **exactly** against a configured set of owner JIDs in both PN (`<digits>@s.whatsapp.net`) and LID (`<lid>@lid`) forms. Use Baileys' LID mapping store (`signalRepository.lidMapping`) to translate LIDs to PNs. Treat `key.fromMe` as owner. Fail closed if the owner config is empty (refuse to start).

---

## High

### B-03 — Local file read through `{ url }` media from untrusted APIs
- **Where (library):** Baileys 7 `lib/Utils/messages-media.js:256-264`. Any media `url` that does not start with `http://`, `https://` or `data:` is opened with `fs.createReadStream(url)`.
- **Where (callers passing third-party values):** `commands/video.js:188`, `play.js:47`, `spotify.js:37,42`, `sora.js:32`, `instagram.js:114,120`, `tiktok.js:126,133,222`, `facebook.js:171,222`, `textmaker.js:22,175`, `anime.js:96`, plus `song.js:92` (search result thumbnail).
- **What/abuse:** About 12 free, unaudited APIs (okatsu, eliteprotech, yupra, apis-keith, siputzx, hanggts, ephoto360 scraping, and others) decide what `url` is. If any of them is compromised or malicious and returns `"session/creds.json"` or `"/etc/passwd"`, the bot uploads that local file to the chat as a video, audio or image. Your WhatsApp session is then stolen.
- **Fix:** One `safeRemoteMedia(url)` helper that accepts only `https:` URLs (reject other schemes, credentials in the URL, and private or loopback IPs after DNS resolution), downloads with a size cap and timeout, and passes a **Buffer** to Baileys. Never pass a `{ url }` object built from external data.

### B-04 — SSRF through automatic link previews
- **Where:** `MD-main/package.json:46` (`link-preview-js`, never required by bot code) and `index.js:134` (`generateHighQualityLinkPreview: true`). Baileys `Socket/messages-send.js:1071-1079` + `Utils/link-preview.js:24` fetch the first URL found in **every outgoing text message** whenever `link-preview-js` is importable.
- **What/abuse:** Many commands echo user input in their reply. For example, `.lyrics <anything>` replies `couldn't find any lyrics for "<input>"` (`commands/lyrics.js:26`), and `.trt`, `.tag`, `.hidetag` and AI replies do the same. Sending `.lyrics http://169.254.169.254/latest/meta-data/` or `http://127.0.0.1:<port>/` makes **your server** fetch that URL, and the page title, description and image are posted back to the chat. That allows cloud-metadata exposure, internal port scanning, and access to admin panels. `npm audit` also lists known SSRF bypasses in `link-preview-js` itself.
- **Fix:** Remove `link-preview-js`. Set `generateHighQualityLinkPreview: false` and `linkPreviewImageThumbnailWidth: 0`. Pass `linkPreview: null` where needed. If previews are wanted later, supply a custom `getUrlInfo` that uses the same SSRF-safe fetcher as B-03.

### B-05 — Hardcoded third-party secrets
Locations only (values intentionally omitted):

| Secret | Location |
|---|---|
| Telegram **bot token** (gives full control of someone's Telegram bot) | `MD-main/commands/stickertelegram.js:39` |
| NewsAPI key | `MD-main/commands/news.js:5` |
| OpenWeatherMap key | `MD-main/commands/weather.js:5` |
| Google/Tenor API key | `MD-main/commands/emojimix.js:29` |
| Giphy key | `MD-main/settings.js:7` |
| api.xteam.xyz and api.lolhuman.xyz keys | `MD-main/config.js:18-19` |
| api.princetechn.com key | `MD-main/commands/remini.js:54` |
| Public demo keys ("shizo", "prince", "gifted") | `dare.js:5`, `flirt.js:5`, `goodnight.js:5`, `quote.js:5`, `truth.js:5`, `meme.js:5`, `shayari.js:5`, `imagine.js:33`, `pies.js:7`, `roseday.js:6`, `ai.js:54-55` |
| Mega email and password | `Bot_Pair_Code-main/mega.js:5-6` (P-03) |

- **Abuse:** These keys almost certainly belong to the upstream author or to other people. Using them is credential misuse, they can be revoked at any time (silently breaking commands), and the Telegram token lets whoever holds it act as that bot.
- **Fix:** Move every key to environment variables, validated at startup. Commands whose key is not configured are disabled and hidden from `.help` instead of using a shared key. Ship `.env.example` with empty values.

### B-06 — Sudo privilege escalation
- **Where:** `MD-main/commands/sudo.js:16,38`. `isOwnerOrSudo` returns true for sudo users, so a sudo can `.sudo add` others. `lib/isOwner.js:76-77` treats sudo as owner everywhere, including `.update`, `.clearsession`, `.mode` and `.setpp`.
- **Abuse:** One compromised or careless sudo can mint further sudos and reach B-01.
- **Fix:** Separate permission levels (`owner` > `sudo` > `admin` > `user`). Only real owners manage sudo. Sudo never gets code or session-affecting commands.

### P-04 — Pairing sockets never closed
- **Where:** `Bot_Pair_Code-main/pair.js:76-149` (no `end()`/`logout()` after sending creds), `qr.js:137-197`, `qr.js:253-259` (timeout leaves the socket running).
- **What/abuse:** After each successful pairing, the pairing server remains **a live linked device on that WhatsApp account** in memory. It receives the account's messages and can send as it until the process restarts. It also fights with the real bot for the same credentials ("conflict" errors, which `pair.js:188` then silences). Abandoned requests (code never entered) keep sockets open forever.
- **Fix:** After creds are saved and delivered, call `sock.end()`. Do **not** call `logout()`, which would revoke the session the bot needs. Add a hard per-request timeout (for example 3 minutes) that ends the socket and deletes the temp folder in every code path.

### P-05 — No rate limiting or concurrency cap; reconnect storm
- **Where:** `Bot_Pair_Code-main/index.js` (no limiter), `pair.js:137-148` (any non-401 close immediately calls `initiateSession()` again, with no limit or delay).
- **Abuse:** Strangers can use your server to send pairing-code notifications to arbitrary numbers (harassment), open unlimited Baileys sockets (memory and CPU exhaustion), and get your server IP flagged by WhatsApp.
- **Fix:** Per-IP rate limit (for example 3 requests per 10 minutes), a global concurrency cap (for example 3 active sessions), a capped retry count with exponential backoff, and an optional shared-secret access token (`PAIR_ACCESS_TOKEN`) so only you can use the page. Document running it only when needed or behind HTTP auth.

### P-06 — Third-party hosted pairing server referenced
- **Where:** `Bot_Pair_Code-main/README.md:3`, `MD-main/commands/pair.js:75` (`knight-bot-paircode.onrender.com`; not wired into `main.js`).
- **What/abuse:** Whoever runs that host generates the session on **their** server, so they receive your full `creds.json`. With P-02 and P-04 in mind, assume any public instance of this code keeps a copy.
- **Fix:** Delete `commands/pair.js` and the README link. Document self-hosting only.

### B-07 — Antidelete stores everything, unbounded
- **Where:** `MD-main/commands/antidelete.js:7` (`messageStore` Map, never trimmed except on deletion events), `:107-205` (downloads **every** image, video, audio and sticker of every message in every chat to disk, with no size limit), `:37-54` (wipes the folder only once it passes 200 MB).
- **Abuse:** Once enabled, anyone in any group can exhaust memory and disk by sending large videos. It also keeps copies of everyone's messages.
- **Fix:** LRU cache with a maximum entry count and a 24-hour TTL, a media size cap (for example 10 MB), media only for chats you opt in, and temp files deleted on eviction.

### D-01 — Vulnerable dependencies
`npm audit` on the bot: **25 vulnerable packages: 5 critical, 11 high, 7 moderate, 2 low.**

| Package | Sev | Used? | Notes |
|---|---|---|---|
| `request` | critical | **no** | deprecated, SSRF; pulls vulnerable `form-data`, `qs`, `tough-cookie`, `uuid` |
| `youtube-yts` → `jsonpath-plus` | critical | dead code only | RCE in jsonpath-plus |
| `libsignal@2.0.1` → `protobufjs@6.8.8` | high/critical | **no** (direct dep never required) | "contains protocol/security bugs"; Baileys uses its own fork |
| `link-preview-js` | high | indirectly (B-04) | SSRF bypasses |
| `sharp@0.32.6` | high | **yes**, on untrusted images | libvips CVEs |
| `axios@1.8.x` | high | **yes** | SSRF/DoS advisories; upgrade |
| `file-type@16` | moderate | yes (`uploadImage.js`) | infinite loop on malformed input (DoS) |
| `yt-search`, `ruhend-scraper` → `node-fzf`/`redstar`/`minimatch` | high | yes | ReDoS in a transitive dep |
| `translate-google-api` (axios 0.20) | high | **no** | — |
| `gtts` → `request`, `yargs` | moderate | yes (`.tts`) | replace or isolate |
| `cookie`, `set-cookie` | low | **no** | — |

- **Fix:** Remove the 24 unused dependencies. Upgrade `sharp`, `axios` and `file-type` to current releases. Replace `gtts`, which depends on deprecated `request`, with a direct call to the same Google TTS endpoint through the safe fetcher. Re-run `npm audit` and record the result. The pairing service has 0 known vulnerabilities, but `path`, `phone` and `qrcode-terminal` are unused there and can be removed.

### R-01 — Session and secrets would be committed to git
- **Where:** `MD-main/.gitignore` is encoded as **UTF-16 LE** (`file` reports "Unicode text, UTF-16"). Git does not parse UTF-16 ignore files, so `session/`, `.env` and `node_modules/` are **not** ignored. `Bot_Pair_Code-main/.gitignore:25-27` has an empty "Session files" section, so `/<number>/` and `qr_sessions/` are not ignored. `MD-main/.gitignore` also ignores `package-lock.json`.
- **Abuse:** The first `git add .` and push publishes `creds.json`, which is account takeover by anyone who sees the repository.
- **Fix:** One ASCII root `.gitignore` covering `**/session/`, `**/sessions/`, `qr_sessions/`, `.env*` (except `.env.example`), `baileys_store.json`, `data/*.json` runtime state, `tmp/`, `temp/`, `logs/` and `node_modules/`, while committing lockfiles. Add a pre-commit check that refuses any `creds.json`.

---

## Medium

### B-08 — SSRF in `.fb`
- **Where:** `MD-main/commands/facebook.js:17` (`url.includes('facebook.com')`), `:31` (`axios.get(url, { maxRedirects: 10 })` from the server).
- **Abuse:** `.fb http://127.0.0.1:8000/?x=facebook.com` or `http://169.254.169.254/?facebook.com` gets fetched by your server. The final redirect URL is then forwarded to a third-party API. This is blind SSRF, and there is no response size limit.
- **Fix:** Parse with `new URL()`, require `https:`, and require `hostname` to equal or end with `.facebook.com` / `fb.watch`. Then skip the server-side resolve step or route it through the safe fetcher.

### B-09 — Unbounded downloads; ffmpeg on arbitrary documents
- **Where:** No size checks on `downloadMediaMessage` / `downloadContentFromMessage` in `sticker.js:56`, `stickercrop.js:57`, `tag.js:6-14`, `hidetag.js:6-14`, `url.js:6-42`, `simage.js:33-35`, `setpp.js:43-48`, `groupmanage.js:71-73`, `viewonce.js`, `antidelete.js`. `mention.js:190-202` checks size only **after** downloading. Remote downloads use `maxContentLength: Infinity` (`song.js:124`, `igs.js:176`). `sticker.js:33` and `stickercrop.js:33` accept `documentMessage`, so any file type is fed to ffmpeg, which probes the format from content, with no protocol whitelist.
- **Abuse:** Memory and disk exhaustion with multi-hundred-MB media. ffmpeg parsing hostile files (a long history of demuxer CVEs; playlist formats can reference other resources).
- **Fix:** Check `fileLength` before downloading. Stream with a byte cap (for example 15 MB images, 50 MB video). Accept only image and video mimetypes. Run ffmpeg with `-protocol_whitelist file,pipe`, an explicit `-f` input format where known, `-t` limits, and a process timeout.

### B-10 — Mode fails open; whole-file JSON rewrite on every message
- **Where:** `MD-main/main.js:299-306` (on any read or parse error `isPublic` stays `true`), `commands/topmembers.js:18-32` (`incrementMessageCount` reads and rewrites `data/messageCount.json`, which also stores the mode, synchronously on **every** message), `lib/index.js:38-52` (same pattern, non-atomic).
- **Abuse:** Concurrent writes or a crash mid-write corrupts the file, and a private-mode bot silently becomes public. The file also grows without bound and slows every message.
- **Fix:** Store mode in config or a small settings store with atomic writes (write to temp, then rename) and an in-memory cache. Fail **closed** (private) if the state can't be read. Batch message counters in memory and flush periodically.

### B-11 — Group admins can globally ban, including the owner
- **Where:** `MD-main/commands/ban.js:9-19` (group admins may ban), `main.js:309-318` (the ban check runs before any owner exemption; the list is global across all groups).
- **Abuse:** An admin of any group the bot is in can ban you from your own bot.
- **Fix:** Make the global ban owner/sudo only, or scope bans per group. Never apply bans to owners.

### B-12 — User data sent to third parties
- **Where:** `commands/chatbot.js:274-303,348-408` (the last 20 messages per user, plus extracted name, age and location, are sent in a GET query string to `zellapi.autos`), `lib/uploadImage.js:37,57` (images uploaded to qu.ax / telegra.ph to obtain public URLs for `misc`, `remini`, `removebg`), `commands/url.js:71-79` (public upload is the feature), `commands/misc.js:37`, `character.js`, `wasted.js`, `simp.js`, `stupid.js` (other users' profile photos sent to some-random-api).
- **Abuse:** Group members' private content ends up on public hosts and in third-party logs without their knowledge.
- **Fix:** Keep the features, but mark them in `.help` as "uses an external service". Never send chat history. Make the chatbot and upload-based features opt-in via config, defaulting to off.

### B-13 — `.vv` reveals other people's view-once media
- **Where:** `MD-main/commands/viewonce.js:3-24`, wired for everyone at `main.js:1218`. Antidelete also auto-forwards view-once media to the owner (`antidelete.js:181-200`).
- **Abuse:** Any member can defeat view-once for anyone.
- **Fix (needs your decision):** Restrict `.vv` to the owner, or remove it.

### B-14 — Self hot-reload duplicates the bot
- **Where:** `MD-main/index.js:515-521`, `lib/myfunc.js:454-460`.
- **What:** Any change to `index.js` re-`require`s it, which starts a **second** socket with the same creds and duplicates every handler, causing double replies and conflicts. `.update` triggers it too.
- **Fix:** Remove both. Restarts are handled by PM2 or Docker.

### B-15 — Abusive chatbot persona
- **Where:** `MD-main/commands/chatbot.js:348-404` (the prompt instructs the bot to answer insults with slurs and lists explicit slurs).
- **Abuse:** The bot posts abuse in groups, which leads to reports and account bans.
- **Fix:** Replace the prompt with a neutral, configurable persona. Keep the feature off by default.

### P-07 — Session delivered as a WhatsApp document
- **Where:** `Bot_Pair_Code-main/pair.js:84-92`, `qr.js:144-158`.
- **What:** `creds.json` is uploaded to your own WhatsApp chat. It stays in chat history, on every linked device, and in phone backups (Google Drive / iCloud), which are not end-to-end encrypted unless you enabled that. Anyone with brief access to the phone can forward it and fully take over the account.
- **Fix (needs your decision):** Option A keeps chat delivery but adds a strong warning and auto-deletes the message after the bot confirms import. Option B (recommended): the pairing service writes the session directly to a local directory or volume shared with the bot, so nothing leaves the server. This also keeps the session format identical, because both read the same Baileys multi-file folder.

### P-08 — Malformed input crashes the handler
- **Where:** `Bot_Pair_Code-main/pair.js:35` (`num.replace` when `number` is missing or an array → `TypeError`), `pair.js:186-200`, `qr.js:273-287` (global handlers swallow errors).
- **Abuse:** Requests hang (resource exhaustion). Real failures are hidden.
- **Fix:** Validate the type, return 400, use an async error wrapper, and remove the error-swallowing global handlers. Use proper logging and let the process manager restart on truly fatal errors.

### D-02 — Unpinned and mismatched versions
- **Where:** Both `package.json` files use `^` ranges, including on a **prerelease** (`"@whiskeysockets/baileys": "^v7.0.0-rc.9"`). There are no lockfiles. The pairing service uses Baileys 6.7.x and the bot uses 7.0.0-rc. The bot's `engines` says Node >= 18, but Baileys 7 requires >= 20, and `require()` of the ESM-only Baileys 7 needs Node >= 20.19 / 22.12.
- **Fix:** Pin exact versions, commit lockfiles, use the same Baileys version in both services, and set `"engines": { "node": ">=22.12" }`.

### R-02 — Reconnect and shutdown
- **Where:** `MD-main/index.js:395-424` (fixed 5 s, unlimited, old socket and listeners not cleaned up), `:495-499` (startup errors retried every 5 s forever), `:407-417` (on 401 or loggedOut **deletes `./session` without a backup**), no SIGINT/SIGTERM handling (the store is written every 10 s, so the last writes are lost), `:86-92` (`process.exit(1)` at 400 MB RSS).
- **Fix:** Exponential backoff with jitter (1 s → 60 s cap), reset on success. Close the old socket (`ev.removeAllListeners`, `end`) before creating a new one. On loggedOut, move the session to `session.bak-<timestamp>` and exit with a clear message instead of deleting it. Graceful shutdown flushes the store and closes the socket. Replace the RSS self-kill with bounded data structures and PM2/Docker memory limits.

### R-03 — Unbounded in-memory state
- **Where:** `lib/lightweight_store.js` (unbounded number of chats and contacts, full JSON written every 10 s), `chatbot.js:8-11` (Maps per sender), `tictactoe.js:4` / `hangman.js:4` / `trivia.js:3` (games never expire), antidelete (B-07).
- **Fix:** LRU caps and TTLs everywhere. Atomic store writes. Optionally an in-memory-only store.

---

## Low

### B-16 — Unwanted promotional behaviour
- **Where:** Every reply that uses `channelInfo` (`main.js:202-212`, `lib/messageConfig.js`, and about 40 other places) is labelled "Forwarded from Akram MD" with the upstream newsletter JID. `index.js:348-359` sends "join our channel" to yourself on every connect. `main.js:243-269` button replies send upstream channel and support-group links. `lib/index.js:239,282` store the upstream channel ID in group settings. `commands/github.js` advertises the upstream repo. Branding is "Knight Bot", "Mr Unique Hacker" and "Ak Bot".
- **Note:** None of this **auto-joins** or **auto-follows** anything (verified: no `groupAcceptInvite`, `newsletterFollow` or invite-link calls). It is advertising, not a backdoor.
- **Fix:** Remove all newsletter decoration and promotional messages. Make the bot name and links configurable.

### B-17 — Shell strings for ffmpeg; drawtext escaping
- **Where:** `exec()` with interpolated paths in `sticker.js:102-113,128-133,155-160,203-206`, `stickercrop.js:111-135,239-253`, `igs.js:46-76,88-93,130-133,346-350`, `emojimix.js:60-71`, `anime.js:33-39`, `stickertelegram.js:108-119`. Today the paths come from `Date.now()`, so **no user input reaches a shell (not exploitable)**, but this is fragile. `attp.js:54-61,108-116` escapes user text into an ffmpeg `drawtext` filter by hand. I could not prove an injection, but hand-escaping filter syntax is error-prone.
- **Fix:** `spawn("ffmpeg", [args...])` with no shell. For `.attp`, write the user text to a temp file and use `textfile=`.

### B-18 — Unencoded parameters in third-party URLs
- **Where:** `commands/weather.js:6` (`q=${city}`), `commands/translate.js:51,65,80` (`tl=${lang}`), `commands/play.js:33` (`url=${urlYt}`).
- **Fix:** Use `encodeURIComponent` or `URLSearchParams`. Validate `lang` against `/^[a-z]{2}(-[A-Z]{2})?$/`.

### B-19 — Sudo list visible to anyone
- **Where:** `commands/sudo.js:27-36`. **Fix:** Owner only.

### B-20 — CSV formula injection in `.export` (found in the 3.20.1 review)
- **Where:** `commands/realestate/marketing.js` (`cell`). Clients saved automatically from `#12` questions and written requests carry their WhatsApp name and message, and lead-ads imports carry form answers, all chosen by strangers. A value such as `=HYPERLINK("http://…","…")` or `+cmd|…` was written as is, and Excel would evaluate it when the agent opened the export.
- **Fix:** A text cell starting with `=`, `+`, `-`, `@`, a tab or a return gets a leading `'` (phone numbers like `+2010…` and plain numbers are left as they are). `.import` removes that apostrophe, so an export imports back unchanged. Tested in `test/exportsafety.test.js`.

### B-21 — Clients' details shown in groups with outsiders (found in the 3.30.1 review)
- **Where:** the client commands (`commands/realestate/leads.js`, `viewings.js`, `deals.js`, `campaign.js`, `rentals.js`, `feed.js`, `.export`, `.digest`) and the client lines in `.listing` / `.project` / `.offer`. They checked who typed the command (owner or sudo) but not who could read the answer. Typed in a broker group or a group with clients, a client card showed the name, phone number, budget and notes to every member. A morning summary turned on in a team group kept being posted there after an outsider joined. Listings' owners have been private since 3.13 (shown only in the sender's own chat); clients had no such rule.
- **Fix:**
  - **Where client data is allowed:** commands marked `clientData` run only in the sender's own chat with the bot (or the bot's note-to-self), or in a group whose members are **all** the owner, sudo users or the bot. The dispatcher checks this once (`ctx.isStaffOnlyChat`, `permissions.allStaff`), and a group whose members can't be read counts as mixed.
  - **Mixed commands:** `.listing add/edit` and `.project` say how many clients a listing suits without naming them. `.listing match`, `.listing ask` (owners' answers come back to that chat) and `.offer` for a named client are refused.
  - **Morning summary:** it checks the group again each day and sends a short "held" note instead of the summary when someone else is in it.
- **Tests:** `test/clientdata.test.js`.

### B-22 — The customer assistant answered every private chat and could relay links (found in the 3.36.0 review)
- **Where:** `services/assistant.js` (3.32–3.35).
  - **Personal chats:** with `.assistant on`, every private text or voice note from a number that isn't staff or a listing's owner went to the AI provider. The sender was saved as a client, and an AI reply went out. Agents often run the bot on their own WhatsApp, so messages from family, friends and suppliers were affected: sent to a third party, answered by a bot, and added to the client list.
  - **Planted links:** the answer was the AI's text as is. A client could try to talk it into writing a link ("pay the deposit at …"), which the client then receives under the agent's name. The client can only target themselves, but a screenshot of it is a scam aid.
- **Fix:**
  - **Personal messages:** the AI is told to answer `[IGNORE]` for a clearly personal or unrelated message. The bot then sends nothing and saves nothing, and the greeting and away messages still apply.
  - **Saving clients:** a sender is saved as a client only after a real answer.
  - **`.assistant ignore <number>`:** that number is never sent to the AI (local "0100…" numbers are normalised). `.assistant ignored` lists them, staff-only chats only.
  - **Links:** every link or bare domain in an answer is removed, except Google Maps links (listing pins) and links that appear in the agent's own office info or profile. The prompt also forbids links.
- **Tests:** `test/assistant.test.js` ("personal messages …").

### B-23 — Notices kept reaching a removed team member (found in the 3.43.1 review)
- **Where:** everything that notifies "the client's member" (`lead.assignee`):
  - the `#12` and written-request notices, and the self-booking notice;
  - the assistant's handoffs, "عايز يكلمك" and its 2-hour reminders;
  - self-booked viewings, whose reminders went to the chat stored at booking time;
  - the `.team autoassign` rotation (3.43.0), which kept the member list it was given.

  Removing someone's sudo (`.sudo del`) took away their commands but not these messages. They carry clients' names, numbers and what they wrote. The rotation would also keep giving that person new clients.
- **Fix:**
  - `rotation.notifyJid(app, lead)` decides who hears about a client: the assigned member only while they are still the owner or a sudo user, else the owner. Every notice above uses it.
  - Self-booked viewings check the same before each reminder.
  - The rotation skips members who are no longer on the team, and `.team autoassign` says when nobody in the list is left.
- **Tests:** `test/rotation.test.js` ("someone whose sudo is removed …").

### B-24 — Strangers could fill the disk with seller-offer photos (found in the 3.49.1 review)
- **Where:** `services/sellers.js` (3.45.0).
  - **What anyone could do:** with `.agent sellers on`, anyone who writes "عايز أبيع شقتي" starts an offer, then sends up to 8 photos.
  - **The limits were per number and per hour** (8 messages per 10 minutes, 20 new offers an hour), not on what is kept. Offers waiting for the agent were only trimmed after being added or dismissed, and never expired.
  - **The result:** sustained abuse from many numbers could store about 160 re-encoded photos an hour, every hour.
- **Fix:**
  - at most 100 offers wait for the agent, and a new number isn't collected beyond that;
  - at most 400 photos are kept for all waiting offers together;
  - a waiting offer untouched for 30 days expires and its photos are deleted (checked when a new offer starts and when `.sellers` is opened).
- **Tests:** `test/sellers.test.js` ("what strangers can store is bounded …").

### B-25 — A long run of spaces froze the bot (found in the 3.61.1 review)
- **Where:**
  - `services/realestate.js` `monthlyIn` (3.60.0), and the older down-payment and delivery patterns in `services/leads.js` `parseLeadText`;
  - to a lesser degree `search` and `parseListingText`.
- **What was wrong:** the patterns have optional words between `\s*`, for example `قسط\s*(?:شهري)?\s*:?\s*(?:حدود)?\s*<amount>`. When no amount follows a long run of whitespace, the regex engine tries every way of splitting that run among the `\s*`. The time grows with a high power of its length.
- **What anyone could do:** send "عايز شقة قسط" followed by about 285 spaces, which is within the 300-character limit on requests. It took **6.3 s** in `requests.detect`, and Node runs one thing at a time, so the whole bot stopped answering for that long, for every such message. The parse happens before the per-client limit, so there was no throttle. It could be sent:
  - privately, with `.agent requests on`;
  - in a watched brokers' group (`feed.js` reads every message);
  - in a Meta lead-ad form (read on `.import leads`).
  - "استلام" or "تسليم" with spaces cost about 0.5 s on older code; `.listings` and listing posts about 0.1 s.
- **Fix:** `re.squeeze` turns every whitespace run into one space, or one line break if it had one. It runs at the start of `parseLeadText`, `parseListingText`, `search` and `monthlyIn`, so no caller can skip it. With no run longer than one character, the `\s*` have nothing to split. `extractFree` already did this.
  - After the fix: 0–11 ms for the same inputs. A sweep of the other parsers of outside text (seller intent, "talk to a human", owner answers, report words, locations, booking) found none slower than 30 ms.
- **Tests:** `test/redos.test.js`: every parser of outside text on property words with 290 spaces, tabs, line breaks or "1 " runs, each under 300 ms (it fails on the code before the fix), and squeezing doesn't change what is read.
- **Also:** both services' dependencies were checked again with `npm audit`: 0 known vulnerabilities.

### Design note — listings from forwarded posts and WhatsApp channels (`.drafts`, `.channel`, 3.63.0)
- **What comes in:** posts the owner or a sudo user forwards to the bot in their own private chat, and posts in channels the owner adds. A channel's admin is someone else, so its posts are outside content.
- **Where they can go:**
  - Channel messages had always been dropped. They now reach only a dedicated `newsletter` event, never commands or the other listeners, and only channels in `channels.json` are read. Following a channel changes the account, so `.channel` is owner-only.
  - Forwarded posts make drafts only in the forwarder's own chat with the bot. Clients, groups and other chats never do.
- **What they can store:** at most 50 drafts waiting (then nothing more is kept), 10 photos each, 4,000 characters of text, and a draft untouched for 14 days is deleted with its photos. Each post ID is taken once (the last 300 per channel). Review messages to the owner are capped at 20 an hour. Post text goes through the squeezed parsers (B-25) and is in `test/redos.test.js`.
- **Photos:**
  - Channel media isn't end-to-end encrypted. It is fetched by its `directPath`, from `mmg.whatsapp.net` only (checked after building the URL, so `//other.host/…` and a post's `url` field are never used). It is capped at 15 MB through `core/http` (no redirects off the safe-URL check).
  - Every photo, forwarded or from a channel, is re-encoded with sharp before it is written. Anything that isn't a picture fails there.
  - Files are written `0600` in `0700` folders.
- **Short Maps links (3.64.0):** saving a draft opens a `maps.app.goo.gl` link in the post into a pin. This only follows redirects within Google's hosts (`places.expandShort`). For a channel's `auto` posts, opening them shares the 30-an-hour budget with clients' links.
- **Where reviews go (3.64.0):** if `.channel add` is run in a group with outsiders, the reviews and the "added" notices (numbers in posts, clients a unit suits) go to the owner's private chat instead.
- **Privacy:** phone numbers in a post (usually the poster's) are taken out of the listing text. They show only in the owner's review, so another broker's number never reaches a client through a card. `.drafts` is client data (B-21): private chat or staff-only group.
- **Not verified against WhatsApp:** the shape of a `newsletterFetchMessages` reply (`.channel import` and the 10-minute fallback). It is read defensively (any `<message>` with a `<plaintext>` child, decoded like Baileys' live path), and it reads nothing rather than failing on another shape.
- **Tests:** `test/drafts.test.js`.

### Design note — running a command in a group from a private chat (`.in`, 3.58.0)
- **What it is:** `.in <group> <command>` runs a command as if the owner had typed it in that group, so a group can be set up without writing in it. It is a new way into groups, so its limits are deliberate:
  - **Who:** the owner only (not sudo users), and only from a private chat.
  - **Where:** only a group the bot is in (its metadata must load). It is named by its number in `.groups` or its ID. It can't run `.in` itself.
  - **The same checks as a typed command:** the made-up message goes through the dispatcher's `execute`. Group-disabled commands, permissions, "bot must be admin", and the client-data rule (B-21) all apply as they would in that group, so clients' details still aren't shown for a group with outsiders, even though the reply would come to the owner.
  - **What reaches the group:** only what the command would have posted there if typed in it. Replies come back to the owner's chat unless `post` is given. The made-up message is never quoted or reacted to.
  - **Logged** as a command run in a group from the owner's chat. No message text is logged.
- **Tests:** `test/remoterun.test.js`.

### P-09 — Web hardening
- **Where:** `Bot_Pair_Code-main/index.js` (no `helmet`, `x-powered-by` enabled, no CSP), `pair.html:424` (axios `1.0.0-alpha.1` from cdnjs with no `integrity`), `pair.html:9` (Font Awesome without SRI), `pair.js:160` (pairing code logged with the phone number).
- **Fix:** Add `helmet` with a strict CSP. Remove axios (use `fetch`) and self-host icons or drop them. Redact phone numbers in logs and never log codes.

### P-10 — Promotional messages to every paired account
- **Where:** `pair.js:96-111`, `qr.js:162-177` (YouTube links, "©2025 Mr Unique Hacker").
- **Fix:** Send only a neutral confirmation, or nothing if Option B in P-07 is chosen.

### R-04 — Correctness bugs that hide errors
- `main.js:1665`: the catch block references `chatId`, which is block-scoped inside `try`, so it throws a `ReferenceError` instead of replying.
- `main.js:869`: `tictactoeMove` is undefined, so `.move` throws.
- `commands/warnings.js:23`: reads `warnings[user]`, but `warn.js:91` writes `warnings[chat][user]`, so it always reports 0.
- `index.js:179-181`: clears `msgRetryCounterCache` on every message, which defeats message-retry handling.
- `index.js:161-164` + `477-484`: statuses are processed twice.
- `index.js:94-113`: placeholder number forces pairing mode. In non-TTY environments it uses `settings.ownerNumber`, which lacks a country code, so validation fails and the process exits.
- `package.json` scripts `cleanup`, `reset-session` and `docker:build` are broken.

---

## Checked and not found
- `eval`, `new Function`, the `vm` module, `require`/`import` of fetched content, plugins installed from URLs, Base64 or hex payloads, minified or obfuscated files, invisible Unicode tricks. The only zero-width characters are the joiner inside emoji and an LRM used as an empty sticker author.
- Auto-update or `git pull` **at startup**. Updating only happens through the `.update` chat command (B-01).
- Auto-joining groups, following channels, reacting to or replying to specific hardcoded accounts, hidden chat commands.
- Hardcoded owner or sudo numbers used for authorisation. `data/owner.json` and `data/premium.json` contain upstream numbers, but they are only printed or unused. Still, they should be removed.
- Shell commands exposed in chat (`$`, `>`, `exec`). There are none, apart from B-01.
- Session upload to Pastebin, Mega, GitHub or any remote API. `mega.js` exists but is never called.
- Stack traces returned to HTTP clients. The pairing service returns generic messages.
- Path traversal in the bot. `url.js` uses `path.extname`, which cannot contain separators.

## Actions you must take (cannot be done in code)
1. **Mega:** change the password of the account in `mega.js:5-6`. If it is yours, review its files and enable 2FA.
2. **Telegram bot token** (`stickertelegram.js:39`): it is not yours, so stop using it. If you want `.tg`, create your own bot with @BotFather and put the token in `.env`.
3. **API keys** (NewsAPI, OpenWeather, Tenor/Google, Giphy, xteam, lolhuman, princetechn): treat them all as public. Get your own keys for the features you want and put them in `.env`. Never reuse the hardcoded ones.
4. **WhatsApp session:** if any `creds.json` from this setup was ever uploaded anywhere, or was generated through a public pairing site such as the one in the README, go to WhatsApp → Linked devices, log out all unknown devices, and pair again with your self-hosted service.
5. If either folder was ever pushed to a public repository, assume every secret above is compromised, even after deletion, because git history keeps it.

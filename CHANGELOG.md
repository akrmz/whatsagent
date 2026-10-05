# Changelog

All notable changes. Finding IDs (P-01, B-02, …) refer to [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md).

## 2.2.0 — 2026-10-06

### Fixed
- **yt-dlp "not installed" although it is.** `~` in `YTDLP_PATH` (and `FFMPEG_PATH`, `FONT_FILE`, `YTDLP_COOKIES`, `SESSION_DIR`, `DATA_DIR`, `TMP_DIR`) is now expanded to your home folder. Before, `YTDLP_PATH=~/.local/bin/yt-dlp` was taken literally, yt-dlp was not found, and every download command was hidden.
- A missing **ffmpeg** no longer hides `.video`, `.tiktok`, `.facebook`, `.instagram` (they fall back to single-file formats). Only `.song`, `.spotify`, `.igs`, stickers and the audio converters need it.
- Non-Latin titles from yt-dlp (Arabic, emoji …) are no longer garbled, and `.song` keeps Arabic song names in the file name.
- Network errors inside commands (DNS failure, connection reset) now show "the external service is not responding" instead of "Something went wrong".

### Added
- **Tool diagnostics.** Startup log, `npm run check` and the new **`.doctor`** (owner) show each tool's path and version, or exactly why it can't be used (`does not exist. Check YTDLP_PATH`, `chmod +x …`, not in `PATH` …). `.doctor` also shows connection, memory and uptime, lists disabled commands grouped by what they need, and says what to install or set for each.
- 🛠️ **Tools**: `.calc` (safe calculator, no `eval`), `.qr` / `.readqr` (make and read QR codes), `.currency` (exchange rates), `.remind` (persistent reminders: `10m`, `1h30m`, `2d` …, list/delete, delivered after restarts), `.poll` (native WhatsApp polls, single or multiple choice), `.afk` (away notices when you're mentioned), `.getpp` (profile or group picture), `.toaudio` (video → MP3), `.tovn` (anything → voice note).
- 📚 **Info & search**: `.wiki` (any language, e.g. `.wiki ar: القاهرة`), `.define` (English dictionary), `.time <city>`, `.prayer <city>` (today's prayer times and the next prayer), `.quran <surah:ayah>`.
- 📥 **Downloads**: `.yts` (YouTube search; then `.play 2` or `.video 2` picks a result), `.dl <link>` (one command for YouTube, TikTok, Instagram, Facebook, X/Twitter, Reddit, SoundCloud, Pinterest, Vimeo, Dailymotion, Twitch, Threads, Snapchat), `.twitter` / `.x`.
- 👮 **Group**: `.link` (invite link), `.lock` / `.unlock` (who may edit group info), `.leave` (owner).
- **`.ai` understands images**: send or reply to a photo or sticker (`.ai what does this say?`, or just `.ai` to describe it).
- **`.help <section>`** (`.help tools`, `.help info`, `.help downloads` …) lists one section with descriptions; mistyped names get "Did you mean …?".
- `TIMEZONE` setting (validated) for `.time` and `.remind`.
- 15 tests for the new features (calculator safety, reminders, AFK, help, polls, site detection …); 71 in total.

### Changed
- **`.weather` needs no API key** anymore: it uses Open-Meteo and adds a 3-day forecast. `OPENWEATHER_KEY` is ignored.
- New `.help` sections: 🛠️ Tools and 📚 Info & search (`.weather` moved to Info).

### Dependencies
- Added `qrcode` 1.5.4 and `jsqr` 1.4.0 (pinned). `npm audit`: 0 vulnerabilities.

## 2.1.0 — 2026-10-04

### Added
- **`.update`** (owner only): reports whether a newer version of the bot is on your GitHub repository (commits, version, last changes) and whether a newer **yt-dlp nightly** exists. **`.update now`** installs both:
  - yt-dlp: `yt-dlp --update-to nightly` (requires the standalone binary).
  - Bot: `git fetch` from `UPDATE_REMOTE`/`UPDATE_BRANCH` (default `origin`/`main`), fast-forward only, refused if the server has local changes or local-only commits; `npm ci` when `package.json`/`package-lock.json` changed; validated with `npm run check`, **automatic rollback** if validation fails; then a graceful restart through PM2/Docker.
  - Unlike the removed 1.x command (audit B-01), it accepts no URL or other input, never runs a shell, and cannot be used by sudo users.
- `UPDATE_REMOTE`, `UPDATE_BRANCH` settings (validated; option-like values are rejected).
- 11 tests for the updater (fake git and processes).

### Changed
- **yt-dlp nightly.** The Docker image now ships the official standalone nightly binary (SHA-256 verified at build time) in `/app/bin`, owned by the bot user so `.update now` can update it; Python is no longer installed in the image. The PM2 instructions install the same binary into `~/.local/bin`.
- **Deployment from GitHub.** The server is now a git clone of <https://github.com/akrmz/whatsagent> (public URL or a read-only deploy key), which is what makes `.update` work. The repository was published with a fresh history; the old local history containing leaked secrets was not pushed.

## 2.0.0 — 2026-10-04

A security-focused rewrite of both services. Your existing session (`MD-main/session/creds.json`) and the old `data/*.json` settings keep working; they are migrated automatically on first start.

### Before you upgrade (action required)

- **Configuration moved from `settings.js` to `MD-main/.env`.** Copy `.env.example` to `.env` and set `OWNER_NUMBERS` to your number **with country code** (the old `settings.js` had it without one).
- **Rotate every secret that was in the old code.** See "Actions you must take" in the security audit.
- The pairing service needs a `.env` with `PAIR_ACCESS_TOKEN`.
- Node.js **22.12 or newer** is required.

### Security fixes

Pairing service:
- **P-01** `?number=..` could delete any directory on the server. Input is now validated before any filesystem access, and temporary folders use random names in a private directory.
- **P-02** The whole project folder, including in-progress session credentials and `mega.js`, was served over HTTP. Now only `public/` is served.
- **P-03** Hardcoded Mega account credentials removed (`mega.js` deleted).
- **P-04** Pairing sockets were never closed, so the server stayed a linked device of every account that paired. The socket is now always closed after delivery, failure or timeout.
- **P-05** Strangers could use the page freely. It now requires an access token, rate-limits per IP, caps concurrent pairings, times out, and retries with bounded backoff.
- **P-06** References to a third-party hosted pairing server removed.
- **P-07/P-10** The session is now saved directly on the server by default instead of being sent through WhatsApp. Promotional messages removed.
- **P-08/P-09** Strict input validation, Helmet security headers and CSP, no CDN scripts, no error-swallowing global handlers, pairing codes never logged, phone numbers masked in logs.

Bot:
- **B-01** Removed `.update`, which downloaded and installed code from any URL or reset to the upstream repository (remote code execution).
- **B-02** Owner check rewritten. The old one matched substrings, let any `@lid` user in a group with the owner count as owner, and made everyone owner if the owner number was empty. Matching is now exact on normalized PN/LID IDs, and an empty owner list refuses to start.
- **B-03** Media from external APIs is downloaded into memory through the safe client and sent as a buffer. A malicious API can no longer make Baileys read local files such as the session.
- **B-04** `link-preview-js` removed, and link previews disabled. Echoing a user-supplied URL no longer makes the server fetch it (SSRF).
- **B-05** All hardcoded API keys and the Telegram bot token removed. Keys now come from `.env`, and commands without a key are disabled.
- **B-06** Sudo users can no longer add sudo users or use owner-only commands.
- **B-07** Antidelete is bounded (message count, 24 h age, media size), and media files are deleted on eviction.
- **B-08/B-18** Downloader links are validated against the exact site. Every outbound request goes through an HTTPS-only client that refuses private, loopback and link-local addresses at connect time, re-checks redirects, and caps size and time.
- **B-09/B-17** Every WhatsApp media download is size-checked. ffmpeg runs without a shell and with a local-file protocol whitelist. `.attp` text can no longer inject ffmpeg options.
- **B-10** Settings are written atomically. A corrupted mode file now fails closed (private) instead of open (public). Message counters are no longer rewritten synchronously on every message.
- **B-11/B-19** `.ban`/`.unban` are owner/sudo only, owners can never be banned, and `.sudo list` is owner only.
- **B-12/B-15** The chatbot sends only the triggering message (no history, no extracted personal details), and the abusive persona was replaced with a neutral, configurable one.
- **B-13** `.vv` (reveal view-once) is owner only.
- **B-14** Removed the self-hot-reload that started duplicate bot instances.
- **B-16** Removed the "Forwarded from Akram MD" newsletter label on every reply, the "join our channel" message on connect, upstream channel and support links, and upstream branding.
- **R-01** A working root `.gitignore` (the old one was UTF-16, which git cannot read) now excludes sessions, `.env` and runtime data.
- **D-01/D-02** Dependencies cut from 50 declared / 569 installed to 7 / 209 for the bot. All are pinned and the lockfiles committed. `npm audit`: 0 vulnerabilities (was 25, 5 critical). The pairing service also has 0.
- **Obfuscated dependency removed:** `ruhend-scraper` (used for Instagram/TikTok) hides about 62 KB of obfuscated code behind about 865,000 lines of invisible padding characters, and builds its `require()` targets at runtime. It was replaced by yt-dlp.

### Removed

| What | Why |
|---|---|
| `.update <url>` command | Remote code execution (B-01). A restricted replacement was added in 2.1.0. |
| `mega.js` | Unused; contained Mega credentials |
| Unwired `commands/pair.js` | Sent your number to a third-party pairing server |
| Unwired `gif.js`, `sticker-alt.js`, `lib/ytdl2.js`, `lib/myfunc2.js`, `lib/sticker.js`, `lib/antilinkHelper.js`, `lib/tempCleanup.js`, `.move` | Dead or broken code |
| `data/owner.json`, `data/premium.json` | Upstream author's phone numbers (they were never used for permissions) |
| `.github/FUNDING.yml`, `assets/bmc_qr.png` | Upstream author's donation links |
| `assets/rapid.jpg`, `stickintro.webp`, `sticktag.webp` | Unused |
| Newsletter decoration, connect promo, upstream button replies, pairing promo messages | Unwanted advertising |
| `fs.watchFile` self-reload, RSS self-kill at 400 MB, `global.gc` timer | Caused duplicate instances and crash loops. PM2/Docker memory limits are used instead. |
| `.imagine`/`.flux`/`.dalle` and `.sora` | Their free APIs no longer return images or video (checked 2026-10-04), and Claude has no image generation |
| `.loli` alias | Mapped to an unsupported type and only returned an error |
| `baileys_store.json` | Recent messages are now kept in memory only (bounded), not written to disk in plaintext |
| `settings.js`, `config.js` | Replaced by `.env` + `src/config.js` |

### Changed behaviour

- **Downloads:** `.song`/`.play`/`.mp3`/`.ytmp3`/`.music`, `.video`/`.ytmp4`, `.spotify`, `.tiktok`, `.fb`, `.instagram`, `.igs`/`.igsc` now use yt-dlp running on your server. The previous free download APIs were all dead or paywalled when checked on 2026-10-04. `.spotify` searches the track on YouTube. Instagram photo posts are not supported (videos only).
- **AI:** `.gpt`/`.gemini` (now aliases of `.ai`) and the group chatbot use Claude through the official Anthropic SDK with your own `ANTHROPIC_API_KEY`. The old free endpoints were dead or returned empty answers.
- **Lyrics** use lrclib.net (the old API was down). **Remove background** uses the official remove.bg API (needs `REMOVEBG_API_KEY`). **Remini** needs your own `REMINI_API_KEY`.
- **Need your own key now:** `.news`, `.weather`, `.emojimix`, `.tg`, `.removebg`, `.remini`, `.github` (`GITHUB_REPO`). They are hidden until configured.
- **Permissions are enforced centrally.** Denial messages are uniform. Non-admins using `.tag` get a text message instead of a sticker. Tagging commands no longer require the bot to be admin. `.settings` and `.cleartmp` are available to sudo users.
- **`.autoread` / `.autotyping` without arguments** show the status instead of toggling. Use `on`/`off`.
- **`.clearsession`** asks for `confirm` first.
- **`.quote` with text** no longer returns an anime quote; use `.animuquote`.
- **`.simpcard`** is now an alias of `.simp`, and `.its-so-stupid` an alias of `.stupid`. In the old router these were shadowed and never ran.
- **Warnings:** the separate counters for `.warn` and for the antilink/antibadword "warn" action are merged (migrated automatically), and the limit is configurable (`WARN_LIMIT`). `.warnings` now shows the real count (it always showed 0).
- **Moderation** never acts on admins, sudo users or owners. `.antitag` now exempts admins too. Moderation runs before the ban check, so banned users can no longer bypass antilink.
- **Message counter** (`.topmembers`) counts group messages only.
- **`.delete`** can only remove messages the bot saw since it started (the message store is in memory).
- **Automatic unmute** after `.mute <minutes>` is cancelled if the bot restarts in between.
- **Logged out:** the session is moved to `session.loggedout-<time>` instead of being deleted, and the bot waits for a new session instead of exiting.
- **Pairing service API:** `GET /pair?number=` and `GET /qr` were replaced by token-protected `POST /api/pair`, `POST /api/qr` and `GET /api/status/:id`. The page has no external scripts or icons.
- **Link previews** no longer appear on bot replies.
- **Help menu** is generated from the commands and grouped by category. `.help <command>` shows details.

### Added

- `src/` framework: validated config, auto-loaded commands and listeners with metadata, central dispatcher (permissions, chat type, bot-admin check, cooldowns, bans, mode, error handling), exact PN/LID identity handling for Baileys 6.7 and 7.x field names.
- `.whoami` (shows your IDs and level; helps set `OWNER_LIDS`), `OWNER_LIDS`, configurable `PREFIX`, `BOT_NAME`, `OWNER_NAME`, sticker pack metadata, limits and timeouts.
- Terminal pairing with `PAIRING_NUMBER`. The bot also picks up a new session from the pairing service automatically.
- Health endpoints: bot `GET /healthz` (port 3000), pairing `GET /healthz`.
- Structured logging (pino) with secret redaction and masked phone numbers. Graceful shutdown on SIGINT/SIGTERM.
- `npm run check` dry run, `npm test` (41 bot tests, 18 pairing tests, none connect to WhatsApp), `npm run lint`.
- Dockerfiles (non-root, tini, health check, ffmpeg + yt-dlp + fonts), `docker-compose.yml` (persistent volumes, restart policy, memory limits, log rotation), `ecosystem.config.js` for PM2.
- Documentation: README, DEPLOYMENT, USAGE, ADDING_FEATURES, TROUBLESHOOTING, ARCHITECTURE, SECURITY_AUDIT.

### Dependencies

| | Bot | Pairing service |
|---|---|---|
| Baileys | 7.0.0-rc (release candidate) → **6.7.24** (latest stable, both services pinned to the same version) | 6.7.21+ (caret) → **6.7.24** |
| Node.js | ≥18 (wrong for Baileys) → **≥22.12** | ≥20 → **≥22.12** |
| Runtime deps | 50 declared → 7 pinned: `@whiskeysockets/baileys`, `@anthropic-ai/sdk`, `sharp`, `node-webpmux`, `pino`, `pino-pretty`, `mumaker` | 9 → 6 pinned: `@whiskeysockets/baileys`, `express` 5, `helmet`, `pino`, `qrcode`, `awesome-phonenumber` |
| `npm audit` | 25 vulnerabilities → **0** | 0 → **0** |

Baileys 6.7.24 installs its `libsignal` dependency from GitHub (pinned to a commit in the lockfile), so `git` must be available at install time.

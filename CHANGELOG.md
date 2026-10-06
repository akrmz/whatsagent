# Changelog

All notable changes. Finding IDs (P-01, B-02, …) refer to [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md).

## 2.13.0 — 2026-10-06

### Fixed (found by checking the code against Baileys 6.7.24's real event format)
- **Captcha could remove real members in LID groups.** The join event and the member's messages can name the same person by LID and by phone number. The answer is now matched against all of a member's known ids.
- **Captcha and the welcome message treated the bot itself as a new member** when it was added to a group. The bot is now skipped.

### Changed
- **`.help` is a short overview** (about 1,200 characters instead of 7,900): each section with its size and most useful commands. `.menu` / `.help all` give the full list as plain text instead of a long image caption; `.menu <section>` still opens one section.
- **Menus show what you can use.** Owner-only commands appear only for the owner, and sudo commands for owner/sudo. Anyone can still ask `.help <command>`.

### Checked
- Performance with every protection and listener switched on (25 listeners, 50 auto-replies, antilink, antibadword, antispam, levels, activity): **0.06 ms per incoming message**, 48 MB heap after 5,000 messages.
- 3 tests (154 in total).

## 2.12.0 — 2026-10-06

### Added
- **`.captcha on|off|time <1-10>`** (group admins): new members who join by link must answer a small sum within N minutes, or they are removed. Arabic digits are accepted, their other messages are deleted until they answer, and 3 wrong answers also remove them. Members added by an admin skip the check. This stops spam bots.
- **`.imsakiya <city>`**: the Ramadan timetable (Imsak, Fajr, Maghrib for each day) of the current or next Ramadan for any city (aladhan.com).
- **`.iftar <city>`**: time left until Maghrib/iftar and Imsak/suhoor. Near iftar during Ramadan it adds the iftar dua from the bundled Hisn al-Muslim.
- **`.autos`**: everything automatic in a chat in one list; `.autos off` stops all automatic Islamic posts there at once.
- Prayer times now include Imsak.
- 4 tests (151 in total).

### Changed
- Arabic durations use correct number forms (ساعة و5 دقائق، ساعتان، دقيقتين).

## 2.11.0 — 2026-10-06

### Added
- **Daily Quran reading (الورد اليومي)**:
  - `.autowird on [pages 1-20] [time]` sends that many mushaf pages every day at that time, in order from page 1 to 604, then starts a new khatma and counts it.
  - `.autowird` shows the position, pages left and estimated days to finish. `.autowird page <n>` moves the position; `.autowird off` stops.
  - `.wird` sends the next portion now; `.wird page <n>` shows any page.
  - Page text is from alquran.cloud. Each surah's basmala is shown on its own line as in the mushaf (it's verse 1 only in al-Fatiha, and At-Tawbah has none). Verse numbers are in Arabic digits ﴿١﴾.
- **Hadith**:
  - `.hadith [id]` gives a random hadith, weighted so every hadith has the same chance, with its grade (درجة), source (رواه) and a short explanation, from موسوعة الأحاديث النبوية (hadeethenc.com, public developer API, credited in each message).
  - `.autohadith every <hours>` posts one every 1–24 hours, the first right away, with the same quiet hours.
- **`.zakat <amount> [currency]`**: nisab by gold (85 g) and silver (595 g) at today's price, and the 2.5 % due.
- **`.gold [currency]`**: price per gram for 24k/21k/18k gold, the ounce, and silver (gold-api.com spot price).
- 5 tests (147 in total).

## 2.10.1 — 2026-10-06

### Fixed
- **Automatic Islamic posts didn't arrive, or came at the wrong hour.** Without `TIMEZONE`, the bot used the server's time zone, which on most VPSs is UTC. Repeating posts were then held as "night" (quiet hours) until 07:00 UTC, and `.autoazkar` used UTC times.
  - When `TIMEZONE` is not set and the server is on UTC, the bot now uses the owner's country, from the first number in `OWNER_NUMBERS` (single-zone countries only, e.g. 20 → Africa/Cairo, 966 → Asia/Riyadh).
  - The chosen zone and why are in the startup log and in `.doctor`.
- `.autotafsir every N` and `.autoazkar dua every N` post the first verse/dua **immediately**, then every N hours. Before, they said "within a minute", but quiet hours could hold the post.

### Changed
- `.autoazkar`, `.autotafsir` and `.autoprayer` replies show the **next message and when it comes** ("⏭️ التالي: أذكار المساء الساعة 17:00 (بعد 8 س 12 د)"). They also show the bot's time zone and current time, with a hint to set `TIMEZONE` when it's only the server's UTC.
- 5 tests (142 in total). The fix was also checked with the real timers on a simulated UTC server.

## 2.10.0 — 2026-10-06

### Added
- **`.autotafsir every <hours>`**: a random verse with al-Tafsir al-Muyassar posted to the chat every 1–24 hours (`.autotafsir on` = every 3 hours; `.autotafsir off`).
- **`.autoazkar dua every <hours>`**: a random dua every 1–24 hours instead of once a day.
- **Quiet hours** for these repeating posts, default 23:00–07:00 in `TIMEZONE`: posts due then wait until morning. `.autotafsir quiet 22:00-06:00` changes them, `.autotafsir quiet off` removes them. If the Quran API fails, the post is retried 10 minutes later.
- `.tafsir` without a reference gives a random verse.
- 5 tests (137 in total).

### Changed
- **No admin needed**: any group member can now turn `.autoazkar`, `.autoprayer` and `.autotafsir` on or off. The owner can restore the admin-only rule with `.setvar ISLAMIC_ADMIN_ONLY true` (or in `.env`).

## 2.9.0 — 2026-10-06

### Added
- **Prayer-time alerts** (`.autoprayer on <city>` / `.adhan`, `.autoprayer off`): "حان الآن موعد أذان …" in the chat at each of the five prayers, in the city's own time zone (aladhan.com). Each is sent once and never more than 20 minutes late. Group admins only in groups.
- `.hijri`: today's Hijri date (Umm al-Qura, offline).
- `.ramadan`: countdown to Ramadan, Eid al-Fitr, Arafah, Eid al-Adha, the Hijri new year and Ashura.
- `.tafsir 2:255`: the verse with al-Tafsir al-Muyassar.
- `.surah <name|number>`: full recitation by Mishary Alafasy. Matches Arabic names typed with or without diacritics, English names and numbers; surahs over `MAX_DOWNLOAD_MB` come as a link.
- `.quran 2:255 audio`: the verse's recitation.
- `.qibla <city>` and `.asma [n|all]` (the 99 names).
- 5 tests (132 in total).

### Fixed
- `.autoazkar city` compared the city's prayer times with the bot's `TIMEZONE`. For a city in another time zone, the adhkar came at the wrong hour. Times now follow the city's own clock, through a shared prayer-time service (`services/prayertimes.js`) that asks aladhan for that city's local date.
- The HTTP client returns `HEAD` responses without trying to read or decompress a body.

### Changed
- `.prayer` alias `adhan` → `mawaqit` (`.adhan` is now the alerts).

## 2.8.0 — 2026-10-06

### Added
- **Adhkar and duas (الأذكار والأدعية)** from Hisn al-Muslim (حصن المسلم), bundled with the bot (`assets/hisnmuslim-ar.json`: 132 chapters, 267 adhkar, from the official hisnmuslim.com API; "حقوق الطبع لكل مسلم"). The Quran passages in the morning/evening adhkar were verified letter by letter against alquran.cloud. `scripts/fetch-hisnmuslim.js` refreshes the file.
  - `.azkar [صباح|مساء|نوم|استيقاظ|صلاة]`: chooses morning or evening by the time of day. It follows the book's notes on morning-only and evening-only entries, and adds a Surat al-Kahf reminder on Friday mornings.
  - `.dua [topic]`: a random supplication from the general dua chapters (supplications only, not the hadiths about virtues), or from chapters matching a topic.
  - `.hisn [number|word]`: browse all 132 chapters.
  - **`.autoazkar`**: sends the morning and evening adhkar to a group or private chat every day, plus an optional daily dua; `.autoazkar off` stops it.
    - Fixed times (default 06:30 / 17:00), or `.autoazkar city Cairo` for 30 minutes after Fajr / Asr (aladhan.com).
    - Group admins control it in groups. Sends at most once per day per message, catches up after downtime (up to 3 h), and never sends late for times already passed when it is turned on.
- New 🕌 Islamic section in `.help`; `.prayer` and `.quran` moved there.
- 5 tests (127 in total).

## 2.7.0 — 2026-10-06

### Added
- **Backup and restore from WhatsApp** (owner, private chat):
  - `.backup` sends a JSON file of every setting and list.
  - `.backup full` adds API keys set from chat and cookies.
  - `.restore` (reply to the file) shows what's inside and applies it after `.restore confirm`, without a restart. File names with path tricks are ignored.
  - The WhatsApp session is never included.
- **Scheduled announcements** to a group: `.announce every day at 08:00 …`, `.announce at 21:00 …`, `.announce list|del` (group admins). Plain text, no mentions, at most 10 per group.
- **Weekdays** for `.remind` and `.announce`: `friday at 20:00`, `every monday at 9am` (a weekday alone means 09:00).
- **`.inactive [days]`** (group admins): members who haven't written for N days, listed by number without pinging anyone. Only the time of each member's last message is stored.
- **`.welcome test` / `.goodbye test`** preview, and a `{count}` variable (member count).
- 6 tests (122 in total).

### Changed
- Welcome/goodbye building moved to `services/greetings.js`, shared by the listener and the preview.

## 2.6.0 — 2026-10-06

### Added
- **Levels**: members earn XP by chatting (15–25 per message, once a minute; commands don't count).
  - `.rank` sends a level card; `.leaderboard` shows the top 10.
  - `.levelup on|off|reset` (group admins) controls level-up announcements, which are off by default.
- **Antilink allow-list**: `.linkallow youtube.com` lets that domain and its subdomains through. Look-alikes such as `youtube.com.evil.example` are still removed.
- **Command rate limit per person**: `COMMANDS_PER_MINUTE`, default 15; owner and sudo exempt. This protects the bot's number from being flagged for spam.
- **Job queue for heavy work**: at most `MAX_PARALLEL_JOBS` (default 2) yt-dlp/ffmpeg processes run at once and up to 25 wait, so a busy group can't overload the server. `.doctor` shows the queue.
- **"Update finished" message**: after `.update now` or `.restart`, the bot reports the version it now runs once it's connected again.
- 9 tests (116 in total).

### Changed
- **Welcome/goodbye pictures are drawn on the server** with sharp instead of a third-party image API. New members' photos and numbers are no longer sent to some-random-api.com, and the card works even when that service is down. Arabic group names render correctly.

## 2.5.0 — 2026-10-06

### Added
- **Auto-replies** per group: `.filter <trigger> | <reply>` (or reply to a message), `.filters`, `.stopfilter`. Whole-word matching in any language. Rate-limited so it can't flood a group or loop with another bot.
- **Daily group open/close**: `.gcschedule close 23:00`, `.gcschedule open 08:00`, `.gcschedule off`. Uses `TIMEZONE`, runs once a day, and catches up after downtime (up to 3 h).
- **Owner group tools**:
  - `.groups` lists every group with member counts and admin status; `.leavegroup <number>` leaves one.
  - `.join <invite link>`.
  - `.block` / `.unblock` (the owner can't be blocked).
- **Animated sticker → video/GIF**: `.tovideo` (plays like a GIF; needs ffmpeg) and `.togif` (GIF file, no ffmpeg). sharp reads the animated WebP that ffmpeg can't.
- **Games**: `.rps` (rock-paper-scissors, also emoji and Arabic) and `.mathquiz [easy|medium|hard|top]` with points per group.
- 8 tests (107 in total).

### Changed
- **`.tts` speaks any language**: Arabic, Russian, Hebrew, Hindi, Chinese, Japanese, Korean, Thai and Greek are detected from the script; other languages take a code and a colon (`.tts fr: Bonjour`). It now sends a real voice note when ffmpeg is available. Aliases `.say`, `.speak`.
- **Unavailable commands explain themselves**: typing a command whose tool or key is missing (or `.help` for it) says it isn't available, instead of "did you mean". The owner also sees what it needs.
- `.transcribe` keeps the audio it sends to Gemini under the 20 MB request limit; videos may be larger, since only their audio is sent.

## 2.4.0 — 2026-10-06

### Added
- **AI pictures**: `.imagine <description>` draws a picture; reply to a photo with `.imagine <change>` to edit it (Gemini). Uses Gemini (`gemini-3.1-flash-image`, Interactions API, `store: false`) or OpenAI (`gpt-image-2.5-flare`).
- **Voice notes to text**: `.transcribe` (reply to a voice note, audio or video) in any language, optionally `translate <language>`. Uses Gemini or OpenAI (`gpt-transcribe`; audio converted to MP3 with ffmpeg, since OpenAI doesn't take Ogg).
  - Both work alongside Claude: keep Claude for chat and add a Gemini key for these.
- **AI memory**: `.ai` remembers your last 6 exchanges per chat for 30 minutes (follow-up questions work), and the group chatbot remembers the group conversation. Memory is kept in RAM only. `.aireset` forgets. `AI_MEMORY_TURNS`.
- **AI daily limit** per person (`AI_DAILY_LIMIT`, default 50; a picture counts 5; owner and sudo exempt), to keep API costs under control.
- **Audio effects** (ffmpeg): `.bass`, `.nightcore`, `.vaporwave`, `.slow`, `.fast`, `.deep`, `.chipmunk`, `.robot`, `.echo`, `.reverse`, `.8d`. Voice notes come back as voice notes.
- **Picture effects** on the server with sharp (nothing uploaded): `.grayscale`, `.invert`, `.sepia`, `.mirror`, `.flipimg`, `.rotate`, `.sharpen`, `.brighten`, `.saturate`, `.pixelate`, `.resize`, `.circlecrop`, `.compress`, `.toformat` (`.topng`/`.tojpg`/`.towebp`), `.imginfo`.
- **Reminders at a time and repeating**: `.remind at 18:30 …`, `.remind tomorrow at 9am …`, `.remind every day at 08:00 …`, `.remind every 2h …`.
- **Per-group command switches**: `.disable <command>`, `.enable <command|all>`, `.disabled` (group admins; owner/sudo unaffected; `.help` can't be disabled).
- **"Did you mean …?"** for mistyped commands (once per chat a minute; `SUGGEST_COMMANDS=false` turns it off).
- `.stats` (owner): most used commands and totals.
- `.crypto [coin] [currency]`: prices and 24 h/7 d change from CoinGecko, in any currency (information only).
- **yt-dlp auto-update** once a day (`YTDLP_AUTO_UPDATE=true`); `.doctor` shows the last result. Only yt-dlp is updated automatically, never the bot's code.
- 11 tests (99 in total). The ffmpeg features (audio effects, `.toaudio`, `.tovn`, video stickers) were also run against a real ffmpeg 8.1.

### Changed
- **`.sticker` and `.crop` work without ffmpeg** for pictures (made with sharp); ffmpeg is only needed for GIFs and videos. `.emojimix` no longer needs ffmpeg. Optional pack and author: `.sticker My Pack | Me`.
- **`.news` needs no API key**: Google News for any country and language (`.news`, `.news football`, `.news eg:ar`, `NEWS_REGION`). `NEWSAPI_KEY` is ignored.
- The group chatbot reports a reached daily limit instead of staying silent.

## 2.3.0 — 2026-10-06

### Added
- **Change settings from WhatsApp** (owner): `.vars` lists them with current values (keys hidden) and their source, `.setvar NAME value` changes one, `.delvar NAME` goes back to `.env`, and `.restart` restarts. Changes are validated first (invalid values are not saved), applied **without a restart** (config, AI client and command list are rebuilt; newly enabled/disabled commands are listed), and kept in `DATA_DIR/env-overrides.json`, which overrides `.env` and works under Docker too. Tool paths (`YTDLP_PATH`, `FFMPEG_PATH`) are test-run before saving.
  - About 30 settings are allowed: AI, bot name/prefix/stickers/time zone, API keys, limits, tool paths, log level. Owner numbers, folders, pairing, the update source and the health server deliberately stay in `.env`.
  - Secrets are refused in groups and never displayed. The message carrying them is deleted when WhatsApp allows it (sent from the bot's own account), and antidelete never keeps a copy.
- **Gemini and OpenAI-compatible AI**, besides Claude: `AI_PROVIDER` (`auto`/`claude`/`gemini`/`openai`), `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` (Groq, OpenRouter, DeepSeek, Mistral … any https endpoint), and per-provider models (`CLAUDE_MODEL`, `GEMINI_MODEL`, `OPENAI_MODEL`; defaults `claude-opus-5-5`, `gemini-3.8-flash`, `gpt-6-luna`). Images work with all three.
  - `.setai <provider> <key>` tests a key with a free request before saving it.
  - `.aimodel` lists the models your key can use and switches by number or name.
- **Login cookies per site from WhatsApp**: `.setcookie <site>` (attach or reply to cookies.txt, a Cookie-Editor JSON export, or paste `name=value; …`), `.cookies`, `.delcookie`. These cover YouTube, Instagram, Facebook, TikTok, X, Reddit, SoundCloud, Pinterest, Vimeo, Dailymotion, Twitch, Threads and Snapchat.
  - Only cookies for that site's own domains are kept. The files are stored with mode 600 and used by yt-dlp for that site's links.
  - The bot reports whether a logged-in session was found and when it expires. Owner only, private chat only.
- `.summarize` / `.tldr`: summarize (or ask a question about) a replied message, a web page, or a YouTube video via its captions.
- Notes: `.save <name> <text>`, `#name`, `.notes`, `.delnote` (admins in groups).
- `.antispam`: flood protection (more than N messages in S seconds → delete, warn or kick).
- Tools:
  - `.unit` converts length, weight, volume, area (incl. feddan/qirat), speed, temperature, data, time and energy.
  - `.age`, `.password`, `.hash`, `.base64`.
  - `.short` shortens links via TinyURL.
- Fun: `.roll 2d6`, `.flip`, `.pick a, b, c`, `.random 1 100`.
- 16 tests (settings, AI provider selection, cookies, notes, anti-spam, units …); 87 in total.

### Changed
- `.doctor` shows the AI in use, cookie sites and chat-changed settings. Its "how to enable" hints now use `.setvar` / `.setai`.
- The dispatcher reads the configuration per message, so a new prefix or cooldown applies at once.
- Re-checking tools after a settings change happens only when a tool path changed.
- Log redaction also covers the new keys, auth headers and cookies.

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

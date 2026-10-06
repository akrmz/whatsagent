# Usage

How to use the bot from WhatsApp, and every configuration option.

- The command prefix is `.` by default (change it with `PREFIX` in `.env`). Every example below uses `.`.
- Send `.help` for a short overview: every section with its most useful commands. `.menu` (or `.help all`) lists every command you can use; owner-only commands are shown only to the owner. Send `.help` to see the commands available on *your* bot. Commands whose API key or tool is missing are hidden automatically. Send `.help <command>` for details, e.g. `.help sticker`, or `.help <section>` for one section with descriptions, e.g. `.help tools`, `.help info`, `.help downloads`. A mistyped name gets a "Did you mean …?" suggestion.
- The owner can send `.doctor` to see which tools were found (with their paths and versions), which commands are disabled, and exactly what to install or set to enable them.
- In the tables, "group admins" means admins of the current group. The bot owner and sudo users also count as admins everywhere.
- "Needs" lists what must be configured or installed for the command to exist:

| Needs | What to do |
|---|---|
| `ffmpeg` | Install ffmpeg (included in the Docker image) |
| `ytdlp` | Install yt-dlp (included in the Docker image) |
| `font` | Install a bold TTF font, e.g. `fonts-dejavu-core` (included in the Docker image), or set `FONT_FILE` |
| `ai` | An API key for Claude, Gemini or an OpenAI-compatible service: send `.setai gemini <key>` in a private chat (see [Setting up the AI](#setting-up-the-ai)) |
| `newsApi` / `tenor` / `telegramBot` / `removeBg` / `remini` / `githubRepo` | Set `NEWSAPI_KEY` / `TENOR_KEY` / `TELEGRAM_BOT_TOKEN` / `REMOVEBG_API_KEY` / `REMINI_API_KEY` / `GITHUB_REPO` |

The 🛠️ Tools and 📚 Info & search commands (`.calc`, `.qr`, `.remind`, `.poll`, `.weather`, `.wiki`, `.prayer` …) need no API keys.

## Who can do what

| Level | Who | Can use |
|---|---|---|
| Owner | Numbers in `OWNER_NUMBERS` (and `OWNER_LIDS`), plus messages you send from the bot's own WhatsApp account | Everything |
| Sudo | People the owner added with `.sudo add` | Everything group admins can, in every group; `.ban`, `.unban`, `.settings`, `.cleartmp`. Not: owner settings, `.update`, `.sudo`, `.mode`, `.setpp`, `.clearsession`, `.vv` |
| Group admin | Admins of the group the command is sent in | Group-admin commands in that group |
| Everyone | Anyone else | Everything else, unless the bot is in private mode (`.mode private`), in which case only owner and sudo can use commands |

Banned users (`.ban`) are ignored completely. Owners can never be banned.

A short cooldown (default 3 seconds, `DEFAULT_COOLDOWN_SECONDS`) applies per person and command, and one person can run at most 15 commands a minute in total (`COMMANDS_PER_MINUTE`), so nobody can make the bot spam. Some heavy commands have longer cooldowns. Owner and sudo are exempt.

## Replying to messages

Many commands work on "the message you reply to":
1. Long-press (or swipe right on) the message in WhatsApp and choose **Reply**.
2. Type the command, e.g. `.sticker`, and send.

Media commands also accept the media *with the command as its caption*: attach a picture, type `.sticker` as the caption, and send.

## Group protection settings

In a group where the bot is an admin, group admins can enable:

| Command | Effect | Actions |
|---|---|---|
| `.antilink on` | Deletes messages that contain links | `delete` (default), `kick`, `warn` |
| `.antibadword on` | Deletes messages that contain bad words | `delete`, `kick`, `warn` |
| `.antitag on` | Deletes messages that mention more than half the group | `delete`, `kick` |
| `.disable <command> …` | Turns commands off in this group for everyone except owner and sudo (e.g. `.disable sticker song`). `.enable <command>` or `.enable all` turns them back on; `.disabled` lists them. `.help` can't be disabled | – |
| `.gcschedule close 23:00` / `.gcschedule open 08:00` | Closes the group (only admins can write) and opens it again every day at those times (`TIMEZONE`). `.gcschedule` shows it, `.gcschedule off` removes it | – |
| `.linkallow youtube.com` | Lets links to that domain (and its subdomains) through antilink in this group. `.linkallow` lists them, `.linkallow remove youtube.com` removes one | – |
| `.captcha on` | New members who join by link must send the answer to a small sum (Arabic or Latin digits) within 3 minutes (`.captcha time 5`), or the bot removes them; their other messages are deleted until then, and 3 wrong answers also remove them. Members added by an admin skip it. Stops spam bots. | – |
| `.antispam on` | Deletes messages from a member who sends more than 6 messages in 10 seconds (change with `.antispam set 8 15`) | `delete` (default), `warn`, `kick` (`.antispam action warn`) |

Change the action with e.g. `.antilink set warn`, and check it with `.antilink get`. With `warn`, a member is removed after `WARN_LIMIT` warnings (default 3). Admins, sudo users and owners are never affected.

Welcome and goodbye messages: `.welcome on`, then optionally `.welcome set Hi {user}, welcome to {group}! Please read: {description}`. Goodbye works the same with `{user}`, `{group}` and `{count}` (members). `.welcome test` shows a preview. The picture card is drawn by the bot itself; nothing is sent to other services.

Scheduled announcements: `.announce every day at 08:00 Good morning`, `.announce every friday at 20:00 Meeting in 1 hour`, `.announce at 21:00 Live now!`. They are sent as plain text without mentioning anyone. `.announce list`, `.announce del <id>`. Group admins only, at most 10 per group.

`.inactive 30` lists members who haven't written for 30 days (by number, without pinging them). Counting starts when the bot first sees the group.

## Changing settings from WhatsApp

The owner can change most settings from a chat with the bot, without editing `.env` or restarting:

| Command | What it does |
|---|---|
| `.vars` | Lists every setting you can change, its current value (keys are hidden as •••••) and whether it was set from chat (✏️). `.vars ai`, `.vars keys`, `.vars limits` show one group; `.vars GEMINI_MODEL` explains one setting. |
| `.setvar NAME value` | Changes a setting. It is checked first (an invalid value is not saved), applied at once, and kept across restarts. Commands that become available or disabled are listed. |
| `.delvar NAME` | Removes the chat value, so the one in `.env` (or the default) is used again. |
| `.restart` | Restarts the bot (only `MARK_ONLINE` and `LOG_LEVEL` need it). Works under PM2 or Docker. |

Examples: `.setvar BOT_NAME Akram Bot`, `.setvar PREFIX !`, `.setvar MAX_VIDEO_SECONDS 900`, `.setvar TIMEZONE Africa/Cairo`, `.setvar YTDLP_PATH ~/.local/bin/yt-dlp` (the program is started once to check it before saving), `.setvar NEWSAPI_KEY <key>`.

- Values are saved in `DATA_DIR/env-overrides.json` (readable only by the bot's user) and override `.env`. Back it up with the rest of `data/`.
- **Keys and tokens only in a private chat with the bot.** In a group they are refused. If you send them from the bot's own WhatsApp account, the bot deletes the message for you; otherwise delete it yourself after the bot confirms.
- Some settings can only be changed in `.env` on the server, on purpose: `OWNER_NUMBERS`, `OWNER_LIDS`, `PAIRING_NUMBER`, the folders, `UPDATE_REMOTE`/`UPDATE_BRANCH` and the health server. Changing them from a chat could lock you out, or let someone who takes over your WhatsApp point `.update` at their own code.

## Adhkar and duas (الأذكار والأدعية)

The text comes from **Hisn al-Muslim** (حصن المسلم, Sa'id ibn Ali ibn Wahf al-Qahtani), bundled with the bot (`assets/hisnmuslim-ar.json`, from hisnmuslim.com), so it works without internet. The Quran passages in the morning/evening adhkar were checked letter by letter against alquran.cloud.

| Command | What it does |
|---|---|
| `.azkar` | Morning adhkar before noon, evening adhkar after (bot's `TIMEZONE`). `.azkar صباح`, `.azkar مساء`, `.azkar نوم`, `.azkar استيقاظ`, `.azkar صلاة` (also in English: morning, evening, sleep, waking, prayer). The book's notes are kept ("if it is evening, say …"); entries the book marks for the morning only or the evening only appear only there. On Fridays the morning set ends with a reminder about Surat al-Kahf. |
| `.dua` | A random supplication from the general dua chapters (after the tashahhud, worry and grief, distress, debt, difficulty, qunut, …). `.dua الكرب`, `.dua السفر`, `.dua المريض` pick from chapters with that word in the title. |
| `.hisn` | All 132 chapters; `.hisn 35` shows one; `.hisn السفر` searches titles. |
| `.autoazkar on` | Sends the morning and evening adhkar to this chat every day (default 06:30 and 17:00). Any group member can turn it on or off (owner: `.setvar ISLAMIC_ADMIN_ONLY true` limits that to group admins). |
| `.autoazkar city Cairo` | Follows the prayer times of a city instead: morning adhkar 30 minutes after Fajr, evening adhkar 30 minutes after Asr (`.autoazkar city off` goes back to fixed times). |
| `.autoazkar morning 06:00` / `evening 16:30` | Changes the fixed times. |
| `.autoazkar dua 21:00` | Also sends a random dua every day at that time. |
| `.autoazkar dua every 3` | A random dua every 3 hours instead (1–24), outside quiet hours. `.autoazkar dua off` stops either. |
| `.autotafsir every 3` (or `.autotafsir on`) | Posts a random verse with al-Tafsir al-Muyassar every 3 hours (1–24). `.autotafsir off` stops it. |
| `.autotafsir quiet 23:00-07:00` | No automatic verses or duas during these hours (`TIMEZONE`); posts due then wait until the quiet hours end. This is the default; `.autotafsir quiet off` allows posts at any time. |
| `.autoazkar off` | Stops everything for this chat. `.autoazkar` alone shows the current setup. |

If the bot was offline at the time, it sends the message when it comes back (up to 3 hours late), once per day. Turning it on at noon does not send that morning's adhkar late. With `.autoazkar city`, the times follow that city's own clock, even if the bot's `TIMEZONE` is different.

More in the same 🕌 section of `.help`:

| Command | What it does |
|---|---|
| `.autoprayer on Cairo` (`.adhan`) | Announces each of the five prayers in this chat ("حان الآن موعد أذان العصر"), using the city's prayer times (aladhan.com picks the method used in that region) and its time zone. An alert more than 20 minutes late (bot offline) is skipped. `.autoprayer off` stops it. Any member can set it (unless `ISLAMIC_ADMIN_ONLY` is on). |
| `.prayer <city>` | Today's prayer times and which prayer is next. |
| `.hijri` | Today's Hijri date (Umm al-Qura, works offline). |
| `.ramadan` | Days left until Ramadan, the Eids, Arafah, Ashura and the Hijri new year. Moon sighting can shift these by a day. |
| `.quran 2:255` / `.quran 2:255 audio` | A verse with English translation; `audio` adds Mishary Alafasy's recitation. |
| `.tafsir 2:255` / `.tafsir` | The verse (or a random one) with al-Tafsir al-Muyassar (Arabic). |
| `.surah الكهف` / `.surah 18` / `.surah yaseen` | The full surah recited by Mishary Alafasy. Surahs longer than `MAX_DOWNLOAD_MB` (e.g. Al-Baqarah) come as a link instead. |
| `.qibla <city>` | The Qibla direction in degrees from north. |
| `.asma` / `.asma 1` / `.asma all` | The names of Allah (al-Asma' al-Husna). |
| `.autowird on 2 20:00` | **Daily Quran reading (الورد اليومي)**: 2 mushaf pages (1–20) every day at 20:00, in order from page 1 to 604, then a new khatma. Shows progress, days left and completed khatmas. `.autowird` shows the position, `.autowird page 100` moves it, `.autowird off` stops. `.wird` sends the next portion now; `.wird page 50` shows any page. Each surah's basmala is on its own line as in the mushaf. |
| `.khatma new` | **Group khatma (ختمة جماعية)**: a shared khatma of the 30 juz'. `.khatma take` takes the first free juz (or `.khatma take 5` a chosen one) and shows where it starts and its pages; `.khatma done` marks it read; `.khatma drop 5` gives it back. `.khatma` shows the board: progress, who reads which juz, and the free ones. When all 30 are read the bot announces it, and `.khatma new` starts the next one (numbered). Each member can hold up to 3 unread juz'. Anyone can take and finish a juz; starting or ending a khatma, and marking someone else's juz, follow `ISLAMIC_ADMIN_ONLY` like `.autoazkar`. `.khatma info 5` shows a juz without taking it. |
| `.autojumuah on 09:00` | **Friday reminder**: every Friday at that time (default 09:00), the verse of al-Jumu'ah (62:9), the sunnahs of the day (Surat al-Kahf, salawat on the Prophet ﷺ, ghusl and going early, dua), a hadith on salawat and the Ibrahimi salawat from Hisn al-Muslim. Sent up to 3 hours late if the bot was offline. `.autojumuah now` shows the message, `.autojumuah off` stops it. |
| `.hadith` / `.hadith 2962` | A random hadith (or one by number) with its grade, source and a short explanation, from موسوعة الأحاديث النبوية (hadeethenc.com). |
| `.autohadith every 6` | A random hadith every 6 hours (1–24), the first one right away; quiet hours as for `.autotafsir`. `.autohadith off` stops. |
| `.imsakiya Cairo` | The Ramadan timetable for a city: Imsak, Fajr and Maghrib for every day of the current or next Ramadan (aladhan.com, the method used in that region). |
| `.iftar Cairo` | Time left until Maghrib (iftar) and Imsak (suhoor); near iftar in Ramadan it adds the iftar dua from Hisn al-Muslim. |
| `.autos` | Everything automatic in this chat in one list (adhkar, prayer alerts, tafsir/dua/hadith, wird, announcements, group schedule, captcha). `.autos off` stops all the automatic Islamic posts here at once. When the bot leaves or is removed from a group, everything automatic there stops by itself (including announcements, the group schedule and captcha). |
| `.zakat 300000 egp` | Zakat on money: today's nisab by gold (85 g) and silver (595 g) and the 2.5 % due. Global spot prices; for special cases, ask a scholar. |
| `.gold` / `.gold egp` | (🛠️ Tools) Gold price per gram (24k, 21k, 18k) and silver in any currency. Global spot price, without local margins. |

## Backup and restore

In a private chat with the bot, `.backup` sends you a file with all settings and lists: mode, sudo users, bans, warnings, group settings, auto-replies, notes, reminders, levels and statistics. To restore it (for example on a new server), reply to that file with `.restore`. The bot shows what's inside; reply again with `.restore confirm` to apply it. It takes effect immediately.

- `.backup full` also includes API keys set from chat and saved cookies. Keep that file private.
- The WhatsApp session is never in a backup. Move the `session` folder separately, or pair again.

## Setting up the AI

`.ai`, `.summarize` and the group chatbot can use **Claude** (Anthropic), **Gemini** (Google) or any **OpenAI-compatible** service (OpenAI, Groq, OpenRouter, DeepSeek, Mistral …). In a private chat with the bot:

| Command | What it does |
|---|---|
| `.setai` | Shows which AI and model are in use and which keys are set. |
| `.setai gemini <key>` | Saves a Gemini key and switches to Gemini. The key is tested with a free request first; a wrong key is not saved. Same for `claude` and `openai`. Get a key: Gemini at aistudio.google.com/apikey (free tier), Claude at console.anthropic.com, OpenAI at platform.openai.com/api-keys. |
| `.setai openai <key> https://api.groq.com/openai/v1` | Uses an OpenAI-compatible service (the URL must be https). |
| `.setai claude` | Switches between providers whose keys are already saved. `.setai auto` uses the first one that has a key (Claude, then Gemini, then OpenAI). |
| `.aimodel` | Lists the models your key can use (numbered). `.aimodel flash` filters the list; `.aimodel 3` or `.aimodel gemini-3.5-flash-lite` switches. Each provider remembers its own model. |

**Pictures and voice notes.** `.imagine <description>` draws a picture, and replying to a photo with `.imagine make it a cartoon` edits it (editing needs Gemini). `.transcribe` (reply to a voice note) writes out what is said in any language; `.transcribe translate english` also translates. These use **Gemini or OpenAI** (whichever has a key; Claude can't do them). You can keep Claude for chat and add a Gemini key just for these: `.setvar GEMINI_API_KEY <key>`.

**Memory and limits.** `.ai` remembers your last 6 questions in that chat for 30 minutes, so follow-ups work ("make it shorter"); `.aireset` starts over. The group chatbot remembers the conversation per group. This memory is kept only in RAM, never on disk. Each person can make 50 AI requests a day (a picture counts as 5; owner and sudo are unlimited). Change it with `.setvar AI_DAILY_LIMIT 100`, or `0` for no limit, and change the memory with `.setvar AI_MEMORY_TURNS 10`.

**What did I miss?** In a group, `.recap` summarizes the last 100 messages (`.recap 50`, up to 200): the topics, who said what, decisions and open questions. The bot keeps the recent text of group chats in memory only (never on disk, cleared on restart, commands not kept), and sends it to the AI only when someone uses `.recap`. It counts as 2 AI requests.

Default models: `claude-opus-5-5`, `gemini-3.8-flash`, `gpt-6-luna`. With other OpenAI-compatible services, pick a model with `.aimodel`. `AI_MAX_TOKENS` (`.setvar AI_MAX_TOKENS 2048`) limits answer length; `AI_EFFORT` applies to Claude only.

## Cookies for downloads (YouTube, Instagram …)

Some videos only download when logged in: age-restricted or members-only YouTube videos, YouTube's "Sign in to confirm you're not a bot", private Instagram, Facebook or X posts. Give the bot your login cookies for that site:

1. On a computer, install the browser extension **Get cookies.txt LOCALLY** (or **Cookie-Editor**). Use a spare account if you can: sites may block accounts used for automated downloads.
2. Log in to the site. For **YouTube**, open a private/incognito window, log in, open youtube.com, export, then close the window. Cookies from a normal window get replaced by YouTube within hours.
3. Export the cookies as **cookies.txt** (Netscape format), or as JSON / "Header String" in Cookie-Editor.
4. In a **private chat** with the bot, send the file with the caption `.setcookie youtube` (or reply to the file with it). You can also paste the text: `.setcookie instagram sessionid=…; csrftoken=…`.

| Command | What it does |
|---|---|
| `.setcookie <site>` | Saves cookies for one site: `youtube`, `instagram`, `facebook`, `tiktok`, `twitter` (x), `reddit`, `soundcloud`, `pinterest`, `vimeo`, `dailymotion`, `twitch`, `threads`, `snapchat`. Only cookies for that site's own domains are kept (a full browser export does not store your bank or email cookies). Tells you whether a logged-in session was found and when it expires. |
| `.cookies` | Lists the sites with cookies, whether they contain a login, and the expiry date. Values are never shown. |
| `.delcookie <site>` / `.delcookie all` | Deletes them. |

Cookies are stored in `DATA_DIR/cookies/<site>.txt` (mode 600). yt-dlp uses a site's own file for links from that site, and `YTDLP_COOKIES` (from `.env`) for all other sites. yt-dlp refreshes the file as it uses it, which keeps the login alive. **Cookies are as good as your password**: anyone with them is logged in as you. Remove them with `.delcookie` when you no longer need them.

## All commands

This list is generated from the command files themselves.

### General

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.alive` | – | Shows that the bot is running, its version and current mode. | everyone | `.alive` |
| `.fact` | – | Sends a random useless fact. | everyone | `.fact` |
| `.github` | `.git` `.sc` `.script` `.repo` | Shows the bot's source repository (set GITHUB_REPO in .env). _Needs: githubRepo._ | everyone | `.github` |
| `.groupinfo` | `.infogp` `.infogrupo` | Shows the group's name, ID, member count, owner, admins and description. | everyone (groups) | `.groupinfo` |
| `.help` | `.menu` `.bot` `.list` | A short overview of the sections; .help <section> lists one section, .help <command> explains a command, and .menu (or .help all) lists every command you can use. | everyone | `.help` |
| `.jid` | – | Shows this group's ID (JID). | everyone (groups) | `.jid` |
| `.joke` | – | Sends a random dad joke. | everyone | `.joke` |
| `.lyrics` | – | Finds the lyrics of a song. | everyone | `.lyrics adele hello` |
| `.owner` | – | Sends the bot owner's contact card. | everyone | `.owner` |
| `.ping` | – | Checks that the bot is online and shows response time, uptime and version. | everyone | `.ping` |
| `.quote` | – | Sends a random quote. | everyone | `.quote` |
| `.ss` | `.ssweb` `.screenshot` | Takes a screenshot of a public website. | everyone | `.ss https://example.com` |
| `.staff` | `.admins` `.listadmin` | Lists the group admins. | everyone (groups) | `.staff` |
| `.tourl` | `.url` | Uploads the media you send or reply to and returns a PUBLIC link (anyone with the link can see it). | everyone | `.tourl` _(send or reply to media)_ |
| `.translate` | `.trt` | Translates text, or the message you reply to, into another language. | everyone | `.translate hello fr` |
| `.tts` | `.say` `.speak` | Turns text into a voice note. Arabic and other scripts are detected automatically; for other languages start with a code and a colon (fr:, es:, de:, tr: …). | everyone | `.tts Good morning everyone` |
| `.whoami` | – | Shows the IDs WhatsApp uses for you and your permission level. Useful when setting OWNER_LIDS. | everyone | `.whoami` |

### Tools

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.afk` | `.away` | Marks you as away. When someone mentions or replies to you, the bot tells them; your next message clears it. | everyone | `.afk sleeping` |
| `.age` | `.birthday` `.datediff` | Calculates an age (or time since a date) and the days to the next birthday. | everyone | `.age 2000-05-14` |
| `.autos` | `.automations` `.scheduled` `.auto` | كل ما يعمل تلقائياً في هذه المحادثة في قائمة واحدة، و".autos off" لإيقاف الرسائل الإسلامية التلقائية كلها — lists everything automatic in this chat; ".autos off" stops all automatic Islamic posts here. | everyone | `.autos` |
| `.base64` | `.b64` | Encodes text to Base64 or decodes it back. | everyone | `.base64 encode hello` |
| `.calc` | `.calculate` `.math` | Calculates a maths expression: + - * / % ^ !, brackets, sqrt, sin/cos/tan (degrees), log, ln, abs, round, min, max, pi, e. | everyone | `.calc (12+8)*3/4` |
| `.currency` | `.convert` `.cur` `.exchange` | Converts money between currencies with today's exchange rate. | everyone | `.currency 100 usd egp` |
| `.delnote` | `.rmnote` `.clearnote` | Deletes a saved note. In groups, only admins can. | everyone | `.delnote` |
| `.getpp` | `.pp` `.avatar` `.pfp` | Sends the profile picture of the person you mention or reply to (or yours). Add "group" for the group photo. | everyone | `.getpp @someone` |
| `.gold` | `.dahab` `.silver` | سعر الذهب للجرام (عيار 24 و21 و18) والفضة بأي عملة — gold price per gram (24k/21k/18k) and silver, in any currency. | everyone | `.gold` |
| `.hash` | – | Shows the MD5, SHA-1, SHA-256 and SHA-512 hashes of a text (or the replied message). | everyone | `.hash hello` |
| `.note` | `.getnote` | Shows a saved note (same as sending #name). | everyone | `.note rules` |
| `.notes` | `.listnotes` | Lists the notes saved in this chat. | everyone | `.notes` |
| `.password` | `.pass` `.genpass` | Generates a strong random password (cryptographically secure). Best used in a private chat. | everyone | `.password` |
| `.poll` | `.vote` | Creates a native WhatsApp poll. Separate the question and 2–12 options with \|. Add "multi" first to allow several answers. | everyone | `.poll Pizza or burgers? \| Pizza \| Burgers` |
| `.qr` | `.qrcode` `.toqr` | Makes a QR code image from text or a link. You can also reply to a message to encode it. | everyone | `.qr https://example.com` |
| `.readqr` | `.scanqr` `.qrread` | Reads the QR code in an image or sticker you send or reply to. | everyone | `.readqr` _(reply to an image)_ |
| `.remind` | `.reminder` `.remindme` | Reminds you in this chat: after a delay (10m, 2h, 3d), at a time (at 18:30, tomorrow at 9am), or repeating (every day at 08:00, every 2h). Times use the bot's TIMEZONE. Survives restarts. | everyone | `.remind 10m check the oven` |
| `.save` | `.savenote` `.addnote` | Saves a note in this chat (rules, links, FAQ …). Anyone can then send #name to see it. In groups, only admins can save. | everyone | `.save rules Be kind. No spam.` |
| `.short` | `.shorturl` `.tinyurl` `.shorten` | Shortens a long link with TinyURL. | everyone | `.short https://example.com/a/very/long/link` |
| `.toaudio` | `.tomp3` `.mp3convert` | Extracts the sound of a video (or converts a voice note/audio file) to an MP3 you can play or save. _Needs: ffmpeg._ | everyone | `.toaudio` _(reply to a video or audio)_ |
| `.tovn` | `.toptt` `.tovoice` | Turns a video, song or audio file into a WhatsApp voice note. _Needs: ffmpeg._ | everyone | `.tovn` _(reply to a video or audio)_ |
| `.unit` | `.units` `.conv` | Converts units: length, weight, volume, area (incl. feddan), speed, temperature, data, time, energy. | everyone | `.unit 10 km to mi` |

### Info & search

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.crypto` | `.price` `.btc` | Shows cryptocurrency prices and 24 h change (CoinGecko). Without a coin, the top 10. Information only — not financial advice. | everyone | `.crypto` |
| `.define` | `.dict` `.dictionary` `.meaning` | Looks up an English word: pronunciation, meanings, examples and synonyms. | everyone | `.define serendipity` |
| `.news` | `.headlines` | Latest headlines (Google News, no key needed), or news about a topic. Start with a country:language code for another region. | everyone | `.news` |
| `.time` | `.clock` `.date` | Shows the current date and time in a city (or the bot's time zone). | everyone | `.time Tokyo` |
| `.weather` | `.forecast` | Shows the current weather and a 3-day forecast for a city (no API key needed). | everyone | `.weather Cairo` |
| `.wiki` | `.wikipedia` | Shows the Wikipedia summary of a topic. Start with a language code for other Wikipedias (ar:, fr:, es: …). | everyone | `.wiki Great Pyramid of Giza` |

### Islamic · إسلاميات

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.asma` | `.asmaulhusna` `.names99` `.asmaallah` | من أسماء الله الحسنى — a name of Allah from al-Asma' al-Husna (random, by number 1-99, or "all"). | everyone | `.asma` |
| `.autoazkar` | `.dailyazkar` `.azkarauto` | يرسل أذكار الصباح والمساء تلقائياً كل يوم في هذه المحادثة، ودعاءً يومياً إن شئت — sends the morning and evening adhkar here every day, and a random dua once a day or every few hours. Set a city to follow prayer times. Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on). | everyone | `.autoazkar on` |
| `.autohadith` | `.dailyhadith` | يرسل حديثاً عشوائياً مع شرحه كل عدد من الساعات (1–24) في هذه المحادثة، أولها فوراً — posts a random hadith here every N hours, the first right away. Quiet hours as for .autotafsir. | everyone | `.autohadith every 6` |
| `.autojumuah` | `.jumuah` `.friday` `.autofriday` | تذكير يوم الجمعة: آية الجمعة، وسورة الكهف، والصلاة على النبي ﷺ، وساعة الإجابة، كل جمعة في الوقت الذي تختاره — a Friday reminder every week at the time you choose (default 09:00). Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on). | everyone | `.autojumuah on` |
| `.autoprayer` | `.adhan` `.azan` `.prayeralert` | تنبيه بموعد كل صلاة من الصلوات الخمس في هذه المحادثة حسب مدينتك — announces each of the five prayers here, by your city's prayer times and time zone. Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on). | everyone | `.autoprayer on Cairo` |
| `.autotafsir` | `.dailyayah` `.autoayah` `.ayahtafsir` | يرسل آية عشوائية مع تفسيرها (التفسير الميسر) كل عدد من الساعات في هذه المحادثة — posts a random verse with al-Tafsir al-Muyassar here every N hours (1–24); the first one right away. No automatic posts during quiet hours (default 23:00–07:00). Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on). | everyone | `.autotafsir on` |
| `.autowird` | `.dailywird` | الورد اليومي: يرسل كل يوم عدداً من صفحات المصحف بالترتيب حتى الختم ثم يبدأ ختمة جديدة — sends N mushaf pages a day in order until the Quran is completed, then starts again. Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on). | everyone | `.autowird on 2 20:00` |
| `.azkar` | `.adhkar` `.athkar` `.zikr` `.dhikr` | أذكار الصباح والمساء وغيرها من حصن المسلم — morning/evening adhkar and more from Hisn al-Muslim. Without a word: morning before noon, evening after. | everyone | `.azkar` |
| `.dua` | `.doaa` `.duaa` `.doa` `.dua2` | دعاء عشوائي من حصن المسلم، أو في موضوع معيّن — a random dua from Hisn al-Muslim, or on a topic (الكرب، الهم، الدين، الاستغفار …). | everyone | `.dua` |
| `.hadith` | `.hadeeth` `.hadis` | حديث نبوي عشوائي مع درجته ومصدره وشرح مختصر، من موسوعة الأحاديث النبوية — a random hadith with its grade, source and a short explanation (hadeethenc.com). | everyone | `.hadith` |
| `.hijri` | `.hijridate` `.islamicdate` | التاريخ الهجري اليوم (تقويم أم القرى) — today's Hijri date (Umm al-Qura). | everyone | `.hijri` |
| `.hisn` | `.hisnmuslim` `.husn` | حصن المسلم: كل الأبواب (132)، أو باب برقمه أو بكلمة من عنوانه — browse all 132 chapters of Hisn al-Muslim by number or by a word. | everyone | `.hisn` |
| `.iftar` | `.suhoor` `.sohour` `.maghrib` | كم بقي على المغرب (الإفطار) وعلى الإمساك (السحور) في مدينتك — time left until Maghrib (iftar) and Imsak (suhoor) in a city. | everyone | `.iftar Cairo` |
| `.imsakiya` | `.imsakia` `.ramadantable` `.emsakeya` | إمساكية رمضان لمدينتك: الإمساك والفجر والمغرب لكل يوم من الشهر — the Ramadan timetable (Imsak, Fajr, Maghrib) for a city, for the current or next Ramadan. | everyone | `.imsakiya Cairo` |
| `.khatma` | `.khatmah` `.groupkhatma` | ختمة جماعية: يحجز كل عضو جزءاً من الثلاثين ويقرؤه ثم يعلن انتهاءه حتى تكتمل الختمة — a shared group khatma: members take one of the 30 juz', read it and mark it done. Starting or ending one follows the same rule as .autoazkar (anyone, unless ISLAMIC_ADMIN_ONLY is on). | everyone (groups) | `.khatma new` |
| `.prayer` | `.salah` `.salat` `.mawaqit` | Shows today's prayer times for a city and which prayer is next. | everyone | `.prayer Cairo` |
| `.qibla` | `.kibla` | اتجاه القبلة من مدينة — the Qibla direction from a city (degrees from north). | everyone | `.qibla Cairo` |
| `.quran` | `.ayah` `.ayat` | Shows a Quran verse in Arabic with an English translation; add "audio" for the recitation (Alafasy). Without a reference, a random verse. | everyone | `.quran 2:255` |
| `.ramadan` | `.occasions` `.eid` `.mawasim` | كم بقي على رمضان والعيدين ويوم عرفة وعاشوراء ورأس السنة الهجرية — countdown to Ramadan, the Eids and other Islamic occasions. | everyone | `.ramadan` |
| `.surah` | `.sura` `.tilawa` | تلاوة سورة كاملة بصوت الشيخ مشاري العفاسي، بالاسم أو الرقم — a full surah recited by Mishary Alafasy (by name or number). Long surahs come as a link. | everyone | `.surah الكهف` |
| `.tafsir` | `.tafseer` `.muyassar` | الآية مع تفسيرها من التفسير الميسر، أو آية عشوائية — a verse with its explanation from al-Tafsir al-Muyassar (random without a reference). For automatic posts see .autotafsir. | everyone | `.tafsir 2:255` |
| `.wird` | `.werd` | يرسل الورد التالي الآن (ويتقدّم الموضع)، أو صفحة محددة من المصحف — sends the next portion of this chat's daily wird now, or any mushaf page. | everyone | `.wird` |
| `.zakat` | `.zakah` | حاسبة زكاة المال: النصاب (85 جم ذهب / 595 جم فضة) بسعر اليوم ومقدار الزكاة 2.5% — zakat calculator for money held a full lunar year. | everyone | `.zakat 300000 egp` |

### Group admin

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.announce` | `.schedulemsg` `.announcement` | Schedules a message to this group — once or repeating — sent as plain text without mentioning anyone. Times use the bot's TIMEZONE. | group admins (groups) | `.announce every day at 08:00 Good morning everyone ☀️` |
| `.antibadword` | – | Deletes messages from non-admins that contain bad words. Action: delete, kick or warn. The bot must be a group admin. | group admins (groups) | `.antibadword on` |
| `.antilink` | – | Deletes links posted by non-admins. Action: delete, kick or warn. The bot must be a group admin. | group admins (groups) | `.antilink on` |
| `.antispam` | `.antiflood` | Stops flooding: when a member sends more than N messages in S seconds, the extra messages are deleted and the member is warned or removed. Admins are never affected. The bot must be a group admin. | group admins (groups) | `.antispam on` |
| `.antitag` | – | Deletes messages from non-admins that mention most of the group. Action: delete or kick. The bot must be a group admin. | group admins (groups) | `.antitag on` |
| `.ban` | – | Stops a user from using the bot anywhere. Owners can never be banned. | owner, sudo | `.ban @someone` |
| `.captcha` | `.verify` `.antibot` | New members who join by link must answer a small sum within a few minutes, or the bot removes them (stops spam bots). Their messages are deleted until they answer. Members added by an admin skip it. The bot must be a group admin. | group admins (groups) | `.captcha on` |
| `.chatbot` | – | Turns the AI chatbot on or off in this group. When on, it answers messages that mention or reply to the bot. _Needs: ai._ | group admins (groups) | `.chatbot on` |
| `.clear` | – | Sends and immediately deletes a bot message (clears the chat preview). | everyone (groups) | `.clear` |
| `.delete` | `.del` | Deletes recent messages: the replied message, the last N from a user, or the last N in the group (max 50, only messages the bot saw since it started). The bot must be a group admin. | group admins (groups) | `.del (reply)` |
| `.demote` | – | Removes admin rights from members. The bot must be a group admin. | group admins (groups) | `.demote @201012345678` |
| `.disable` | `.cmdoff` | Turns commands off in this group (for everyone except the bot owner and sudo). .help and .enable can't be turned off. | group admins (groups) | `.disable sticker song` |
| `.disabled` | `.offcommands` | Lists the commands turned off in this group. | everyone (groups) | `.disabled` |
| `.enable` | `.cmdon` | Turns commands back on in this group. ".enable all" turns every one back on. | group admins (groups) | `.enable sticker` |
| `.filter` | `.autoreply` `.addfilter` | Adds an auto-reply: when someone writes the trigger word or phrase, the bot answers with your text. Or reply to a message to use it as the answer. | group admins (groups) | `.filter hello \| Welcome to the group! 👋` |
| `.filters` | `.autoreplies` | Lists this group's auto-replies. | everyone (groups) | `.filters` |
| `.gcschedule` | `.autoclose` `.groupschedule` | Closes the group every day at one time (only admins can write) and opens it at another. Times use the bot's TIMEZONE. The bot must be a group admin. | group admins (groups) | `.gcschedule close 23:00` |
| `.goodbye` | – | Goodbye messages when members leave. Variables: {user}, {group}, {count}. | group admins (groups) | `.goodbye on` |
| `.hidetag` | – | Like .tag but only mentions members who are not admins. | group admins (groups) | `.hidetag Meeting at 8 pm` |
| `.inactive` | `.silent` `.ghosts` | Lists members who haven't written in this group for N days (default 7). Nobody is mentioned or notified. Counting starts when the bot first sees the group. | group admins (groups) | `.inactive` |
| `.kick` | – | Removes members from the group. The bot and its owners cannot be kicked. The bot must be a group admin. | group admins (groups) | `.kick @201012345678` |
| `.levelup` | `.levelmsg` | Turns level-up announcements in this group on or off (XP is always counted). ".levelup reset" clears all levels here. | group admins (groups) | `.levelup` |
| `.link` | `.invite` `.grouplink` `.gclink` | Shows the group's invite link. The bot must be a group admin. | group admins (groups) | `.link` |
| `.linkallow` | `.allowlink` `.antilinkallow` | Domains antilink lets through in this group (subdomains included). Without arguments, lists them. | group admins (groups) | `.linkallow youtube.com` |
| `.lock` | – | Only admins can change the group name, photo and description. The bot must be a group admin. | group admins (groups) | `.lock` |
| `.mute` | – | Only admins can send messages. Optionally unmute automatically after N minutes. The bot must be a group admin. | group admins (groups) | `.mute` |
| `.promote` | – | Makes members group admins. The bot must be a group admin. | group admins (groups) | `.promote @201012345678` |
| `.resetlink` | `.revoke` `.anularlink` | Revokes the group invite link and shows the new one. The bot must be a group admin. | group admins (groups) | `.resetlink` |
| `.setgdesc` | – | Changes the group description. The bot must be a group admin. | group admins (groups) | `.setgdesc Welcome to our study group` |
| `.setgname` | – | Changes the group name. The bot must be a group admin. | group admins (groups) | `.setgname Study Group` |
| `.setgpp` | – | Sets the group photo from the image or sticker you reply to. The bot must be a group admin. | group admins (groups) | `.setgpp` _(reply to an image)_ |
| `.stopfilter` | `.delfilter` `.rmfilter` | Removes an auto-reply (".stopfilter all" removes every one). | group admins (groups) | `.stopfilter` |
| `.tag` | – | Sends your text (or re-sends the replied message) while silently mentioning everyone. | group admins (groups) | `.tag Meeting at 8 pm` |
| `.tagall` | – | Mentions every member, one per line. | group admins (groups) | `.tagall` |
| `.tagnotadmin` | – | Mentions every member who is not an admin. | group admins (groups) | `.tagnotadmin` |
| `.unban` | – | Allows a banned user to use the bot again. | owner, sudo | `.unban @201012345678` |
| `.unlock` | – | Lets every member change the group name, photo and description. The bot must be a group admin. | group admins (groups) | `.unlock` |
| `.unmute` | – | Lets everyone send messages again. The bot must be a group admin. | group admins (groups) | `.unmute` |
| `.warn` | – | Warns a member. They are removed automatically at WARN_LIMIT warnings (default 3). The bot must be a group admin. | group admins (groups) | `.warn @201012345678` |
| `.warnings` | – | Shows how many warnings a member has in this group. | everyone (groups) | `.warnings @201012345678` |
| `.welcome` | – | Welcome messages when members join. Variables: {user}, {group}, {description}, {count}. | group admins (groups) | `.welcome on` |

### Owner

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.anticall` | – | Rejects incoming calls and blocks the caller. | owner | `.anticall on` |
| `.antidelete` | – | When someone deletes a message, sends you a copy (kept for 24 h, limited size). | owner | `.antidelete on` |
| `.autoreact` | `.areact` `.autoreaction` | Reacts with ⏳ to every command message. | owner | `.autoreact on` |
| `.autoread` | – | Marks every incoming message as read (except ones that mention the bot). | owner | `.autoread on` |
| `.autostatus` | – | Automatically views contacts' statuses, and optionally reacts to them with 💚. | owner | `.autostatus react on` |
| `.autotyping` | – | Shows a 'typing…' indicator when the bot receives messages. | owner | `.autotyping on` |
| `.backup` | – | Sends you a backup file of all bot settings and lists (mode, sudo, bans, group settings, notes, reminders, levels …) to restore later with .restore. ".backup full" also includes API keys set from chat and saved cookies. The WhatsApp session is never included. | owner (private chat) | `.backup` |
| `.block` | – | Blocks someone on the bot's WhatsApp account (they can't message or call it). Mention them, reply to them, or give the number. | owner | `.block` |
| `.clearsession` | `.clearsesi` | Deletes cached encryption key files from the session folder (keeps creds.json). Only for fixing persistent 'waiting for this message' errors; restart the bot afterwards. | owner | `.clearsession confirm` |
| `.cleartmp` | – | Deletes leftover temporary files. | owner, sudo | `.cleartmp` |
| `.cookies` | `.listcookies` `.cookie` | Shows which sites have saved cookies, whether they contain a login, and when it expires (values are never shown). | owner | `.cookies` |
| `.delcookie` | `.delcookies` `.rmcookie` | Deletes the saved cookies of a site (or all). | owner | `.delcookie youtube` |
| `.delvar` | `.unset` `.resetvar` | Removes a setting made with .setvar, so the value from .env (or the default) is used again. | owner | `.delvar PREFIX` |
| `.doctor` | `.diag` `.diagnose` `.status` | Health report: connection, memory, tools (yt-dlp, ffmpeg …) checked live, and which commands are disabled and why. | owner | `.doctor` |
| `.groups` | `.listgroups` `.grouplist` | Lists every group the bot is in, with member counts and whether the bot is an admin there. | owner | `.groups` |
| `.join` | `.joingroup` | Makes the bot join a group from an invite link. | owner | `.join https://chat.whatsapp.com/AbCdEf123456` |
| `.leave` | `.leavegc` `.exit` | Makes the bot leave this group. | owner (groups) | `.leave` |
| `.leavegroup` | `.exitgroup` | Makes the bot leave a group by its number from .groups. | owner | `.leavegroup` |
| `.mention` | – | Turns the automatic reply on or off for messages that mention the bot in groups. | owner | `.mention on` |
| `.mode` | – | Public: everyone can use commands. Private: only owner and sudo (group moderation keeps working). | owner | `.mode private` |
| `.pmblocker` | – | Blocks anyone who is not owner/sudo and messages the bot privately (they get a notice first). | owner | `.pmblocker on` |
| `.restart` | `.reboot` | Restarts the bot (needed for a few settings). Works when the bot runs under PM2 or Docker, which start it again. | owner | `.restart` |
| `.restore` | – | Restores a backup made with .backup (reply to the file). Lists and settings in it replace the current ones; anything not in the backup is left alone. | owner (private chat) | `.restore` _(reply to a backup file) [confirm]_ |
| `.setcookie` | `.setcookies` `.addcookie` | Saves login cookies for one site so downloads that need a login work (age-restricted/members YouTube, private Instagram …). Sites: youtube, tiktok, facebook, instagram, twitter, reddit, soundcloud, pinterest, vimeo, dailymotion, twitch, threads, snapchat. | owner (private chat) | `.setcookie youtube (caption of a cookies.txt file)` |
| `.setmention` | – | Sets what the bot replies when mentioned: reply to a text, sticker, image, video or audio (max 1 MB). | owner | `.setmention` _(reply to a message)_ |
| `.setpp` | – | Sets the bot's profile picture from the image you reply to. | owner | `.setpp` _(reply to an image)_ |
| `.settings` | – | Shows the bot's global settings and, in a group, that group's protection settings. | owner, sudo | `.settings` |
| `.setvar` | `.set` `.setenv` | Changes a setting from WhatsApp — AI keys and models, bot name, prefix, API keys, limits, tool paths. Applied immediately, saved across restarts, overrides .env. Secrets only in private chat. | owner | `.setvar BOT_NAME Akram Bot` |
| `.stats` | `.usage` `.botstats` | Shows which commands are used most, total commands run, and since when. ".stats reset" starts counting again. | owner | `.stats` |
| `.sudo` | – | Manages sudo users. Sudo users can moderate any group the bot administers and use ban/unban, but cannot change owner settings or add other sudo users. | owner | `.sudo add @friend` |
| `.unblock` | – | Unblocks someone on the bot's WhatsApp account. | owner | `.unblock` |
| `.update` | – | Checks GitHub for a newer version of the bot and of yt-dlp (nightly). '.update now' installs them: the bot is fast-forwarded from your repository, validated, rolled back if the check fails, and restarted. | owner | `.update` |
| `.vars` | `.getvar` `.env` `.config` | Lists the settings you can change from chat with their current values (keys are hidden) and where each comes from. | owner | `.vars` |
| `.vv` | – | Reveals the view-once photo or video you reply to (owner only, to protect other people's privacy). | owner | `.vv` _(reply to a view-once message)_ |

### Stickers

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.attp` | – | Makes an animated sticker of your text blinking in colours. _Needs: ffmpeg, font._ | everyone | `.attp hello` |
| `.crop` | – | Like .sticker but crops the media to a square. | everyone | `.crop` _(send or reply to media)_ |
| `.emojimix` | `.emix` | Mixes two emojis into one sticker (Google Emoji Kitchen). _Needs: tenor._ | everyone | `.emojimix 😎+🥰` |
| `.igs` | – | Turns the videos of an Instagram post into stickers. _Needs: ytdlp, ffmpeg._ | everyone | `.igs https://www.instagram.com/reel/C0abcdefghi/` |
| `.igsc` | – | Like .igs but crops to a square. _Needs: ytdlp, ffmpeg._ | everyone | `.igsc https://www.instagram.com/reel/C0abcdefghi/` |
| `.simage` | – | Converts the sticker you reply to into a picture. | everyone | `.simage` _(reply to a sticker)_ |
| `.sticker` | `.s` | Turns an image, GIF or short video (first 6 s) into a sticker. Optionally give a pack name and author. Pictures work without ffmpeg. | everyone | `.sticker` |
| `.take` | `.steal` | Re-labels the sticker you reply to with your own pack name. | everyone | `.take My Pack` |
| `.tg` | `.stickertelegram` `.tgsticker` `.telesticker` | Copies a public Telegram sticker pack (up to 30 stickers; animated .tgs stickers are skipped). _Needs: telegramBot, ffmpeg._ | everyone | `.tg https://t.me/addstickers/Animals` |
| `.togif` | – | Turns an animated sticker into a GIF file. | everyone | `.togif` _(reply to an animated sticker)_ |
| `.tovideo` | `.tomp4` `.togifv` | Turns an animated sticker into a video that plays like a GIF (needs ffmpeg; without it, use .togif). _Needs: ffmpeg._ | everyone | `.tovideo` _(reply to an animated sticker)_ |

### Images

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.blur` | – | Blurs the image you send or reply to. | everyone | `.blur` _(send or reply to an image)_ |
| `.brighten` | `.bright` | Makes it brighter (or darker below 1). Works on the picture or sticker you send or reply to; done on the server, nothing is uploaded. | everyone | `.brighten` |
| `.circlecrop` | `.round` | Crops to a circle with a transparent background (PNG). Works on the picture or sticker you send or reply to; done on the server, nothing is uploaded. | everyone | `.circlecrop` _(send or reply to a picture)_ |
| `.compress` | `.shrink` | Makes a picture smaller in bytes (JPEG at the quality you choose) and shows the size before and after. | everyone | `.compress` |
| `.flipimg` | `.flipv` | Flips upside down. Works on the picture or sticker you send or reply to; done on the server, nothing is uploaded. | everyone | `.flipimg` _(send or reply to a picture)_ |
| `.grayscale` | `.gray` `.grey` `.bw` | Black and white. Works on the picture or sticker you send or reply to; done on the server, nothing is uploaded. | everyone | `.grayscale` _(send or reply to a picture)_ |
| `.imginfo` | `.exif` | Shows a picture's size, format and pixel dimensions. | everyone | `.imginfo` _(reply to a picture)_ |
| `.invert` | `.negative` | Inverts the colours. Works on the picture or sticker you send or reply to; done on the server, nothing is uploaded. | everyone | `.invert` _(send or reply to a picture)_ |
| `.mirror` | `.flop` | Mirrors left ↔ right. Works on the picture or sticker you send or reply to; done on the server, nothing is uploaded. | everyone | `.mirror` _(send or reply to a picture)_ |
| `.pixelate` | `.pixel` `.censor` | Pixelates the picture. Works on the picture or sticker you send or reply to; done on the server, nothing is uploaded. | everyone | `.pixelate` |
| `.remini` | `.enhance` `.upscale` | Enhances/upscales the image you send or reply to. _Needs: remini._ | everyone | `.remini` _(send or reply to an image)_ |
| `.removebg` | `.rmbg` `.nobg` | Removes the background of the image you send or reply to. _Needs: removeBg._ | everyone | `.removebg` _(send or reply to an image)_ |
| `.resize` | `.scale` | Resizes to a width×height (keeps proportions when one side is 0), or by a percentage. Works on the picture or sticker you send or reply to; done on the server, nothing is uploaded. | everyone | `.resize 512x512` |
| `.rotate` | – | Rotates by 90° (or the angle you give). Works on the picture or sticker you send or reply to; done on the server, nothing is uploaded. | everyone | `.rotate` |
| `.saturate` | `.vivid` | Makes colours stronger (or weaker below 1). Works on the picture or sticker you send or reply to; done on the server, nothing is uploaded. | everyone | `.saturate` |
| `.sepia` | – | Old-photo sepia tone. Works on the picture or sticker you send or reply to; done on the server, nothing is uploaded. | everyone | `.sepia` _(send or reply to a picture)_ |
| `.sharpen` | – | Makes a blurry picture sharper. Works on the picture or sticker you send or reply to; done on the server, nothing is uploaded. | everyone | `.sharpen` _(send or reply to a picture)_ |
| `.toformat` | `.convertimg` `.tojpg` `.topng` `.towebp` | Converts a picture or sticker to JPG, PNG or WebP and sends it as a file (so WhatsApp doesn't recompress it). | everyone | `.toformat png` |

### Audio effects

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.8d` | `.eightd` | Slowly pans left and right (use headphones). Reply to a voice note, song or video. _Needs: ffmpeg._ | everyone | `.8d` _(reply to audio or video)_ |
| `.bass` | `.bassboost` | Boosts the bass. Reply to a voice note, song or video. _Needs: ffmpeg._ | everyone | `.bass` _(reply to audio or video)_ |
| `.chipmunk` | `.squirrel` `.highvoice` | Chipmunk voice (same speed). Reply to a voice note, song or video. _Needs: ffmpeg._ | everyone | `.chipmunk` _(reply to audio or video)_ |
| `.deep` | `.lowvoice` | Deeper voice (same speed). Reply to a voice note, song or video. _Needs: ffmpeg._ | everyone | `.deep` _(reply to audio or video)_ |
| `.echo` | – | Adds an echo. Reply to a voice note, song or video. _Needs: ffmpeg._ | everyone | `.echo` _(reply to audio or video)_ |
| `.fast` | `.speedup` | Speeds it up (same pitch). Reply to a voice note, song or video. _Needs: ffmpeg._ | everyone | `.fast` _(reply to audio or video)_ |
| `.nightcore` | `.nc` | Faster and higher (nightcore). Reply to a voice note, song or video. _Needs: ffmpeg._ | everyone | `.nightcore` _(reply to audio or video)_ |
| `.reverse` | – | Plays it backwards. Reply to a voice note, song or video. _Needs: ffmpeg._ | everyone | `.reverse` _(reply to audio or video)_ |
| `.robot` | – | Robot voice. Reply to a voice note, song or video. _Needs: ffmpeg._ | everyone | `.robot` _(reply to audio or video)_ |
| `.slow` | `.slowed` | Slows it down (same pitch). Reply to a voice note, song or video. _Needs: ffmpeg._ | everyone | `.slow` _(reply to audio or video)_ |
| `.vaporwave` | `.vapor` | Slower and lower (vaporwave). Reply to a voice note, song or video. _Needs: ffmpeg._ | everyone | `.vaporwave` _(reply to audio or video)_ |

### Text effects

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.1917` | – | Writes your text with the "1917" effect. | everyone | `.1917 Hello` |
| `.arena` | – | Writes your text with the "arena" effect. | everyone | `.arena Hello` |
| `.blackpink` | – | Writes your text with the "blackpink" effect. | everyone | `.blackpink Hello` |
| `.devil` | – | Writes your text with the "devil" effect. | everyone | `.devil Hello` |
| `.fire` | – | Writes your text with the "fire" effect. | everyone | `.fire Hello` |
| `.glitch` | – | Writes your text with the "glitch" effect. | everyone | `.glitch Hello` |
| `.hacker` | – | Writes your text with the "hacker" effect. | everyone | `.hacker Hello` |
| `.ice` | – | Writes your text with the "ice" effect. | everyone | `.ice Hello` |
| `.impressive` | – | Writes your text with the "impressive" effect. | everyone | `.impressive Hello` |
| `.leaves` | – | Writes your text with the "leaves" effect. | everyone | `.leaves Hello` |
| `.light` | – | Writes your text with the "light" effect. | everyone | `.light Hello` |
| `.matrix` | – | Writes your text with the "matrix" effect. | everyone | `.matrix Hello` |
| `.metallic` | – | Writes your text with the "metallic" effect. | everyone | `.metallic Hello` |
| `.neon` | – | Writes your text with the "neon" effect. | everyone | `.neon Hello` |
| `.purple` | – | Writes your text with the "purple" effect. | everyone | `.purple Hello` |
| `.sand` | – | Writes your text with the "sand" effect. | everyone | `.sand Hello` |
| `.snow` | – | Writes your text with the "snow" effect. | everyone | `.snow Hello` |
| `.thunder` | – | Writes your text with the "thunder" effect. | everyone | `.thunder Hello` |

### Downloads

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.dl` | `.download` `.get` | Downloads the video (or SoundCloud audio) from a link on any supported site: youtube, tiktok, facebook, instagram, twitter, reddit, soundcloud, pinterest, vimeo, dailymotion, twitch, threads, snapchat. _Needs: ytdlp._ | everyone | `.dl https://x.com/…/status/…` |
| `.facebook` | `.fb` | Downloads a public Facebook video. _Needs: ytdlp._ | everyone | `.facebook https://www.facebook.com/watch/?v=10153231379946729` |
| `.instagram` | `.insta` `.ig` | Downloads the videos of a public Instagram post or reel (photos are not supported; private posts need YTDLP_COOKIES). _Needs: ytdlp._ | everyone | `.instagram https://www.instagram.com/reel/C0abcdefghi/` |
| `.song` | `.play` `.mp3` `.ytmp3` `.music` | Finds a song on YouTube (or uses your YouTube link) and sends it as audio. _Needs: ytdlp, ffmpeg._ | everyone | `.play adele hello` |
| `.spotify` | – | Finds a track by name and sends it as audio (searched on YouTube; Spotify links are not downloaded). _Needs: ytdlp, ffmpeg._ | everyone | `.spotify con calma` |
| `.tiktok` | `.tt` | Downloads a TikTok video. _Needs: ytdlp._ | everyone | `.tiktok https://www.tiktok.com/@scout2015/video/6718335390845095173` |
| `.twitter` | `.x` `.tw` | Downloads the videos of a post on X (Twitter). _Needs: ytdlp._ | everyone | `.twitter` |
| `.video` | `.ytmp4` | Finds a video on YouTube (or uses your link) and sends it (max 720p, size and length limited). _Needs: ytdlp._ | everyone | `.video lofi beats` |
| `.yts` | `.ytsearch` `.search` | Searches YouTube and lists the top results. Then send .play <number> or .video <number> to download one. _Needs: ytdlp._ | everyone | `.yts amr diab tamally maak` |

### AI

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.ai` | `.gpt` `.gemini` `.ask` `.claude` | Asks the AI (Claude, Gemini or an OpenAI-compatible model — the owner picks it with .setai). It remembers your last few questions for 30 minutes, so you can ask follow-ups. Reply to a message to ask about it, or send/reply to a photo or sticker to ask about the picture. _Needs: ai._ | everyone | `.ai write a haiku about Cairo` |
| `.aimodel` | `.models` `.setmodel` | Lists the models your AI key can use and switches to one (by name or number). Add a word to filter the list. _Needs: ai._ | owner | `.aimodel` |
| `.aireset` | `.newchat` `.forget` `.clearai` | Makes .ai forget your conversation, to start a new topic. Also shows how many AI requests you have left today. _Needs: ai._ | everyone | `.aireset` |
| `.imagine` | `.draw` `.genimg` `.dalle` `.nanobanana` | Draws a picture from your description with AI (Gemini or OpenAI, whichever key the owner set). Reply to a picture to edit it instead (Gemini only), e.g. "make it a cartoon". _Needs: aiImage._ | everyone | `.imagine a cat astronaut on the moon, watercolor` |
| `.recap` | `.catchup` `.missed` `.mulakhas` | ملخص ما دار في المجموعة مؤخراً — summarizes the recent group conversation ("what did I miss?"): topics, decisions and open questions. Uses up to the last 200 messages the bot saw (kept in memory only). _Needs: ai._ | everyone (groups) | `.recap` |
| `.setai` | `.aiset` `.aiprovider` | Chooses the AI (Claude, Gemini or any OpenAI-compatible service) and sets its API key. The key is tested before it is saved. Without arguments, shows the current AI. | owner | `.setai gemini AIza…` |
| `.summarize` | `.summary` `.tldr` `.sum` | Summarizes a long message (reply to it), a web page link, or a YouTube video (from its captions). Add a question to ask about it instead. _Needs: ai._ | everyone | `.summarize https://en.wikipedia.org/wiki/Nile` |
| `.transcribe` | `.stt` `.totext` `.voice2text` | Writes out what is said in a voice note, audio or video (any language). Add "translate <language>" to translate it too. _Needs: aiAudio._ | everyone | `.transcribe` _(reply to a voice note)_ |

### Fun

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.8ball` | – | Answers a yes/no question like a magic 8-ball. | everyone | `.8ball Will it rain tomorrow?` |
| `.character` | – | A random, just-for-fun 'character analysis' of someone. | everyone | `.character @201012345678` |
| `.china` | – | Same as .pies china. | everyone | `.china` |
| `.compliment` | – | Compliments someone. | everyone | `.compliment @201012345678` |
| `.dare` | – | Gives a random dare. | everyone | `.dare` |
| `.flip` | `.coin` `.coinflip` | Flips a coin. | everyone | `.flip` |
| `.flirt` | – | Sends a random flirty line. | everyone | `.flirt` |
| `.goodnight` | `.lovenight` `.gn` | Sends a good-night message. | everyone | `.goodnight` |
| `.india` | – | Same as .pies india. | everyone | `.india` |
| `.indonesia` | – | Same as .pies indonesia. | everyone | `.indonesia` |
| `.insult` | – | Teases someone with a light-hearted roast. | everyone | `.insult @201012345678` |
| `.japan` | – | Same as .pies japan. | everyone | `.japan` |
| `.korea` | – | Same as .pies korea. | everyone | `.korea` |
| `.malaysia` | – | Same as .pies malaysia. | everyone | `.malaysia` |
| `.meme` | – | Sends a random Cheems meme. | everyone | `.meme` |
| `.pick` | `.choose` `.choice` | Picks one option at random. Separate options with commas or \|. | everyone | `.pick pizza, koshary, shawarma` |
| `.pies` | – | Sends a random picture for a country: india, malaysia, thailand, china, indonesia, japan, korea, vietnam. | everyone | `.pies japan` |
| `.random` | `.rand` `.rng` | Random whole number between two numbers (1-100 by default). | everyone | `.random` |
| `.roll` | `.dice` | Rolls dice: 1 six-sided die by default, or NdM (up to 20 dice with up to 1000 sides). | everyone | `.roll` |
| `.roseday` | – | Sends a Rose Day quote. | everyone | `.roseday` |
| `.shayari` | `.shayri` | Sends a random shayari (poem). | everyone | `.shayari` |
| `.ship` | – | Pairs two random group members. | everyone (groups) | `.ship` |
| `.thailand` | – | Same as .pies thailand. | everyone | `.thailand` |
| `.truth` | – | Gives a random truth question. | everyone | `.truth` |

### Image effects

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.circle` | – | Crops the picture into a circle. | everyone | `.circle @201012345678` |
| `.comrade` | – | Adds a comrade overlay. | everyone | `.comrade @201012345678` |
| `.gay` | – | Adds a rainbow overlay. | everyone | `.gay @201012345678` |
| `.glass` | – | Adds a broken-glass overlay. | everyone | `.glass @201012345678` |
| `.heart` | – | Puts the picture in a heart. | everyone | `.heart @201012345678` |
| `.horny` | – | Makes a joke 'horny licence' card. | everyone | `.horny @201012345678` |
| `.jail` | – | Puts the picture behind bars. | everyone | `.jail @201012345678` |
| `.lgbt` | – | Adds a rainbow flag overlay. | everyone | `.lgbt @201012345678` |
| `.lolice` | – | Makes a joke 'police' meme. | everyone | `.lolice @201012345678` |
| `.namecard` | – | Makes a name card. | everyone | `.namecard Ali\|01/01/2000\|Hello there` |
| `.oogway` | – | Master Oogway quote meme. | everyone | `.oogway Yesterday is history` |
| `.oogway2` | – | Master Oogway quote meme (style 2). | everyone | `.oogway2 Yesterday is history` |
| `.passed` | – | Adds a GTA 'mission passed' overlay. | everyone | `.passed @201012345678` |
| `.simp` | `.simpcard` | Makes a joke 'simp card'. | everyone | `.simp @201012345678` |
| `.stupid` | `.itssostupid` `.iss` `.its-so-stupid` | Makes an 'it's so stupid' dog meme. | everyone | `.stupid im stupid` |
| `.tonikawa` | – | Makes a Tonikawa anime frame. | everyone | `.tonikawa @201012345678` |
| `.triggered` | – | Makes a 'triggered' meme. | everyone | `.triggered @201012345678` |
| `.tweet` | – | Makes a fake tweet image. | everyone | `.tweet Ali\|ali\|Hello world\|dark` |
| `.wasted` | `.waste` | Adds a GTA 'wasted' overlay. | everyone | `.wasted @201012345678` |
| `.ytcomment` | – | Makes a fake YouTube comment image. | everyone | `.ytcomment ali\|Great video` |

### Anime

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.animu` | – | Sends an anime reaction sticker. Types: nom, poke, cry, kiss, pat, hug, wink, face-palm, quote. | everyone | `.animu hug` |
| `.animuquote` | – | Sends a random anime quote. | everyone | `.animuquote` |
| `.cry` | – | Sends a "cry" anime reaction sticker. | everyone | `.cry` |
| `.facepalm` | `.face-palm` | Sends a facepalm anime sticker. | everyone | `.facepalm` |
| `.hug` | – | Sends a "hug" anime reaction sticker. | everyone | `.hug` |
| `.kiss` | – | Sends a "kiss" anime reaction sticker. | everyone | `.kiss` |
| `.nom` | – | Sends a "nom" anime reaction sticker. | everyone | `.nom` |
| `.pat` | – | Sends a "pat" anime reaction sticker. | everyone | `.pat` |
| `.poke` | – | Sends a "poke" anime reaction sticker. | everyone | `.poke` |
| `.wink` | – | Sends a "wink" anime reaction sticker. | everyone | `.wink` |

### Games

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.answer` | – | Answers the current trivia question. | everyone | `.answer Paris` |
| `.guess` | – | Guesses a letter in the current hangman game. | everyone | `.guess e` |
| `.hangman` | – | Starts a game of hangman in this chat. Guess with .guess <letter>. | everyone | `.hangman` |
| `.leaderboard` | `.lb` `.top` `.levels` | The 10 most active members of this group by XP. | everyone (groups) | `.leaderboard` |
| `.mathquiz` | `.quiz` `.mquiz` | A quick maths question: the first person to send the right number within 30 seconds wins points (easy 1, medium 2, hard 3). ".mathquiz top" shows the leaderboard. | everyone | `.mathquiz` |
| `.rank` | `.level` `.xp` | Shows your level card in this group (or someone else's): level, rank and XP. Members earn XP by chatting (once a minute). | everyone (groups) | `.rank` |
| `.rps` | `.rockpaperscissors` | Rock, paper, scissors against the bot. | everyone | `.rps rock` |
| `.surrender` | – | Gives up your current tic-tac-toe game. | everyone | `.surrender` |
| `.tictactoe` | `.ttt` | Starts or joins a tic-tac-toe game. Play by sending a number 1-9; send 'surrender' to give up. | everyone | `.tictactoe` |
| `.topmembers` | – | Shows the 5 most active members of this group (since the bot joined). | everyone (groups) | `.topmembers` |
| `.trivia` | – | Asks a multiple-choice trivia question. Answer with .answer <answer>. | everyone | `.trivia` |
### Games without a prefix

During a tic-tac-toe game, players send a bare number `1`–`9` to place their mark, or `surrender` to give up.

### Automatic features (no command)

| Feature | Turned on with | Behaviour |
|---|---|---|
| Group chatbot | `.chatbot on` (group admins; needs an AI key, see `.setai`) | Replies when someone mentions the bot or replies to one of its messages. Only that message is sent to the AI. |
| Auto-replies | `.filter <trigger> \| <reply>` (group admins) | When a message contains the trigger word or phrase (whole words, any language), the bot answers. At most one auto-reply per group every 5 s, the same one at most every 30 s. `.filters` lists them, `.stopfilter <trigger>` removes one. Max 50 per group |
| Levels | always on in groups; `.levelup on` (group admins) announces level-ups | Members earn 15–25 XP for a chat message, at most once a minute; commands don't count. `.rank` shows a level card, `.leaderboard` the top 10, `.levelup reset` clears the group |
| Math quiz | `.mathquiz [easy\|medium\|hard]` (anyone) | The first message with the right number within 30 s wins points; `.mathquiz top` shows the leaderboard |
| Notes | `.save <name> <text>` (group admins in groups) | Anyone sending `#name` gets the note back. `.notes` lists them. Max 100 per chat |
| Anti-spam | `.antispam on` (group admins) | See [Group protection settings](#group-protection-settings) |
| Mention reply | `.mention on`, `.setmention` (owner) | Replies with your chosen text/sticker/media when the bot is mentioned in a group |
| Antidelete | `.antidelete on` (owner) | Sends you a copy of messages others delete, and view-once media, in the bot's own chat |
| Auto-read / auto-typing / auto-status | `.autoread on`, `.autotyping on`, `.autostatus on` (owner) | As named |
| PM blocker | `.pmblocker on` (owner) | Sends a notice to, then blocks, anyone who messages the bot privately (owner and sudo excepted) |
| Anticall | `.anticall on` (owner) | Rejects calls and blocks the caller |
| Promote/demote announcements | always in public mode | Announces admin changes in groups |
| AFK notices | `.afk [reason]` (anyone) | When someone mentions or replies to an AFK user, the bot says they are away (at most once per chat every 5 minutes). The AFK user's next message clears it |
| Reminders | `.remind 10m <text>`, `.remind at 18:30 <text>`, `.remind tomorrow at 9am <text>`, `.remind friday at 20:00 <text>`, `.remind every day at 08:00 <text>`, `.remind every monday at 9am <text>` (anyone) | Times use `TIMEZONE`. Repeating reminders (every 10 minutes to 60 days) continue until `.remind del <id>`. Sent in the chat where they were set, mentioning you. Stored in `DATA_DIR/reminders.json`, so they survive restarts; reminders that fell due while the bot was offline are sent on reconnect, marked late. Max 10 per person, 60 days ahead |

## Configuration options

All settings live in `MD-main/.env`; most can also be changed from WhatsApp (see [Changing settings from WhatsApp](#changing-settings-from-whatsapp)), which overrides `.env`. `MD-main/.env.example` lists every option with an explanation; copy it and edit:

```bash
cp MD-main/.env.example MD-main/.env
```

| Variable | Default | Meaning |
|---|---|---|
| `OWNER_NUMBERS` | — (required) | Your WhatsApp number(s), international format with country code, comma-separated |
| `OWNER_LIDS` | empty | Your `@lid` IDs (digits) if groups show you as a LID user; see `.whoami` |
| `BOT_NAME` | `WhatsApp Bot` | Name shown in `.help`, `.alive`, `.ping` |
| `OWNER_NAME` | `Owner` | Name on the `.owner` contact card |
| `PREFIX` | `.` | Command prefix (1–3 characters) |
| `MODE` | `public` | Starting mode; later `.mode` changes are remembered |
| `MARK_ONLINE` | `true` | Show the bot as online |
| `STICKER_PACK` / `STICKER_AUTHOR` | bot name / empty | Sticker metadata |
| `PAIRING_NUMBER` | empty | Number to pair from the terminal (prints a pairing code) |
| `SESSION_DIR` | `session` | WhatsApp login (keep private, back up) |
| `DATA_DIR` | `data` | Bot settings and lists |
| `TMP_DIR` | `tmp` | Temporary files |
| `LOG_LEVEL` | `info` | `fatal`…`trace` or `silent` |
| `LOG_FORMAT` | `pretty` on a terminal, else `json` | Log style |
| `BAILEYS_LOG_LEVEL` | `silent` | WhatsApp library logs |
| `HEALTH_HOST` / `HEALTH_PORT` | `127.0.0.1` / `3000` | Health endpoint `/healthz` (`0` disables) |
| `MAX_MEDIA_MB` | `25` | Largest WhatsApp media a command downloads |
| `MAX_DOWNLOAD_MB` | `50` | Largest file the downloaders fetch |
| `MAX_VIDEO_SECONDS` | `600` | Longest audio/video the downloaders fetch |
| `DEFAULT_COOLDOWN_SECONDS` | `3` | Default per-user command cooldown |
| `WARN_LIMIT` | `3` | Warnings before removal |
| `MAX_PARALLEL_JOBS` | `2` | Downloads/conversions running at once (others wait) |
| `COMMANDS_PER_MINUTE` | `15` | Commands per person per minute (owner/sudo exempt; 0 = no limit) |
| `STORE_MAX_CHATS` / `STORE_MESSAGES_PER_CHAT` | `500` / `20` | Recent messages kept in memory (for `.delete`) |
| `ANTIDELETE_MAX_MESSAGES` / `ANTIDELETE_MAX_MEDIA_MB` | `5000` / `10` | Antidelete limits |
| `FFMPEG_PATH` / `YTDLP_PATH` | `ffmpeg` / `yt-dlp` | Tool locations: a program name found in `PATH`, or a full path. `~` means your home folder (`~/.local/bin/yt-dlp`). Use the standalone yt-dlp nightly binary so `.update now` can update it |
| `TIMEZONE` | the server's zone, or the owner's country when the server is on UTC | IANA name such as `Africa/Cairo`; used by `.time`, `.remind`, `.autoazkar`, `.autotafsir`, `.gcschedule` … `.doctor` shows which zone is used and why |
| `ISLAMIC_ADMIN_ONLY` | `false` | `true`: only group admins may set the automatic Islamic posts (`.autoazkar`, `.autoprayer`, `.autotafsir`, `.autohadith`, `.autowird`, `.autojumuah`) and start or end a `.khatma` in groups |
| `NEWS_REGION` | `US:en` | Default `.news` region, e.g. `EG:ar` |
| `SUGGEST_COMMANDS` | `true` | "Did you mean …?" for mistyped commands |
| `YTDLP_AUTO_UPDATE` | `false` | Update yt-dlp to the latest nightly once a day |
| `UPDATE_REMOTE` / `UPDATE_BRANCH` | `origin` / `main` | Where `.update` gets new versions of the bot |
| `YTDLP_COOKIES` | empty | cookies.txt for login-only content on every site (per-site cookies from `.setcookie` take precedence) |
| `FONT_FILE` | DejaVu Sans Bold | Font for `.attp` |
| `AI_PROVIDER` | `auto` | `auto`, `claude`, `gemini` or `openai` |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` | empty | AI keys (`.setai` sets and tests them) |
| `CLAUDE_MODEL` (old name `AI_MODEL`) / `GEMINI_MODEL` / `OPENAI_MODEL` | `claude-opus-5-5` / `gemini-3.8-flash` / `gpt-6-luna` | Model per provider (`.aimodel`) |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible https endpoint |
| `AI_EFFORT` | `low` | Claude only: `low`…`max` |
| `AI_DAILY_LIMIT` | `50` | AI requests per person per day (0 = unlimited; owner/sudo exempt) |
| `AI_MEMORY_TURNS` | `6` | Exchanges `.ai` and the chatbot remember (0 = none) |
| `GEMINI_IMAGE_MODEL` / `OPENAI_IMAGE_MODEL` / `OPENAI_TRANSCRIBE_MODEL` | `gemini-3.1-flash-image` / `gpt-image-2.5-flare` / `gpt-transcribe` | Models for `.imagine` and `.transcribe` |
| `AI_MAX_TOKENS` | `1024` | Maximum answer length |
| `CHATBOT_PERSONA` | friendly, concise | Chatbot instructions |
| `TENOR_KEY`, `TELEGRAM_BOT_TOKEN`, `REMOVEBG_API_KEY`, `REMINI_API_KEY`, `GITHUB_REPO` | empty | Enable the matching commands |
| `OPENWEATHER_KEY` | empty | No longer needed: `.weather` uses Open-Meteo, which is free and keyless |

The pairing service has its own `Bot_Pair_Code-main/.env`; its options are explained in `Bot_Pair_Code-main/.env.example` and in [DEPLOYMENT.md](DEPLOYMENT.md).

## Privacy notes for group members

- Commands marked "uses external service" in `.help <command>` send the text, image or link to that service. `.ai` with a photo sends that photo to the configured AI provider (Anthropic, Google or the OpenAI-compatible service). `.summarize` sends the message, the web page text or the video captions to it. `.recap` sends the group's recent messages (names and text, up to 200) to it; when an AI key is set, the bot keeps that recent text in memory for this. `.short` sends the link to TinyURL. `.imagine` and `.transcribe` send the description, picture or audio to Google or OpenAI. `.news` sends the topic to Google News, `.crypto` the coin name to CoinGecko. `.azkar`, `.dua` and `.hisn` work offline; `.autoazkar city` sends only the city name (to look up prayer times). The new picture effects (`.grayscale`, `.resize` …) and audio effects (`.bass`, `.nightcore` …) run on the server; nothing is uploaded. `.weather`, `.time` and `.prayer` send only the city name; `.wiki`, `.define`, `.currency` and `.quran` send only the search term. `.tourl`, `.remini` and the image-effect commands upload pictures to **public** file hosts.
- `.khatma` saves which member took and read which juz (their WhatsApp id) in `DATA_DIR/khatma.json` until the khatma is ended or the bot leaves the group.
- Antidelete and `.vv` are owner-only features that reveal deleted or view-once content to the bot owner. Tell your groups if you enable antidelete.

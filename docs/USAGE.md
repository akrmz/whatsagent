# Usage

How to use the bot from WhatsApp, and every configuration option.

- The command prefix is `.` by default (change it with `PREFIX` in `.env`). Every example below uses `.`.
- Sections can be opened by English or Arabic name: `.help realestate` or `.help عقارات`, `.help islamic` or `.help إسلاميات`, `.help tools` or `.help أدوات`, `.help download` or `.help تحميل` …
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

Download commands work the same way with links: reply to a message that contains a link with `.dl` (or `.tiktok`, `.facebook`, `.song` …) and the bot downloads that link.

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

Group rules: admins set them with `.setrules <text>` (several lines are fine, or reply to a message), and anyone can read them with `.rules` or `#rules`. Without rules, `.rules` shows the group description. Add `{rules}` to the welcome message to greet new members with them: `.welcome set Welcome {user}! Our rules: {rules}` (line breaks you type are kept). `.delrules` removes them.

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
| `.autoazkar sleep 22:30` | Also sends the **adhkar before sleep** (أذكار النوم, Hisn al-Muslim) every night at that time. `.autoazkar sleep off` stops them. |
| `.autotafsir every 3` (or `.autotafsir on`) | Posts a random verse with al-Tafsir al-Muyassar every 3 hours (1–24). `.autotafsir off` stops it. |
| `.autotafsir quiet 23:00-07:00` | No automatic verses or duas during these hours (`TIMEZONE`); posts due then wait until the quiet hours end. This is the default; `.autotafsir quiet off` allows posts at any time. |
| `.autoazkar off` | Stops everything for this chat. `.autoazkar` alone shows the current setup. |

If the bot was offline at the time, it sends the message when it comes back (up to 3 hours late), once per day. Turning it on at noon does not send that morning's adhkar late. With `.autoazkar city`, the times follow that city's own clock, even if the bot's `TIMEZONE` is different.

More in the same 🕌 section of `.help`:

| Command | What it does |
|---|---|
| `.autoprayer on Cairo` (`.adhan`) | Announces each of the five prayers in this chat ("حان الآن موعد أذان العصر"), using the city's prayer times (aladhan.com picks the method used in that region) and its time zone. An alert more than 20 minutes late (bot offline) is skipped. `.autoprayer off` stops it. Any member can set it (unless `ISLAMIC_ADMIN_ONLY` is on). |
| `.autoprayer azkar on` | Also sends the **adhkar after the prayer** (الأذكار بعد السلام من الصلاة, Hisn al-Muslim) 25 minutes after each adhan, or `.autoprayer azkar on 15` for 10–60 minutes. The adhkar the book marks for after Fajr and Maghrib (10 times) and after Fajr only are sent only after those prayers. `.autoprayer azkar off` stops them. |
| `.prayer <city>` | Today's prayer times and which prayer is next. |
| `.hijri` | Today's Hijri date (Umm al-Qura, works offline). |
| `.ramadan` | Days left until Ramadan, the Eids, Arafah, Ashura and the Hijri new year. Moon sighting can shift these by a day. |
| `.quran 2:255` / `.quran البقرة 255 audio` | A verse with English translation; `audio` adds Mishary Alafasy's recitation. |
| `.tafsir 2:255` / `.tafsir الكهف 10` / `.tafsir` | The verse (or a random one) with al-Tafsir al-Muyassar (Arabic). |
| `.qsearch الصبر` / `.qsearch patience` | Searches the Quran for a word or phrase: Arabic (diacritics not needed) or the English translation (Sahih International). 10 results per page, `.qsearch الصبر 2` for the next page. |
| `.quranquiz` | **Quran quiz (مسابقة قرآنية)**: "which surah is this verse from?" A random verse with four choices: the right surah, two near it in the mushaf, and one anywhere. Send the number (1–4, Arabic digits too). The first right answer within 45 seconds wins a point, and everyone gets one try (a wrong answer gets ❌). First verses of surahs are never asked, because the basmala or opening letters would give it away. `.quranquiz top` shows the group's leaderboard. One question at a time per chat (and not during a `.mathquiz`). |

Verses can be given by number (`2:255`, Arabic digits too) or by surah name and verse: `البقرة 255`, `سورة الكهف 10`, `baqarah 255`, `yaseen 1`. Names work with or without diacritics, "ال" or "سورة", and some other well-known names (ياسين، تبارك، عم، الإسراء). The list of surahs is built in, and a verse number past the end of a surah is caught before anything is fetched.
| `.surah الكهف` / `.surah 18` / `.surah yaseen` | The full surah recited by Mishary Alafasy. Surahs longer than `MAX_DOWNLOAD_MB` (e.g. Al-Baqarah) come as a link instead. |
| `.qibla <city>` | The Qibla direction in degrees from north. |
| `.asma` / `.asma 1` / `.asma all` | The names of Allah (al-Asma' al-Husna). |
| `.autowird on 2 20:00` | **Daily Quran reading (الورد اليومي)**: 2 mushaf pages (1–20) every day at 20:00, in order from page 1 to 604, then a new khatma. Shows progress, days left and completed khatmas. `.autowird` shows the position, `.autowird page 100` moves it, `.autowird off` stops. `.wird` sends the next portion now; `.wird page 50` shows any page. Each surah's basmala is on its own line as in the mushaf. |
| `.khatma new` | **Group khatma (ختمة جماعية)**: a shared khatma of the 30 juz'. `.khatma take` takes the first free juz (or `.khatma take 5` a chosen one) and shows where it starts and its pages; `.khatma done` marks it read; `.khatma drop 5` gives it back. `.khatma` shows the board: progress, who reads which juz, and the free ones. When all 30 are read the bot announces it, and `.khatma new` starts the next one (numbered). Each member can hold up to 3 unread juz'. Anyone can take and finish a juz; starting or ending a khatma, and marking someone else's juz, follow `ISLAMIC_ADMIN_ONLY` like `.autoazkar`. `.khatma info 5` shows a juz without taking it. `.khatma remind` mentions the members whose juz' aren't read yet, with how long they have had them (at most once an hour). |
| `.hamla new 10000 استغفار` | **Group dhikr campaign (حملة ذكر)**: a shared goal. Members add what they said by sending **+100** (or `.hamla 100`; Arabic digits work). The bot reacts 📿 instead of replying, announces 25 %, 50 % and 75 %, and announces when the goal is reached, with the top 5. Short names: استغفار (default), صلاة, تسبيح, تهليل, تكبير, حوقلة, or write any dhikr. `.hamla` shows progress, `.hamla undo` takes back your last addition, `.hamla end` stops. Up to 10,000 per message; a new campaign replaces a running one only with `confirm`. While a campaign runs, a message that is only "+number" counts (so "+1" counts as one). |
| `.siyam` | **Sunnah fasting days** in the next 30 days (`.siyam 60` for up to 60): Mondays and Thursdays, the white days (13–15 of each Hijri month), Arafah, Tasu'a and Ashura, and the start of the six days of Shawwal, with the dates of the next Arafah and Ashura. Never on the Eids or the days of Tashreeq (11–13 Dhul-Hijjah), and nothing during Ramadan. Umm al-Qura calendar, computed offline; where months follow moon sighting, dates can differ by a day. |
| `.autosiyam on 20:00` | Reminds this chat **the evening before** each of those days (default 20:00), saying why (e.g. "غداً الاثنين ١٣ جمادى الأولى: أول الأيام البيض، صيام يوم الاثنين"). Nothing is sent on other evenings. `.autosiyam weekly off` leaves out Mondays and Thursdays. `.autosiyam now` shows tonight's reminder; `.autosiyam off` stops it. |
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
- `.backup photos` sends the real-estate listing photos as a `.tar.gz` file (the normal backup holds the listings' text). To move to a new server: `.restore` the normal backup first, then reply to the photos file with `.restore` and `.restore confirm`.
  - Only photos named like `listings/12/3.jpg` are restored, and each must be a JPEG for a listing that exists. Anything else in the file (other names, links, `../` paths) is skipped and listed. Nothing is ever written outside the photos folder.
  - Above about 95 MB the photos can't be sent on WhatsApp; the bot then says which server folder to copy instead.
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

## Automatic downloads in a group

`.autodl on` (group admins) makes the bot download short-video links that members post in the group: TikTok, Instagram, Facebook, X, Threads, Snapchat, Pinterest and YouTube Shorts. Ordinary YouTube videos stay manual (`.video`). The bot reacts ⏬ while working, then replies with the video (or the first 4 items of a carousel) and reacts ✅. If a link can't be downloaded it only reacts ❌, so the chat isn't filled with error messages.
- **Limits:** one download at a time per group, 15 seconds between them, at most 30 an hour per group, plus the usual `MAX_DOWNLOAD_MB` / `MAX_VIDEO_SECONDS`.
- `.autodl off` turns it off, and `.autos` shows whether it is on. Downloaded videos are converted to H.264 when WhatsApp couldn't play them (needs ffmpeg).

## Real-estate marketing (التسويق العقاري)

**Arabic step-by-step guide:** send `.rehelp` (owner and sudo users). It shows the next step you haven't done yet.

A catalogue of your properties, images ready to post, and the calculations clients ask about. The owner and sudo users (you and your team) manage listings. Anyone can view, search, make a flyer or use the calculators, so clients in your groups can use them too.

**1. Your details** (once): `.agent name أحمد العقاري`, `.agent phone +20 100 123 4567`, `.agent company …`, `.agent currency جنيه` (or EGP, AED, SAR …). They appear on listings, flyers, watermarks and ads.

**2. Add a property** by writing it the way you usually post, one detail per line (Arabic or English labels, Arabic digits, "3.5 مليون", "750 ألف" or "85k" all work):
```
.listing add
النوع: شقة
للبيع
المنطقة: التجمع الخامس - كمبوند ميفيدا
السعر: 3.5 مليون
المساحة: 150
الغرف: 3
الحمامات: 2
الدور: الرابع
التشطيب: سوبر لوكس
قريبة من الجامعة الأمريكية
```
Or forward a broker's post to the bot and reply to it with `.listing add`. **Posts written as sentences work too**, e.g. "شقة للبيع في التجمع الخامس 150 متر 3 غرف 2 حمام الدور الرابع سوبر لوكس بسعر 3.5 مليون". The bot reads the area (after في / بكمبوند), size (متر، م، sqm), rooms (غرف، أوض، غرفتين), baths, floor, finishing and price. Amounts next to مقدم or قسط are never taken as the price. Lines without a label also stay in the notes.

**Maps links in posts** are picked up: a Google Maps link anywhere in the post (`اللوكيشن: https://maps.app.goo.gl/…`) becomes the listing's location. Its numbers are never read as the price or size. `.listing edit 12 <Maps link>` adds one later.

For a messy post, `.listing add ai` (or reply with it) lets the configured AI read it. Its answer is checked before saving (known types only, numbers in sensible ranges), and anything the normal reader finds fills the gaps. It counts as one AI request. The bot answers with the listing number (#12) and how it read it. The AI gets only the property: an "المالك:" line is left out, and phone numbers in the post are replaced with "[رقم]". The bot still saves the owner from your text. `.adcopy` on a replied-to post masks phone numbers the same way.

**3. Photos**: send a photo with `.listing photo 12` as the caption, or reply to a photo with it (up to 10 per listing).

| Command | What it does |
|---|---|
| `.listing 12` | The listing with its first photo, price (and per m²), specs, status and your contact. `.listing 12 photos` sends all photos. |
| `.listings شقة التجمع 2m-4m` | Searches the available listings. Filters in any order: type (شقة، فيلا، دوبلكس، شاليه، محل، مكتب، أرض …), بيع/إيجار, a price range (`2m-4m`, `<3m`, `حتى 3 مليون`), rooms (`3 غرف`), and words from the location. `.listings all` also shows reserved and sold ones. |
| `.listing edit 12 السعر: 3.4 مليون` | Changes fields (several lines at once are fine). |
| `.listing status 12 محجوز` | available / reserved / sold / rented (متاح، محجوز، مباع، مؤجر). |
| `.listing del 12` | Deletes the listing and its photos. |
| `المالك: أبو أحمد 0100 123 4567` | A line in `.listing add` or `.listing edit` that saves the **owner** (name and number). The owner is **private**: it is never on the listing card, flyers, campaigns or anything a client sees. It shows as "🔑 المالك (خاص)" only when you or a sudo user look at the listing in your own chat with the bot, not in groups or clients' chats. It is in `.export listings` (column `owner`) and comes back with `.import`. |
| `.listing ask 12 [15 18]` | Asks each listing's owner on WhatsApp whether it is still available, with how to answer (متاح / اتباع / اتأجر / the new price). At most 5 at once. The answer is read automatically and you're told in the chat where you asked (see "How owners' answers are handled" below). |
| `.listing loc 12` | **Saves where the property is.** Reply with it to a WhatsApp location pin (📎 → Location) or to a Google Maps link, or write the link or the coordinates after it (`.listing loc 12 30.0444, 31.2357`). The card then shows "🗺️ الموقع على الخريطة" with a map link. `.listing loc 12 del` removes it. |
| `.listing 12 map` | Sends the listing's location as a WhatsApp pin that opens in the client's maps app. Anyone can ask for it. |
| `.listings near` | **The closest listings to a client.** When a client sends their location (or a Maps link), reply to it with `.listings near`. You get the available listings nearest first, with the distance to each ("📍 2.5 كم"). The usual search filters work (`.listings near شقة 2m-4m`), and `5 كم` limits the distance. Listings without a saved location are skipped; you are told how many. Clients can use it too. |
| `.flyer 12` | A ready-to-post image (1080×1350, the 4:5 size for Facebook and Instagram posts): the first photo, type, location, price, specs, status and your contact. |
| `.story 12` | A vertical 1080×1920 design that fills a WhatsApp status (9:16): the first photo, type, area, price (with the old price and a "خصم" badge after a recent cut), specs, a "للاستفسار أرسل: #12" box and your contact. Anyone can make one. |
| `.collage 12` | Up to 4 of the listing's photos in one 1080×1350 image, the first one top right, with "+3" on the last when there are more, and the details below. Needs at least 2 photos. |
| `.listing 12 en` / `.flyer 12 en` / `.story 12 en` | **In English**, for foreign buyers. These are translated: the type and sale/rent, the finishing (سوبر لوكس → Super lux), the floor (الرابع → 4th floor), the status, and the currency (جنيه → EGP). Common areas get their English names (التجمع الخامس، النرجس → "Fifth Settlement, New Cairo — El Narges"; also Sheikh Zayed, Maadi, Madinaty, New Capital, North Coast …). For other areas, add `Location EN: Mivida, New Cairo` to the listing. Notes are shown only if written in English. The flyer and story read left to right. A client can send **`#12 en`** to get the English card, which tells them to ask with `#12 en`. |
| `.watermark` | Reply to a photo: puts your name and phone (from `.agent`), or the text you write, on it. |
| `.adcopy 12` | The AI writes a marketing post for the listing: `short` for a status, `en` for English, `formal` for a formal tone. It's told to use only the listing's facts and your contact. Reply to any property description with `.adcopy` to write one for it. Needs an AI key; counts as one AI request. |
| `.installments 3.5m 10% 8 quarterly maint 8%` | A developer payment plan without interest: down payment (% or amount), the instalment (monthly, quarterly, semiannual or yearly, in English or Arabic: شهري، ربع سنوي، نصف سنوي، سنوي), the monthly equivalent, and the maintenance deposit. |
| `.mortgage 3.5m 20% 25% 15` | A bank loan: price, down payment %, yearly interest %, years → monthly payment, total paid, total interest. |
| `.ppm 3.5m 150` | Price per square metre. |
| `.roi 3.5m 25k` | Rental yield: yearly rent as % of the price, and years to recover it from rent. |

How owners' answers are handled:
- "متاح" / "ايوه لسه موجودة" → ✅ confirmed, and the listing counts as freshly updated, so it leaves the "not updated for 30+ days" list.
- "اتباعت" / "اتأجرت" → you're told, with `.listing status 12 sold` ready to send.
- "السعر بقى 2.8 مليون" → you're told the old and new price, with `.listing edit 12 السعر: 2.8 مليون` ready to send.
- Anything else is passed on to you as written.

The owner is thanked once. If the same owner has more than one open question and the reply doesn't say which (`#12 متاح`), it is passed on to you and the owner is asked to name the unit. A question stays open 7 days. Owners' answers are read even when the bot is in private mode. The morning summary suggests `.listing ask …` for stale listings that have an owner number.

### Getting listings to clients

| Command | What it does |
|---|---|
| `#12` | Anyone who sends a listing's number (as on its flyer, "للاستفسار أرسل: #12") gets the listing with its photo, in a group or a private chat. A note saved as `#12` with `.save` takes precedence. To stop floods, the same listing (or `#note`) is answered at most once per 30 seconds in a chat, and each person gets at most 5 answers a minute; extra requests are ignored silently. You and sudo users are not limited. |
| `.agent autoleads on` | When someone asks about a listing (`#12`) **in a private chat**, they are saved as a client (their WhatsApp name and number, the listing's type and sale/rent, source "واتساب") or, if already saved, the question is added to their history. You get a message: "🔔 عميل جديد: … سأل عن #12". Questions in groups, and from you or sudo users, are not captured. The same question from the same client is noted once a day, you get at most one 🔔 per client an hour, and at most 30 new clients are saved per hour (so a flood of numbers can't fill your list). |
| `.agent requests on` | Answers clients' written requests ("عايز شقة في التجمع …") with matching listings and saves them as clients. See below. |
| `.autolistings on 10:00` | **Listing of the day** in this chat: every day at that time, the next available listing as a flyer with its details, going round your catalogue. `.autolistings on 19:00 شقة التجمع` posts only matching ones; `.autolistings now` posts one right away; `.autolistings off` stops it. Shown in `.autos`. |
| `.brochure` / `.brochure شقة التجمع 2m-4m` | A PDF catalogue with one flyer page per available listing (up to 20), to send to a client. |
| `.export listings` / `.export leads` | Your listings or clients as a CSV file that opens in Excel or Google Sheets, Arabic included. Owner and sudo users. |
| `.market` / `.market شقة التجمع` | **Price per m² from your own listings**, by area and type: the median and the usual range (the middle half of the prices). Reserved and sold listings count, since their prices are real asking prices. For rent, the figure is the monthly rent per m². Takes the same filters as `.listings`. Owner and sudo users only. It is only as good as your catalogue, so it is not an official valuation. |
| `.market 12` | **Is a listing priced right?** It compares the listing's price per m² with similar ones (same type, sale or rent, and area) and says whether it is above or below their median, and by how much. It also gives the price range that puts it in the middle of the market. At least 3 similar listings with a price and size are needed. |
| `.compare 3 7` | **Listings side by side** (2 to 4): price, size, price per m², rooms, baths, floor, finishing and status. ✅ marks the best value (lowest price and price per m², largest size, most rooms). For two listings with saved locations, it also shows the distance between them. Anyone can use it. |
| `.offer 12 #5 10% 8 quarterly` | **A price offer as a PDF** for client #5. It contains their name, the property, the price and the payment plan, then every instalment with its date (the down payment on signing, then each quarter), and the listing's flyer as the last page. The amounts add up exactly to the price. The offer is valid for 7 days. `.offer 12` alone is a cash offer. The plan is written like `.installments`: down payment (% or amount), years, `monthly`/`quarterly`/`yearly` (or شهري، ربع سنوي، سنوي) and `maint 8%`. Add `send` to send the PDF to the client on WhatsApp; it is noted in their history. Owner and sudo users. |

**`.agent requests on`: answering clients' written requests.** When someone writes what they want in a private chat, e.g. "عايز شقة في التجمع 3 غرف ميزانية من 2 ل 3 مليون", "عندك فيلا في الشيخ زايد؟" or "محتاج شقة إيجار في المعادي حدود 15 ألف":
- they get up to 3 matching available listings (within budget first), with "أرسل رقم العقار للتفاصيل والصور";
- if nothing matches, they get "وصلني طلبك … وهتواصل معاك أول ما يتوفر";
- the request is saved: a new client is added (name, number, what they want, source "واتساب"), or an existing client's wishes are updated with the details they mentioned;
- you get "🔔 طلب من عميل جديد: … 🔎 شقة، في التجمع، 3 غرف …" with the listings that were sent.

A message counts as a request only if it names a property type **and** asks. Words like عايز، محتاج، مطلوب، أريد or "looking for" always count, and so does a question mark. فيه، عندك and حد عنده count only when the message doesn't look like an offer: an asking price (بسعر، السعر، المطلوب), a down payment or instalments, or a size in متر. So "فيه شقة في التجمع؟" and "حد عنده شقة إيجار في المعادي" are answered. Broker posts like "فيه شقة للبيع … 150 متر بسعر 3 مليون" and "يوجد شقة للبيع …" are not.

Each client gets at most one answer every 10 minutes; extra requests are ignored silently. The 30-new-clients-an-hour limit is shared with `autoleads`. Groups, you, sudo users, and private mode are never answered.

### Developers' projects (مشروعات المطورين)

New units sold off-plan, on a payment plan. They are numbered **P1, P2 …** to tell them apart from resale listings (#12). Anyone can view them; the owner and sudo users manage them.

```
.project add
المشروع: ماونتن فيو آي سيتي
المطور: ماونتن فيو
المنطقة: التجمع الخامس
الوحدات: شقق من 120 لـ 200 م، تاون هاوس، فيلات
يبدأ من: 6.5 مليون
المقدم: 10%
التقسيط: 8 سنوات
الاستلام: 2028
الصيانة: 8%
```

The bot reads several things from these lines:
- the unit types and sizes, from الوحدات;
- "بدون مقدم" as 0% down;
- "96 شهر" as 8 years;
- "فوري" or "جاهز" as ready to move in.

Lines without a label are kept as notes. After saving, it tells you which plan details are missing.

| Command | What it does |
|---|---|
| `.project 3` | The project, with the instalment worked out for the cheapest unit, e.g. "≈ 182,813 جنيه ربع سنوي (≈ 60,938 شهرياً) بعد مقدم 650,000 — لأقل وحدة". You and sudo users also see which clients it suits. |
| `.projects التجمع حتى 8 مليون مقدم 10% 8 سنين` | Search, cheapest first. Filters: words from the name, developer or area; a unit type; `حتى 8 مليون` (starting price); `مقدم 10%` (at most); `8 سنين` (at least); `فوري` (ready). |
| `.project edit 3 المقدم: 5%` / `.project del 3` | Change or delete. |

**Matching:** a client's card (`.lead 5`) lists the projects that suit them (area, unit type, a starting price within their budget). With `.agent requests on`, a client's written request is also answered with up to 2 suitable projects, even when no resale listing matches. Clients who want to rent are never offered projects.

### Brokers' groups (جروبات السماسرة)

If you're in WhatsApp groups where brokers post offers and requests, the bot can read them for you. Send **`.watch on`** in such a group (owner and sudo users). From then on, other members' posts are read:

- **Offers**: a property with a price and an area or size, e.g. "للبيع شقة في التجمع الخامس 150 متر 3 غرف بسعر 3.2 مليون". They are saved in your **feed**. If one suits a saved client, you get a private message: "🔔 عرض في "جروب السماسرة" يناسب 2 من عملائك: #3 أحمد، #7 منى" with the offer and the broker's name and number.
- **Requests** (someone looking, e.g. "مطلوب شقة في التجمع 3 غرف حدود 3 مليون"). If you have matching listings, you get "🔔 طلب في …: … 🏠 عندك 2 مناسب: #1، #4", a chance to co-broker.

The bot never writes in a watched group. Your own posts and sudo users' posts are skipped, as are greetings and chatter. A post repeated within a week (even with other emoji or spacing) counts once. Posts are kept 30 days, at most 2,000. You get at most 20 alerts an hour.

| Command | What it does |
|---|---|
| `.watch on` / `.watch off` | In a group: start or stop reading it. `.feed groups` lists the watched groups. |
| `.feed` / `.feed شقة التجمع 2m-4m` | Brokers' offers from the last 30 days, with the `.listings` filters. 🎯 shows how many of your clients each one suits. |
| `.feed requests` | What brokers are looking for, and how many of your listings match each request. |
| `.feed 12` | The full post, the group, the broker's name and number, and which clients it suits (or which listings match). |
| `.feed add 12` | Copies an offer into your catalogue as a new listing. Its notes say it's shared with that broker ("مشاركة مع السمسار …"). |

### Rentals (الإيجارات)

For the rented units you manage. Owner and sudo users only.

```
.rental add
العقار: 12
المستأجر: أحمد
الموبايل: 01001234567
الإيجار: 15 ألف
يوم الاستحقاق: 5
من: 1/1/2026
المدة: سنة
التأمين: 30 ألف
```

Use `الوحدة: شقة الدقي ش التحرير` instead of `العقار:` for a unit that isn't in your catalogue. The contract end can be given as `إلى: 2026-12-31` instead of `المدة`; without either, it runs for a year. Dates can be written as 2026-01-01 or 1/1/2026 (day first). A linked listing that is available is marked rented.

| Command | What it does |
|---|---|
| `.rentals` | This month: who has paid, who is due (and in how many days), who is late; the amount collected out of the total; earlier unpaid months; contracts ending within 60 days. |
| `.rental 3` | One rental: tenant, rent and due day, contract dates with the days left, deposit, this month's state, unpaid months and the latest payments. |
| `.rental paid 3` | Marks this month paid (the full rent). `.rental paid 3 سبتمبر 14 ألف` records another month (a name, a number, or 2026-09) and amount. `.rental unpaid 3 سبتمبر` removes a payment entered by mistake. |
| `.rental remind 3` | Sends the tenant a polite reminder now, with the month, the amount and the due date (or how many days late), and your contact. |
| `.rental auto 3 on` | Reminds the tenant automatically on the due day and then every 3 days while late (up to 15 days), between 10:00 and 21:00, at most once a day. It stops as soon as the month is marked paid. |
| `.rental renew 3 الإيجار: 17 ألف` | Extends the contract by a year (or `المدة: 6 شهور`, or `إلى: …`). An optional new rent is shown with the % change. |
| `.rental edit 3 الموبايل: 0100…` / `.rental del 3` | Changes fields or deletes the rental. Deleting reminds you to set the listing back to available. |

**In the morning summary (`.digest`):** rent due today, 🔴 late rents, ⚠️ earlier months still unpaid, and 📄 contracts ending within 60 days ("جدّد أو جهّز إعادة التسويق").

Unpaid months are counted from the month a rental was added to the bot. A contract that was already running is not shown as owing for the months before.

### Clients (العملاء)

A small client tracker for the owner and sudo users. Clients' details are never shown to anyone else.

**Save a client** with labelled lines (or forward the client's **contact card** to the bot and reply to it with `.lead add`: the name and number are filled in):
```
.lead add
الاسم: أحمد محمد
الموبايل: 0100 123 4567
الميزانية: 2-3 مليون
النوع: شقة
المنطقة: التجمع
الغرف: 3
المصدر: فيسبوك
عايز تسليم قريب
```
A sentence works too: "أحمد 01001234567 عايز شقة في التجمع 3 غرف ميزانية من 2 ل 3 مليون". The budget is read only after ميزانية / في حدود / لحد / حتى / budget, or as a range "من … ل …". Local numbers (0100…) are saved in international form using your own country code, and the same number can't be saved twice. Budgets can be written as "2-3 مليون", "من 2 إلى 3 مليون", "حتى 3 مليون" or "800 ألف - 1.2 مليون".

| Command | What it does |
|---|---|
| `.lead 5` | The client's card: what they want, budget, source, status, follow-up, the last notes, and **the listings that match** (within budget first; up to 10% over is shown with ⚠️). |
| `.lead note 5 <text>` | Adds a dated note to the history. |
| `.lead status 5 viewing` | new 🆕 · contacted 📞 · viewing 👀 · negotiating 🤝 · won ✅ · lost ❌ (Arabic works too: معاينة، تفاوض …). |
| `.lead follow 5 tomorrow at 10am <note>` | Reminds you in this chat to follow up (`2h`, `friday at 18:00` … like `.remind`). `.lead follow 5 off` cancels it. There is no limit on the number of clients with follow-ups. |
| `.lead send 5 12` | Sends listing #12 (photo and details, with a greeting by name) to the client's WhatsApp, notes it in the history, and moves a new client to "contacted". |
| `.lead edit 5 الميزانية: 3-4 مليون` / `.lead del 5` | Change or delete. |
| `.leads` | The pipeline (how many in each stage), upcoming follow-ups and the latest clients. `.leads viewing` filters by status; `.leads التجمع` or `.leads 0100` searches names, numbers, areas and notes. |
| `.listing match 12` | The clients a listing suits. `.listing add` also says right away which saved clients a new property suits. |
| `.leads hot` | **Who to call first**: up to 10 active clients by score, each with its reasons. Points come from the stage (negotiating 40, viewing 30, contacted 15, new 10), a viewing in the next 7 days (+25), a message from them in the last 2 days (+20) or 7 days (+10), a follow-up due today or late (+10), listings within their budget (+5 each, up to 3), and a known budget (+5). Points are taken off for no reply 3+ days after you sent a listing (−10) and no contact for 14+ days (−15). Clients who closed, dropped out or sent وقف aren't listed. The top 3 are also in the morning summary. |
| `.lead won 5 #12 3.1m 2.5%` | **A closed deal**: the client becomes "won", the listing sold (or rented), and the deal is kept with its price and commission (a rate like `2.5%`, or `عمولة 80 ألف`). Without a price, the listing's price is used. A client can close more than one deal. |
| `.deals` | Deals this month: count, total value and commission, the change from last month, each deal, and the clients' sources. `.deals last` shows last month, `.deals 2026-09` a given month, `.deals 2026` a year by month. |

| `.viewing add 5 12 tomorrow at 4pm` | Books a viewing of listing #12 with client #5. You get a reminder here an hour before. Add `send` (or ابعت) to send the client a confirmation with the date, time and your contact. The client moves to "viewing" and the booking is noted in their history. `.viewings` lists the upcoming ones; `.viewing del 3` cancels. |
| `.viewing done 3 liked` | **How the viewing went**: `liked` (أعجبه), `thinking` (بيفكر) or `no` (لم يعجبه), optionally with a note: `.viewing done 3 liked عايز يتفاوض على السعر`. It goes into the client's history. A client who liked it moves to "negotiating" (never backwards), and the reply suggests the next step (an offer, a follow-up, other listings). Two hours after each viewing, the bot asks you in the booking chat ("📝 كيف كانت المعاينة؟"). Viewings without an outcome are listed in `.viewings` and in the morning summary, and kept for 7 days so you can still record them. |
| `.viewings ics` | Your upcoming viewings as a calendar file (`viewings.ics`). Open it on your phone or in Google Calendar or Outlook to add them all, each with the address, the client's number and a reminder an hour before. |
| `.commission 3.5m 2.5% vat 14% share 50%` | Brokerage commission: price × rate, optional VAT on the commission and your share when it is split. |

| `.lead assign 5 @colleague` | For an office: gives client #5 to a team member (the owner or a sudo user), or `me`, or `none`. Follow-up reminders mention them too. `.leads mine` lists the clients assigned to you. |
| `.digest on 08:30` | **Morning summary** in this chat (e.g. your private chat with the bot): today's viewings and follow-ups (overdue ones too), new clients from the last 24 hours, 💬 clients who replied to a listing you sent in the last 24 hours, 📭 clients who haven't replied 2–14 days after you sent them one, active clients nobody has contacted for 7+ days, and the catalogue counts. `.digest now` shows it now; `.digest off` stops it. |
| `.import listings` / `.import leads` | Reply to a **CSV file** to add many listings or clients at once, e.g. your existing Excel sheet saved as "CSV UTF-8", or a file made with `.export`. Headers can be English (`type, deal, location, price, size, rooms, baths, floor, finishing, status, notes`; for clients `name, phone, type, location, rooms, budget_min, budget_max, source, status`) or Arabic (النوع، الغرض، المنطقة، السعر، المساحة، الغرف، الحالة، الاسم، الموبايل، الميزانية …). Duplicates are skipped (listings: same type, deal, price, size and location; clients: same number), and the reply lists the skipped rows by their spreadsheet row number. Up to 1,000 rows; .xlsx files must be saved as CSV first. |
| `.import leads` on a **Facebook / Instagram lead-ads file** | Imports leads from your ads as clients, with their platform, the ad and the form answers. See below. |

**Facebook / Instagram lead ads:** Download the leads from Meta's Leads Center or Ads Manager (the CSV as it comes: UTF-16, tab-separated) and reply to it with `.import leads`. Each lead becomes a client:
- name, and number (Meta's "p:" prefix removed; a local number takes your country code);
- source **فيسبوك** or **إنستجرام** from the platform, and the ad's name, shown on the card as "إعلان: …";
- the form's answers: a question about budget (ميزانية/budget) gives the budget, area (المنطقة/location) the area, unit type the type, rooms the rooms, buy/rent the deal;
- every answer, the e-mail and the date are kept in the notes.

A number that's already a client is skipped. The reply says how many new clients already have matching listings. `.restats` then shows **📢 حسب الإعلان**: clients and deals per ad, so you see which ad brings buyers.

`.listing add` also warns when the property looks already saved ("⚠️ This looks like #7").

**`.restats`: marketing report** (owner and sudo users):
- the listings clients ask about most: 👀 views, ❓ inquiries, 📤 sent to clients, 📢 posted as listing of the day;
- available listings nobody has asked about;
- price cuts in the last 30 days;
- listings not updated for 30+ days;
- clients by source (فيسبوك، واتساب، إحالة …), with how many from each closed a deal;
- 📬 the reply rate: of the clients you sent a listing to, how many wrote back;
- the overall conversion and the average days from first contact to a deal.

Views by you and your team are not counted.

**Who replied:** when a saved client writes to the bot in a private chat, the bot notes it. This is passive: it never answers, and it works in private mode too.
- The first message after you sent them a listing is added to their history ("ردّ بعد إرسال العقار #12").
- Their card shows "📤 آخر إرسال: #12 … (لم يرد بعد)" until they answer, and "💬 آخر رسالة منه" with the time.
- A message also counts as contact, so the client drops off the "no contact for 7+ days" list.

Listings count as sent when they go out by `.lead send`, `.offer … send`, a campaign, or an automatic answer to a request (`.agent requests on`). Campaigns don't resend any of them. "وقف" and "اشتراك" are not counted as replies. At most one note is written per client every 10 minutes.

**Price cuts:** every price change is remembered. For 30 days after a cut, the listing card shows "📉 كان 3,600,000 جنيه — خصم 11%", and the flyer gets a "خصم 11%" badge with the old price struck through. The morning summary also lists listings not updated for 30+ days, so you can check they are still available.

When you lower a listing's price with `.listing edit`, the reply shows the cut in % and the clients whose budget the listing now fits (it didn't before, or it was over their budget).

### Automatic replies in private chats

For a number you use for business (owner only):
- **`.greet on <message>`**: a welcome the first time someone ever writes to you, e.g. "أهلاً بك في دار للتسويق العقاري 🏡 أرسل #رقم العقار لتفاصيله". People who wrote before it was turned on aren't greeted. The bot remembers who was greeted as one-way fingerprints, not phone numbers.
- **`.awaymsg on <message>`** (also `.offhours`): a reply outside your working hours, set with `.awaymsg hours 10:00-22:00` (or always, without hours). Each person gets it at most once every 12 hours.
- Neither answers in groups, to you or sudo users, to commands, or to a message already answered (e.g. `#12`). If both apply to someone's first message, they get one message.

**Times in Arabic:** `.lead follow`, `.viewing add` and `.remind` understand "بكرة الساعة 4 م", "غداً 16:00", "يوم الجمعة 6 مساءً", "الخميس 10ص", "بعد ساعتين", "بعد 3 أيام", "بعد نص ساعة", "النهارده 9 مساءً" and "كل يوم 8 ص" (for `.remind`). The text after the time is kept as written.

**About `.lead send`:** it messages from the bot's WhatsApp number. Use it for clients who asked you. WhatsApp restricts numbers that send to many people who never wrote to them first.

**Campaigns (`.blast`): a new listing to every client it suits.**

| Command | What it does |
|---|---|
| `.blast 12` | Shows who listing #12 would go to (the saved clients it suits by type, sale/rent, area, budget and rooms) and how long sending would take. Nothing is sent yet. |
| `.blast 12 go` | Starts sending. Each client gets the listing with its photo, greeted by name. The message ends with "للاستفسار رد على الرسالة أو أرسل: #12" and "لإيقاف رسائل العروض أرسل: وقف". You get a summary in the same chat when it's done. |
| `.blast 12 drop` / `.blast 12 drop go` | **Price-drop campaign**, after you lower a listing's price (within the last 30 days). It goes to every client whose budget the new price fits, including those who got the listing before at the old price, which a normal campaign skips. The message starts with "📉 نزل سعره! العقار اللي بعتهولك قبل كده — بقى 3.2 مليون بدل 3.6 مليون جنيه (خصم 11%)", then the card. A client is told once per price; a further cut is news again. The campaign stops if the price goes back up. After `.listing edit` lowers a price, the reply suggests this command. |
| `.campaigns` | Running and finished campaigns, with how many were sent, failed and skipped. |
| `.blast stop 3` | Stops campaign #3. |
| `.blast limit 30` / `.blast hours 11:00-20:00` | The daily cap (1–100, default 40) and sending hours (default 10:00–21:00, in the bot's time zone). |

To keep your number safe, campaigns:
- send one message at a time, with a random 45–90 second gap;
- send only during the sending hours;
- stop for the day at the daily cap, which counts all campaigns together.

A client is skipped if:
- they already got that listing (from a campaign, `.lead send` or `.offer … send`);
- they have no phone number;
- they asked to stop.

A campaign also stops by itself if the listing is reserved, sold or deleted.

**Opt-out:** a saved client who sends **وقف** (or "stop") in a private chat gets "✅ تم إيقاف رسائل العروض". From then on, no campaign, `.lead send` or `.offer … send` reaches them, and their card shows 🚫. Sending **اشتراك** turns offers back on. This works even when the bot is in private mode. Messages from numbers that aren't saved clients, and repeats, get no reply.

**Welcoming new clients (`.leads welcome`):** after importing leads from your ads (or adding clients), `.leads welcome` shows who would get a welcome and the first message in full. It goes to clients still "new" who have a number, haven't been contacted (nothing sent to them yet) and haven't said وقف, oldest first. `.leads welcome go` sends them, paced like campaigns: one every 45–90 s, in your sending hours, within the daily cap. You get a summary when it's done.

The default welcome, for example:
- "أهلاً منى 👋 شكراً لاهتمامك بإعلان "شقق التجمع". معاك أحمد من دار السكن. لسه بتدور على شقة، في التجمع، 2 مليون – 3 مليون جنيه؟ قولي المنطقة والميزانية …";
- then the best matching listing, if there is one ("🏠 عندي حالياً: #1 … للتفاصيل والصور أرسل: #1");
- then the opt-out line.

Set your own wording with `.agent welcome <text>`, using {name}, {ad}, {wish} and {agent}. `.agent welcome` with nothing after it goes back to the default. Each welcomed client is noted ("أُرسلت له رسالة ترحيب") and moves to "contacted". Their reply is tracked ("ردّ على رسالة الترحيب") and shows in the morning summary. A client you contact yourself before their turn is skipped. `.campaigns` shows the progress, and `.blast stop <number>` stops it.

Send campaigns only to people who asked you about property. WhatsApp can still restrict a number whose messages many people report or block.

The calculations are illustrations, not offers or financial advice; the replies say so. Photos are stored on the server in `DATA_DIR/listings/`. `.backup` holds the listings' text, and `.backup photos` the photos (see [Backup and restore](#backup-and-restore)).

## Everyday tools

| Command | What it does |
|---|---|
| `.tz 15:00 Cairo to London` | Converts a time between two cities, with daylight saving time. `.tz Riyadh Paris` compares the current time. Also `9am New York to Tokyo`. |
| `.days 2026-12-31` | Days until (or since) a date, in years/months/days and weeks. `.days 01/01/2026 31/12/2026` gives the days between two dates, and `.days +90` / `.days -30` the date that many days from today. `.age 2000-05-14` is still there for ages and birthdays. |
| `.color #1e90ff` | A picture of the colour with its HEX, RGB and HSL codes, and whether black or white text reads better on it (WCAG contrast). Accepts `#09f`, `rgb(255,99,71)` and names like `orange`. Drawn on the server. |
| `.topdf` | Turns a picture into a PDF (A4, portrait or landscape to match the picture): send it with `.topdf` as the caption, or reply to it. For several pages: `.topdf add` on each picture, then `.topdf done` (up to 20; `.topdf cancel` discards them). Made on the server. |
| `.ocr` | Reads the text in a picture (screenshot, document, sign; any language, handwriting too) and sends it as text you can copy. Uses the configured AI (counts as one AI request). |
| `.cal` / `.cal dec 2026 sat` | A month calendar with today marked. Weeks start on Monday; add `sun` or `sat` for Sunday or Saturday. Shows the Hijri months it spans. |
| `.split 450 3 10%` | Splits a bill between people, with an optional tip. The shares always add up to the total exactly; when it doesn't divide evenly, it says who pays the extra cent. |
| `.smeme top \| bottom` | Makes a meme from the picture you send or reply to: big white text with a black outline. `.smeme \| bottom only` for the bottom only. Arabic works. Made on the server. |
| `.dns example.com` | The domain's DNS records: addresses (A/AAAA), CNAME, mail servers (MX), name servers (NS) and TXT (SPF, verification …). |
| `.ssl example.com` | The site's HTTPS certificate: whether it is trusted, who issued it, the names it covers and when it expires (warns 14 days before). |
| `.up example.com` | Whether a website answers, with the HTTP status and response time, and where it redirects. |
| `.whois wikipedia.org` | Domain registration info: registration and expiry dates, registrar, status and name servers, from RDAP (the registries' official data). Accepts a link or an email address too. |

## To-do list

`.todo add Book the hall` adds a task to this chat's shared list, and `.todo` shows it with numbers.
- Anyone can add tasks and tick them off: `.todo done 2` (send it again to un-tick).
- The person who added a task, or an admin, can delete it with `.todo del 2`.
- Admins can remove finished tasks with `.todo clear`, or everything with `.todo clear all`.
- In a private chat with the bot, the list is yours. Up to 50 tasks per chat.

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
| `.cal` | `.calendar` `.month` | A month calendar with today marked. Weeks start on Monday; add "sun" or "sat" to start on Sunday or Saturday. Also shows the Hijri months it spans. | everyone | `.cal` |
| `.calc` | `.calculate` `.math` | Calculates a maths expression: + - * / % ^ !, brackets, sqrt, sin/cos/tan (degrees), log, ln, abs, round, min, max, pi, e. | everyone | `.calc (12+8)*3/4` |
| `.color` | `.colour` `.hex` `.rgb` | Shows a colour as a picture with its HEX, RGB and HSL codes, and whether black or white text reads better on it (WCAG contrast). Drawn on the server. | everyone | `.color #1e90ff` |
| `.currency` | `.convert` `.cur` `.exchange` | Converts money between currencies with today's exchange rate. | everyone | `.currency 100 usd egp` |
| `.days` | `.countdown` `.daysuntil` `.datecalc` | Date calculator: days until or since a date, between two dates, or the date N days from today (in the bot's time zone). | everyone | `.days 2026-12-31` |
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
| `.split` | `.bill` `.splitbill` | Splits a bill between people, with an optional tip; the shares always add up to the total exactly. | everyone | `.split 450 3` |
| `.toaudio` | `.tomp3` `.mp3convert` | Extracts the sound of a video (or converts a voice note/audio file) to an MP3 you can play or save. _Needs: ffmpeg._ | everyone | `.toaudio` _(reply to a video or audio)_ |
| `.todo` | `.tasks` `.todolist` `.mahamm` | A shared to-do list for this chat: anyone can add tasks and tick them off; the author or an admin can delete one, admins can clear the list. | everyone | `.todo add Buy the projector` |
| `.topdf` | `.pdf` `.img2pdf` | Turns pictures into a PDF document (A4, made on the server). One picture: send or reply to it with .topdf. Several pages: ".topdf add" on each picture, then ".topdf done" (up to 20 pages). | everyone | `.topdf` _(reply to a picture)_ |
| `.tovn` | `.toptt` `.tovoice` | Turns a video, song or audio file into a WhatsApp voice note. _Needs: ffmpeg._ | everyone | `.tovn` _(reply to a video or audio)_ |
| `.tz` | `.timezone` `.convert-time` `.timeconv` | Converts a time from one city to another (daylight saving included), or compares the current time in two cities. | everyone | `.tz 15:00 Cairo to London` |
| `.unit` | `.units` `.conv` | Converts units: length, weight, volume, area (incl. feddan), speed, temperature, data, time, energy. | everyone | `.unit 10 km to mi` |

### Real estate · عقارات

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.adcopy` | `.ad` `.elan` `.marketingpost` | يكتب إعلاناً تسويقياً للعقار بالذكاء الاصطناعي — writes a marketing post for a listing (or for the property text you reply to): a catchy WhatsApp post with emojis, features and your contact. Options: en (English), short (for status), formal. _Needs: ai._ | owner, sudo | `.adcopy 12` |
| `.agent` | `.broker` `.mybrand` | بياناتك كوسيط — your name, phone, company and currency, shown on listings, flyers and ads. "autoleads on" saves people who ask about a listing (#12) in a private chat as clients and tells you. "requests on" answers clients who write what they want ("عايز شقة في التجمع ميزانية 3 مليون") with the closest listings, saves the request and tells you. Owner and sudo users. | owner, sudo | `.agent name أحمد العقاري` |
| `.autolistings` | `.listingofday` `.dailylisting` | عقار اليوم — posts one available listing a day in this chat at the time you choose, as a flyer with its details, going round your catalogue. Add a search to post only some (e.g. شقة التجمع). Owner and sudo users. | owner, sudo | `.autolistings on 10:00` |
| `.blast` | `.tarweej` `.sendmatch` `.hamla3qar` | حملة إرسال عقار — sends a listing to every saved client it suits (type, sale/rent, area, budget, rooms), one at a time: a random 45–90 s gap, only 10:00–21:00, at most 40 a day across all campaigns, so your number isn't flagged as spam. Clients who already got the listing or sent "وقف" are skipped; every message tells them how to stop. Shows the list first; "go" starts it. "drop" after a price cut tells every client the new price fits, including those who had it before (once per price). Owner and sudo users. | owner, sudo | `.blast 12` |
| `.brochure` | `.catalog` `.catalogue` `.katalog` | كتالوج PDF — a PDF with one flyer page per available listing (up to 20), optionally only those matching a search, ready to send to a client. | everyone | `.brochure` |
| `.campaigns` | `.blasts` `.hamalat` | قائمة الحملات — your listing campaigns: running, finished and stopped, with how many were sent, failed and skipped. | owner, sudo | `.campaigns` |
| `.collage` | `.grid` `.photos4` `.kolaj` | كولاج صور العقار — one 1080×1350 image with up to 4 of the listing's photos ("+3" when there are more) and the details panel: type, area, price, specs and your contact. Made on the server. | everyone | `.collage 12` |
| `.commission` | `.omola` `.brokerage` | حساب العمولة — the brokerage commission on a deal: price × rate, optionally with VAT on the commission and your share when it is split with another broker or the office. | everyone | `.commission 3.5m 2.5%` |
| `.compare` | `.qarn` `.moqarna` `.vs` | مقارنة العقارات — 2 to 4 listings side by side: price, size, price per m², rooms, baths, floor, finishing and status, with the best value marked, and the distance between two listings when both have a location. | everyone | `.compare 3 7` |
| `.deals` | `.sales` `.safaqat` `.revenue` | الصفقات والعمولات — the deals you closed (.lead won): this month by default, "last" for last month, a month (2026-09) or a year (2026). Count, total value and commission, compared with the period before, each deal, and by client source. Owner and sudo users. | owner, sudo | `.deals` |
| `.digest` | `.summary-day` `.dailybrief` `.molakhas` | ملخص اليوم — a morning summary in this chat at the time you choose: today's viewings and follow-ups, new clients, who replied to what you sent and who went quiet after it, clients without contact for a week, rent due and late, contracts ending soon, and the catalogue. Owner and sudo users. | owner, sudo | `.digest on 08:30` |
| `.export` | `.csv` `.excel` | تصدير إلى Excel — your listings or clients as a CSV file that opens in Excel or Google Sheets (Arabic included). Owner and sudo users. | owner, sudo | `.export listings` |
| `.feed` | `.brokerfeed` `.souk` | عروض وطلبات السماسرة — brokers' offers and requests from the groups you watch (.watch on), last 30 days: search offers with the .listings filters, "requests" for what brokers are looking for, a number for the full post and the broker's number, "add" to copy an offer into your catalogue as a shared listing. Owner and sudo users. | owner, sudo | `.feed` |
| `.flyer` | `.poster` `.bostar` | صورة إعلان جاهزة للنشر — a ready-to-post image (1080×1350, the 4:5 size for Facebook and Instagram posts; for WhatsApp status use .story) of a listing: its first photo, type, location, price, specs and your contact. “en” makes it in English for foreign buyers. Made on the server. | everyone | `.flyer 12` |
| `.import` | `.importcsv` | استيراد من Excel — reply to a CSV file (an Excel sheet saved as CSV, or a file from .export) to add listings or clients in one go. Column headers in English (type, location, price …) or Arabic (النوع، المنطقة، السعر …). Also reads Facebook/Instagram lead-ads downloads as they are (UTF-16, tab-separated): each lead gets its platform as the source, the ad's name, and the form's answers (budget, area, unit type). Duplicates are skipped. Owner and sudo users. | owner, sudo | `.import listings` _(reply to listings.csv)_ |
| `.installments` | `.aqsat` `.plan` `.paymentplan` | حساب الأقساط — a developer payment plan without interest: down payment, then monthly/quarterly/half-yearly/yearly installments, plus an optional maintenance deposit. | everyone | `.installments 3.5m 10% 8 quarterly maint 8%` |
| `.lead` | `.client` `.customer` `.ameel` | متابعة العملاء — a client tracker: save a client (labelled lines, or reply to a shared contact card), their budget and what they want; notes, pipeline status, follow-up reminders, the listings that match, and sending a listing to them on WhatsApp. Owner and sudo users. | owner, sudo | `.lead add
الاسم: أحمد
الموبايل: 01001234567
الميزانية: 2-3 مليون
النوع: شقة
المنطقة: التجمع` |
| `.leads` | `.clients` `.customers` `.pipeline` | قائمة العملاء — your clients: the pipeline (how many in each stage) and the latest ones; filter by a status (new, viewing …), "mine" (assigned to you), or search by name, number, area or notes. "hot" ranks who to call first: stage, a viewing coming up, a recent message, a follow-up due, listings in their budget, minus going quiet. Owner and sudo users. | owner, sudo | `.leads` |
| `.listing` | `.property` `.aqar` | عقاراتك في كتالوج واحد — your property catalogue: add a listing from a description (Arabic or English labels, or reply to a broker's post), attach photos, show it with its photos and your contact, save its location on the map (from a location pin or a Google Maps link), mark it reserved/sold. Anyone can view; the owner and sudo users manage. | everyone | `.listing add
النوع: شقة
للبيع
المنطقة: التجمع الخامس
السعر: 3.5 مليون
المساحة: 150
الغرف: 3` |
| `.listings` | `.properties` `.aqarat` | البحث في العقارات المتاحة — searches the available listings. Filters in any order: a type (شقة، فيلا …), بيع/إيجار, a price range ("2m-4m", "<3m", "حتى 3 مليون"), rooms ("3 غرف"), and any words from the location. "all" includes reserved and sold. "near" (replying to a client’s location pin or a Maps link) lists the closest listings with the distance to each, optionally within a radius ("5 كم"). | everyone | `.listings` |
| `.market` | `.prices` `.areastats` `.souq` `.pricing` | أسعار السوق من كتالوجك — price per m² from your own listings (including reserved and sold): by area and type, the median and the usual range, with the same filters as .listings. ".market 12" compares a listing with similar ones and suggests the price range that puts it mid-market. Owner and sudo users. | owner, sudo | `.market` |
| `.mortgage` | `.loan` `.tamweel` | تمويل عقاري بفائدة — a bank mortgage: monthly payment, total paid and total interest (standard annuity formula). | everyone | `.mortgage 3.5m 20% 25% 15` |
| `.offer` | `.pricequote` `.ard` `.proposal` | عرض سعر PDF — a price offer for a listing as a PDF: the client's name, the property, the price and, with a payment plan (down payment, years, frequency, maintenance), every instalment with its date, plus the listing's flyer. Valid for 7 days. Add a client (#5) to put their name on it, and "send" to send it to them on WhatsApp (noted in their history). Owner and sudo users. | owner, sudo | `.offer 12` |
| `.ppm` | `.pricepermeter` `.meter` | سعر المتر — the price per square metre. | everyone | `.ppm 3.5m 150` |
| `.project` | `.compound` `.mashroo` | مشروعات المطورين — off-plan projects you sell: developer, area, unit types and sizes, starting price, down payment, instalment years, delivery and maintenance; the card works out the instalment for the cheapest unit. Anyone can view; the owner and sudo users manage. | everyone | `.project add
المشروع: ماونتن فيو آي سيتي
المطور: ماونتن فيو
المنطقة: التجمع الخامس
الوحدات: شقق من 120 لـ 200 م، تاون هاوس
يبدأ من: 6.5 مليون
المقدم: 10%
التقسيط: 8 سنوات
الاستلام: 2028` |
| `.projects` | `.compounds` `.mashareea` | البحث في مشروعات المطورين — searches the projects, cheapest first: words from the name, developer or area, a unit type (شقة، فيلا، تاون هاوس …), "حتى 8 مليون" (starting price), "مقدم 10%" (at most), "8 سنين" (at least), "فوري" (ready to move in). | everyone | `.projects` |
| `.rehelp` | `.dalil` `.reguide` `.aqarguide` | دليل أدوات العقارات بالعربي — a short Arabic guide to the real-estate tools, step by step, showing which steps you have already done. | owner, sudo | `.rehelp` |
| `.rental` | `.tenant` `.ijar` `.lease` | إدارة الإيجارات — the rentals you manage: tenant, monthly rent and due day, contract dates and deposit; record payments, see who is late and which months are unpaid, remind the tenant (now, or automatically on the due day and every 3 days while late, 10:00–21:00), and renew. The morning summary lists rent due and late, and contracts ending within 60 days. Owner and sudo users. | owner, sudo | `.rental add
العقار: 12
المستأجر: أحمد
الموبايل: 01001234567
الإيجار: 15 ألف
يوم الاستحقاق: 5
من: 2026-01-01
المدة: سنة` |
| `.rentals` | `.tenants` `.ijarat` `.leases` | الإيجارات هذا الشهر — your rentals: paid, due and late this month, the amount collected, unpaid earlier months, and contracts ending within 60 days. Owner and sudo users. | owner, sudo | `.rentals` |
| `.restats` | `.mystats` `.reportre` `.ihsaat` | تقرير التسويق — which listings clients ask about most (views, inquiries, sent, posted), recent price cuts, listings not updated for 30+ days, where your clients come from and how many of each source closed a deal, and the average days to a deal. Owner and sudo users. | owner, sudo | `.restats` |
| `.roi` | `.yield` `.aaed` | العائد من الإيجار — rental yield: yearly rent as a % of the price, and years to recover the price from rent (before costs and taxes). | everyone | `.roi 3.5m 25k` |
| `.story` | `.statusflyer` `.vertical` `.storyad` | تصميم للحالة (ستوري) — a 1080×1920 vertical design that fills a WhatsApp status (9:16): the listing's first photo, type, area, price (with a recent discount), specs, "للاستفسار أرسل: #12" and your contact. "en" makes it in English. Made on the server. | everyone | `.story 12` |
| `.viewing` | `.moaayna` `.visit` `.showing` | مواعيد المعاينة — book a viewing: a client, a listing and a time. You get a reminder an hour before (in this chat); add "send" to also send the client a confirmation on WhatsApp. The client moves to the viewing stage. Two hours after, you are asked how it went: "done" records it (liked moves the client to negotiating). Owner and sudo users. | owner, sudo | `.viewing add 5 12 tomorrow at 4pm` |
| `.viewings` | `.appointments` `.mawaeed` | المعاينات القادمة — upcoming viewings, soonest first (today's past ones too, with their outcome), the ones still without an outcome, and "ics": a calendar file of the upcoming ones for Google Calendar or your phone. Owner and sudo users. | owner, sudo | `.viewings` |
| `.watch` | `.brokergroup` `.rasd` | رصد جروب السماسرة — in a brokers' group: "on" makes the bot read other brokers' posts here. Offers (a property with a price) go into your feed (.feed); you get a private message when an offer suits your saved clients, or a request ("مطلوب شقة …") matches your listings. The bot never posts in the group. Reposts within a week are ignored; posts are kept 30 days. Owner and sudo users. | owner, sudo (groups) | `.watch on` |
| `.watermark` | `.wm` `.brand` | يضع اسمك ورقمك على صورة العقار — puts your name and phone (from .agent) or any text on a photo, so it carries your contact when shared. Send or reply to a picture. | everyone | `.watermark` _(reply to a photo)_ |

### Info & search

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.crypto` | `.price` `.btc` | Shows cryptocurrency prices and 24 h change (CoinGecko). Without a coin, the top 10. Information only — not financial advice. | everyone | `.crypto` |
| `.define` | `.dict` `.dictionary` `.meaning` | Looks up an English word: pronunciation, meanings, examples and synonyms. | everyone | `.define serendipity` |
| `.dns` | `.nslookup` `.dig` | Looks up a domain's DNS records: A/AAAA (addresses), CNAME, MX (mail), NS (name servers) and TXT (SPF, verification …). | everyone | `.dns example.com` |
| `.news` | `.headlines` | Latest headlines (Google News, no key needed), or news about a topic. Start with a country:language code for another region. | everyone | `.news` |
| `.ssl` | `.cert` `.tls` | Checks a website's HTTPS certificate: who issued it, whether it is trusted, and when it expires. | everyone | `.ssl example.com` |
| `.time` | `.clock` `.date` | Shows the current date and time in a city (or the bot's time zone). | everyone | `.time Tokyo` |
| `.up` | `.isup` `.ping-site` `.sitecheck` | Checks whether a website is answering, with the HTTP status and response time. | everyone | `.up example.com` |
| `.weather` | `.forecast` | Shows the current weather and a 3-day forecast for a city (no API key needed). | everyone | `.weather Cairo` |
| `.whois` | `.rdap` `.domain` | Domain registration info: when it was registered and expires, the registrar, status and name servers (RDAP, the official registry data). | everyone | `.whois wikipedia.org` |
| `.wiki` | `.wikipedia` | Shows the Wikipedia summary of a topic. Start with a language code for other Wikipedias (ar:, fr:, es: …). | everyone | `.wiki Great Pyramid of Giza` |

### Islamic · إسلاميات

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.asma` | `.asmaulhusna` `.names99` `.asmaallah` | من أسماء الله الحسنى — a name of Allah from al-Asma' al-Husna (random, by number 1-99, or "all"). | everyone | `.asma` |
| `.autoazkar` | `.dailyazkar` `.azkarauto` | يرسل أذكار الصباح والمساء تلقائياً كل يوم في هذه المحادثة، ودعاءً يومياً إن شئت — sends the morning and evening adhkar here every day, the adhkar before sleep if you set a time, and a random dua once a day or every few hours. Set a city to follow prayer times. Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on). | everyone | `.autoazkar on` |
| `.autohadith` | `.dailyhadith` | يرسل حديثاً عشوائياً مع شرحه كل عدد من الساعات (1–24) في هذه المحادثة، أولها فوراً — posts a random hadith here every N hours, the first right away. Quiet hours as for .autotafsir. | everyone | `.autohadith every 6` |
| `.autojumuah` | `.jumuah` `.friday` `.autofriday` | تذكير يوم الجمعة: آية الجمعة، وسورة الكهف، والصلاة على النبي ﷺ، وساعة الإجابة، كل جمعة في الوقت الذي تختاره — a Friday reminder every week at the time you choose (default 09:00). Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on). | everyone | `.autojumuah on` |
| `.autoprayer` | `.adhan` `.azan` `.prayeralert` | تنبيه بموعد كل صلاة من الصلوات الخمس في هذه المحادثة حسب مدينتك — announces each of the five prayers here, by your city's prayer times and time zone; "azkar on" also sends the adhkar after each prayer (25 minutes after the adhan by default). Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on). | everyone | `.autoprayer on Cairo` |
| `.autosiyam` | `.autosawm` `.autofasting` `.fastreminder` | تذكير مساء اليوم السابق بصيام السنة: الاثنين والخميس، والأيام البيض، وعرفة، وتاسوعاء وعاشوراء، والست من شوال — reminds this chat the evening before each sunnah fast (default 20:00). "weekly off" keeps only the white days and the special days. Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on). | everyone | `.autosiyam on` |
| `.autotafsir` | `.dailyayah` `.autoayah` `.ayahtafsir` | يرسل آية عشوائية مع تفسيرها (التفسير الميسر) كل عدد من الساعات في هذه المحادثة — posts a random verse with al-Tafsir al-Muyassar here every N hours (1–24); the first one right away. No automatic posts during quiet hours (default 23:00–07:00). Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on). | everyone | `.autotafsir on` |
| `.autowird` | `.dailywird` | الورد اليومي: يرسل كل يوم عدداً من صفحات المصحف بالترتيب حتى الختم ثم يبدأ ختمة جديدة — sends N mushaf pages a day in order until the Quran is completed, then starts again. Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on). | everyone | `.autowird on 2 20:00` |
| `.azkar` | `.adhkar` `.athkar` `.zikr` `.dhikr` | أذكار الصباح والمساء وغيرها من حصن المسلم — morning/evening adhkar and more from Hisn al-Muslim. Without a word: morning before noon, evening after. | everyone | `.azkar` |
| `.dua` | `.doaa` `.duaa` `.doa` `.dua2` | دعاء عشوائي من حصن المسلم، أو في موضوع معيّن — a random dua from Hisn al-Muslim, or on a topic (الكرب، الهم، الدين، الاستغفار …). | everyone | `.dua` |
| `.hadith` | `.hadeeth` `.hadis` | حديث نبوي عشوائي مع درجته ومصدره وشرح مختصر، من موسوعة الأحاديث النبوية — a random hadith with its grade, source and a short explanation (hadeethenc.com). | everyone | `.hadith` |
| `.hamla` | `.campaign` `.dhikrgoal` `.athkargoal` | حملة ذكر جماعية بهدف مشترك (مثل ١٠٬٠٠٠ استغفار): يضيف كل عضو ما قرأ بإرسال +100 — a group dhikr campaign with a shared goal; members add their count by sending "+100" (or .hamla 100). Presets: استغفار، صلاة، تسبيح، تهليل، تكبير، حوقلة, or any text. Starting or ending one follows ISLAMIC_ADMIN_ONLY like .autoazkar. | everyone (groups) | `.hamla new 10000 استغفار` |
| `.hijri` | `.hijridate` `.islamicdate` | التاريخ الهجري اليوم (تقويم أم القرى) — today's Hijri date (Umm al-Qura). | everyone | `.hijri` |
| `.hisn` | `.hisnmuslim` `.husn` | حصن المسلم: كل الأبواب (132)، أو باب برقمه أو بكلمة من عنوانه — browse all 132 chapters of Hisn al-Muslim by number or by a word. | everyone | `.hisn` |
| `.iftar` | `.suhoor` `.sohour` `.maghrib` | كم بقي على المغرب (الإفطار) وعلى الإمساك (السحور) في مدينتك — time left until Maghrib (iftar) and Imsak (suhoor) in a city. | everyone | `.iftar Cairo` |
| `.imsakiya` | `.imsakia` `.ramadantable` `.emsakeya` | إمساكية رمضان لمدينتك: الإمساك والفجر والمغرب لكل يوم من الشهر — the Ramadan timetable (Imsak, Fajr, Maghrib) for a city, for the current or next Ramadan. | everyone | `.imsakiya Cairo` |
| `.khatma` | `.khatmah` `.groupkhatma` | ختمة جماعية: يحجز كل عضو جزءاً من الثلاثين ويقرؤه ثم يعلن انتهاءه حتى تكتمل الختمة — a shared group khatma: members take one of the 30 juz', read it and mark it done. Starting or ending one follows the same rule as .autoazkar (anyone, unless ISLAMIC_ADMIN_ONLY is on). | everyone (groups) | `.khatma new` |
| `.prayer` | `.salah` `.salat` `.mawaqit` | Shows today's prayer times for a city and which prayer is next. | everyone | `.prayer Cairo` |
| `.qibla` | `.kibla` | اتجاه القبلة من مدينة — the Qibla direction from a city (degrees from north). | everyone | `.qibla Cairo` |
| `.qsearch` | `.searchquran` `.quransearch` `.bahth` | البحث عن كلمة في القرآن الكريم (بدون تشكيل)، أو في الترجمة الإنجليزية — searches the Quran for a word (Arabic, diacritics not needed) or the English translation (Sahih International). Add a page number at the end for more results. | everyone | `.qsearch الصبر` |
| `.quran` | `.ayah` `.ayat` | Shows a Quran verse in Arabic with an English translation; add "audio" for the recitation (Alafasy). Without a reference, a random verse. | everyone | `.quran 2:255` |
| `.quranquiz` | `.qquiz` `.musabaqa` `.whichsurah` | مسابقة قرآنية: من أي سورة هذه الآية؟ أول من يرسل رقم الإجابة الصحيحة يربح نقطة — a Quran quiz: which surah is this verse from? Four choices; the first right answer within 45 s wins a point, one try per person. ".quranquiz top" shows the leaderboard. | everyone | `.quranquiz` |
| `.ramadan` | `.occasions` `.eid` `.mawasim` | كم بقي على رمضان والعيدين ويوم عرفة وعاشوراء ورأس السنة الهجرية — countdown to Ramadan, the Eids and other Islamic occasions. | everyone | `.ramadan` |
| `.siyam` | `.sawm` `.fasting` `.siam` | أيام صيام السنة القادمة: الاثنين والخميس، والأيام البيض، وعرفة، وتاسوعاء وعاشوراء، والست من شوال — the coming sunnah fasting days (next 30 days), by the Umm al-Qura calendar, with the next Arafah and Ashura. | everyone | `.siyam` |
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
| `.delrules` | `.clearrules` | Removes this group's rules. | group admins (groups) | `.delrules` |
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
| `.rules` | `.grouprules` `.qawanin` | Shows this group's rules (set by admins with .setrules; also #rules). Without rules set, shows the group description. | everyone (groups) | `.rules` |
| `.setgdesc` | – | Changes the group description. The bot must be a group admin. | group admins (groups) | `.setgdesc Welcome to our study group` |
| `.setgname` | – | Changes the group name. The bot must be a group admin. | group admins (groups) | `.setgname Study Group` |
| `.setgpp` | – | Sets the group photo from the image or sticker you reply to. The bot must be a group admin. | group admins (groups) | `.setgpp` _(reply to an image)_ |
| `.setrules` | `.addrules` | Sets this group's rules (text, or reply to a message). Members see them with .rules or #rules; add {rules} to the .welcome message to greet new members with them. | group admins (groups) | `.setrules 1. Be respectful
2. No spam or ads
3. Stay on topic` |
| `.stopfilter` | `.delfilter` `.rmfilter` | Removes an auto-reply (".stopfilter all" removes every one). | group admins (groups) | `.stopfilter` |
| `.tag` | – | Sends your text (or re-sends the replied message) while silently mentioning everyone. | group admins (groups) | `.tag Meeting at 8 pm` |
| `.tagall` | – | Mentions every member, one per line. | group admins (groups) | `.tagall` |
| `.tagnotadmin` | – | Mentions every member who is not an admin. | group admins (groups) | `.tagnotadmin` |
| `.unban` | – | Allows a banned user to use the bot again. | owner, sudo | `.unban @201012345678` |
| `.unlock` | – | Lets every member change the group name, photo and description. The bot must be a group admin. | group admins (groups) | `.unlock` |
| `.unmute` | – | Lets everyone send messages again. The bot must be a group admin. | group admins (groups) | `.unmute` |
| `.warn` | – | Warns a member. They are removed automatically at WARN_LIMIT warnings (default 3). The bot must be a group admin. | group admins (groups) | `.warn @201012345678` |
| `.warnings` | – | Shows how many warnings a member has in this group. | everyone (groups) | `.warnings @201012345678` |
| `.welcome` | – | Welcome messages when members join. Variables: {user}, {group}, {description}, {count}, {rules} (from .setrules). | group admins (groups) | `.welcome on` |

### Owner

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.anticall` | – | Rejects incoming calls and blocks the caller. | owner | `.anticall on` |
| `.antidelete` | – | When someone deletes a message, sends you a copy (kept for 24 h, limited size). | owner | `.antidelete on` |
| `.autoreact` | `.areact` `.autoreaction` | Reacts with ⏳ to every command message. | owner | `.autoreact on` |
| `.autoread` | – | Marks every incoming message as read (except ones that mention the bot). | owner | `.autoread on` |
| `.autostatus` | – | Automatically views contacts' statuses, and optionally reacts to them with 💚. | owner | `.autostatus react on` |
| `.autotyping` | – | Shows a 'typing…' indicator when the bot receives messages. | owner | `.autotyping on` |
| `.awaymsg` | `.offhours` `.outofoffice` | رد تلقائي خارج مواعيد العمل — an automatic reply to private messages from others, outside your working hours (or always), at most once per person every 12 hours. Groups, you and sudo users are never answered. | owner | `.awaymsg on شكراً لتواصلك 🙏 مواعيد العمل من 10 ص إلى 10 م وسنرد عليك أول ما نتاح.` |
| `.backup` | – | Sends you a backup file of all bot settings and lists (mode, sudo, bans, group settings, notes, reminders, levels, listings, clients …) to restore later with .restore. ".backup full" also includes API keys set from chat and saved cookies; ".backup photos" sends the listing photos as a .tar.gz. The WhatsApp session is never included. | owner (private chat) | `.backup` |
| `.block` | – | Blocks someone on the bot's WhatsApp account (they can't message or call it). Mention them, reply to them, or give the number. | owner | `.block` |
| `.clearsession` | `.clearsesi` | Deletes cached encryption key files from the session folder (keeps creds.json). Only for fixing persistent 'waiting for this message' errors; restart the bot afterwards. | owner | `.clearsession confirm` |
| `.cleartmp` | – | Deletes leftover temporary files. | owner, sudo | `.cleartmp` |
| `.cookies` | `.listcookies` `.cookie` | Shows which sites have saved cookies, whether they contain a login, and when it expires (values are never shown). | owner | `.cookies` |
| `.delcookie` | `.delcookies` `.rmcookie` | Deletes the saved cookies of a site (or all). | owner | `.delcookie youtube` |
| `.delvar` | `.unset` `.resetvar` | Removes a setting made with .setvar, so the value from .env (or the default) is used again. | owner | `.delvar PREFIX` |
| `.doctor` | `.diag` `.diagnose` `.status` | Health report: connection, memory, tools (yt-dlp, ffmpeg …) checked live, and which commands are disabled and why. | owner | `.doctor` |
| `.greet` | `.welcomepm` `.firstmsg` | رسالة ترحيب لأول تواصل — a welcome sent the first time someone ever writes to you privately (e.g. who you are and how to ask about a listing). Who was greeted is kept as fingerprints, not phone numbers. | owner | `.greet on أهلاً بك في دار للتسويق العقاري 🏡 أرسل #رقم العقار لتفاصيله، أو اكتب طلبك وسنرد عليك.` |
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
| `.sudo` | – | Manages sudo users. Sudo users can moderate any group the bot administers and use ban/unban, but cannot change owner settings or add other sudo users. Both their phone number and WhatsApp's hidden id (LID) are saved, so they are recognized however WhatsApp sends their messages. | owner | `.sudo add @friend` |
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
| `.smeme` | `.memegen` `.mememaker` `.captionimg` | Makes a meme: big white text with a black outline on a picture. "top \| bottom" for both, "\| bottom" for the bottom only. Arabic works. Made on the server. | everyone | `.smeme when the code works \| on the first try` _(reply to a picture)_ |
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
| `.autodl` | `.autodownload` `.autovideo` | Automatic downloads in this group: when someone posts a TikTok, Instagram, Facebook, X, Threads, Snapchat, Pinterest or YouTube Shorts link, the bot replies with the video. One at a time, at most 30 an hour per group; failures only get a ❌ reaction. _Needs: ytdlp._ | group admins (groups) | `.autodl on` |
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
| `.ocr` | `.readtext` `.img2text` `.scantext` | Reads the text in a picture (screenshots, documents, signs; any language, handwriting too) and sends it as text you can copy. Send or reply to a picture. _Needs: ai._ | everyone | `.ocr` _(reply to a picture)_ |
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
| `ISLAMIC_ADMIN_ONLY` | `false` | `true`: only group admins may set the automatic Islamic posts (`.autoazkar`, `.autoprayer`, `.autotafsir`, `.autohadith`, `.autowird`, `.autojumuah`, `.autosiyam`) and start, end or send reminders for a `.khatma` in groups |
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

- Commands marked "uses external service" in `.help <command>` send the text, image or link to that service. `.ai` with a photo sends that photo to the configured AI provider (Anthropic, Google or the OpenAI-compatible service). `.summarize` sends the message, the web page text or the video captions to it. `.recap` sends the group's recent messages (names and text, up to 200) to it; when an AI key is set, the bot keeps that recent text in memory for this. `.short` sends the link to TinyURL. `.ocr` sends the picture to the configured AI provider. `.whois` sends the domain name to rdap.org and the domain's registry. `.tz` sends the city names to open-meteo.com (like `.time`). `.ssl` and `.up` connect to the website you name, and `.dns` asks the server's DNS resolver. Addresses inside the server's own network are refused. `.imagine` and `.transcribe` send the description, picture or audio to Google or OpenAI. `.news` sends the topic to Google News, `.crypto` the coin name to CoinGecko. `.azkar`, `.dua` and `.hisn` work offline; `.autoazkar city` sends only the city name (to look up prayer times). The new picture effects (`.grayscale`, `.resize` …) and audio effects (`.bass`, `.nightcore` …) run on the server; nothing is uploaded. `.weather`, `.time` and `.prayer` send only the city name; `.wiki`, `.define`, `.currency` and `.quran` send only the search term; `.qsearch` sends the searched words to alquran.cloud. `.tourl`, `.remini` and the image-effect commands upload pictures to **public** file hosts.
- `.khatma` saves which member took and read which juz (their WhatsApp id) in `DATA_DIR/khatma.json` until the khatma is ended or the bot leaves the group.
- `.listing`, `.agent` and the listings' photos are stored on the bot's server. `.adcopy` sends the property details and your contact line to the configured AI provider. `.lead` keeps clients' names, numbers, budgets and your notes about them in `DATA_DIR/leads.json` on the server (owner and sudo users only), and `.backup` includes them. With `.greet on`, the bot keeps salted SHA-256 fingerprints (not numbers) of everyone who wrote to it privately, to greet each person once. With `.agent autoleads on`, people who send `#<number>` to the bot in a private chat are saved there with their WhatsApp name and number. With `.agent requests on`, people who write a property request to the bot in a private chat are saved there with their WhatsApp name, number and the request. `.rental` keeps tenants' names, numbers, rents and payments in `DATA_DIR/rentals.json` (owner and sudo users only). Listings' owners (name and number) are kept with the listings and shown only to the owner and sudo users in their own chat with the bot. In groups watched with `.watch on`, brokers' offers and requests are kept for 30 days in `DATA_DIR/feed.json` with the poster's WhatsApp name and number.
- With `.autodl on`, links to short videos posted in the group are opened by the bot (through yt-dlp) to download them.
- Antidelete and `.vv` are owner-only features that reveal deleted or view-once content to the bot owner. Tell your groups if you enable antidelete.

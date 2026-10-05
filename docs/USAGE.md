# Usage

How to use the bot from WhatsApp, and every configuration option.

- The command prefix is `.` by default (change it with `PREFIX` in `.env`). Every example below uses `.`.
- Send `.help` to see the commands available on *your* bot. Commands whose API key or tool is missing are hidden automatically. Send `.help <command>` for details, e.g. `.help sticker`, or `.help <section>` for one section with descriptions, e.g. `.help tools`, `.help info`, `.help downloads`. A mistyped name gets a "Did you mean …?" suggestion.
- The owner can send `.doctor` to see which tools were found (with their paths and versions), which commands are disabled, and exactly what to install or set to enable them.
- In the tables, "group admins" means admins of the current group. The bot owner and sudo users also count as admins everywhere.
- "Needs" lists what must be configured or installed for the command to exist:

| Needs | What to do |
|---|---|
| `ffmpeg` | Install ffmpeg (included in the Docker image) |
| `ytdlp` | Install yt-dlp (included in the Docker image) |
| `font` | Install a bold TTF font, e.g. `fonts-dejavu-core` (included in the Docker image), or set `FONT_FILE` |
| `ai` | Set `ANTHROPIC_API_KEY` |
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

A short cooldown (default 3 seconds, `DEFAULT_COOLDOWN_SECONDS`) applies per person and command. Some heavy commands have longer cooldowns. Owner and sudo are exempt.

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

Change the action with e.g. `.antilink set warn`, and check it with `.antilink get`. With `warn`, a member is removed after `WARN_LIMIT` warnings (default 3). Admins, sudo users and owners are never affected.

Welcome and goodbye messages: `.welcome on`, then optionally `.welcome set Hi {user}, welcome to {group}! Please read: {description}`. Goodbye works the same with `{user}` and `{group}`.

## All commands

This list is generated from the command files themselves.

### General

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.alive` | – | Shows that the bot is running, its version and current mode. | everyone | `.alive` |
| `.fact` | – | Sends a random useless fact. | everyone | `.fact` |
| `.github` | `.git` `.sc` `.script` `.repo` | Shows the bot's source repository (set GITHUB_REPO in .env). _Needs: githubRepo._ | everyone | `.github` |
| `.groupinfo` | `.infogp` `.infogrupo` | Shows the group's name, ID, member count, owner, admins and description. | everyone (groups) | `.groupinfo` |
| `.help` | `.menu` `.bot` `.list` | Lists all commands, one section (tools, info, download, sticker …), or explains one command. | everyone | `.help` |
| `.jid` | – | Shows this group's ID (JID). | everyone (groups) | `.jid` |
| `.joke` | – | Sends a random dad joke. | everyone | `.joke` |
| `.lyrics` | – | Finds the lyrics of a song. | everyone | `.lyrics adele hello` |
| `.news` | – | Shows the top 5 US headlines. _Needs: newsApi._ | everyone | `.news` |
| `.owner` | – | Sends the bot owner's contact card. | everyone | `.owner` |
| `.ping` | – | Checks that the bot is online and shows response time, uptime and version. | everyone | `.ping` |
| `.quote` | – | Sends a random quote. | everyone | `.quote` |
| `.ss` | `.ssweb` `.screenshot` | Takes a screenshot of a public website. | everyone | `.ss https://example.com` |
| `.staff` | `.admins` `.listadmin` | Lists the group admins. | everyone (groups) | `.staff` |
| `.tourl` | `.url` | Uploads the media you send or reply to and returns a PUBLIC link (anyone with the link can see it). | everyone | `.tourl` _(send or reply to media)_ |
| `.translate` | `.trt` | Translates text, or the message you reply to, into another language. | everyone | `.translate hello fr` |
| `.tts` | – | Turns text into an English voice note. | everyone | `.tts Good morning everyone` |
| `.whoami` | – | Shows the IDs WhatsApp uses for you and your permission level. Useful when setting OWNER_LIDS. | everyone | `.whoami` |

### Tools

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.afk` | `.away` | Marks you as away. When someone mentions or replies to you, the bot tells them; your next message clears it. | everyone | `.afk sleeping` |
| `.calc` | `.calculate` `.math` | Calculates a maths expression: + - * / % ^ !, brackets, sqrt, sin/cos/tan (degrees), log, ln, abs, round, min, max, pi, e. | everyone | `.calc (12+8)*3/4` |
| `.currency` | `.convert` `.cur` `.exchange` | Converts money between currencies with today's exchange rate. | everyone | `.currency 100 usd egp` |
| `.getpp` | `.pp` `.avatar` `.pfp` | Sends the profile picture of the person you mention or reply to (or yours). Add "group" for the group photo. | everyone | `.getpp @someone` |
| `.poll` | `.vote` | Creates a native WhatsApp poll. Separate the question and 2–12 options with \|. Add "multi" first to allow several answers. | everyone | `.poll Pizza or burgers? \| Pizza \| Burgers` |
| `.qr` | `.qrcode` `.toqr` | Makes a QR code image from text or a link. You can also reply to a message to encode it. | everyone | `.qr https://example.com` |
| `.readqr` | `.scanqr` `.qrread` | Reads the QR code in an image or sticker you send or reply to. | everyone | `.readqr` _(reply to an image)_ |
| `.remind` | `.reminder` `.remindme` | Reminds you in this chat after a delay (s, m, h, d, w; up to 60 days). Survives bot restarts. | everyone | `.remind 10m check the oven` |
| `.toaudio` | `.tomp3` `.mp3convert` | Extracts the sound of a video (or converts a voice note/audio file) to an MP3 you can play or save. _Needs: ffmpeg._ | everyone | `.toaudio` _(reply to a video or audio)_ |
| `.tovn` | `.toptt` `.tovoice` | Turns a video, song or audio file into a WhatsApp voice note. _Needs: ffmpeg._ | everyone | `.tovn` _(reply to a video or audio)_ |

### Info & search

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.define` | `.dict` `.dictionary` `.meaning` | Looks up an English word: pronunciation, meanings, examples and synonyms. | everyone | `.define serendipity` |
| `.prayer` | `.salah` `.salat` `.adhan` | Shows today's prayer times for a city and which prayer is next. | everyone | `.prayer Cairo` |
| `.quran` | `.ayah` `.ayat` | Shows a Quran verse in Arabic with an English translation. Without a reference, a random verse. | everyone | `.quran 2:255` |
| `.time` | `.clock` `.date` | Shows the current date and time in a city (or the bot's time zone). | everyone | `.time Tokyo` |
| `.weather` | `.forecast` | Shows the current weather and a 3-day forecast for a city (no API key needed). | everyone | `.weather Cairo` |
| `.wiki` | `.wikipedia` | Shows the Wikipedia summary of a topic. Start with a language code for other Wikipedias (ar:, fr:, es: …). | everyone | `.wiki Great Pyramid of Giza` |

### Group admin

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.antibadword` | – | Deletes messages from non-admins that contain bad words. Action: delete, kick or warn. The bot must be a group admin. | group admins (groups) | `.antibadword on` |
| `.antilink` | – | Deletes links posted by non-admins. Action: delete, kick or warn. The bot must be a group admin. | group admins (groups) | `.antilink on` |
| `.antitag` | – | Deletes messages from non-admins that mention most of the group. Action: delete or kick. The bot must be a group admin. | group admins (groups) | `.antitag on` |
| `.ban` | – | Stops a user from using the bot anywhere. Owners can never be banned. | owner, sudo | `.ban @someone` |
| `.chatbot` | – | Turns the AI chatbot on or off in this group. When on, it answers messages that mention or reply to the bot. _Needs: ai._ | group admins (groups) | `.chatbot on` |
| `.clear` | – | Sends and immediately deletes a bot message (clears the chat preview). | everyone (groups) | `.clear` |
| `.delete` | `.del` | Deletes recent messages: the replied message, the last N from a user, or the last N in the group (max 50, only messages the bot saw since it started). The bot must be a group admin. | group admins (groups) | `.del (reply)` |
| `.demote` | – | Removes admin rights from members. The bot must be a group admin. | group admins (groups) | `.demote @201012345678` |
| `.goodbye` | – | Goodbye messages when members leave. Variables: {user}, {group}. | group admins (groups) | `.goodbye on` |
| `.hidetag` | – | Like .tag but only mentions members who are not admins. | group admins (groups) | `.hidetag Meeting at 8 pm` |
| `.kick` | – | Removes members from the group. The bot and its owners cannot be kicked. The bot must be a group admin. | group admins (groups) | `.kick @201012345678` |
| `.link` | `.invite` `.grouplink` `.gclink` | Shows the group's invite link. The bot must be a group admin. | group admins (groups) | `.link` |
| `.lock` | – | Only admins can change the group name, photo and description. The bot must be a group admin. | group admins (groups) | `.lock` |
| `.mute` | – | Only admins can send messages. Optionally unmute automatically after N minutes. The bot must be a group admin. | group admins (groups) | `.mute` |
| `.promote` | – | Makes members group admins. The bot must be a group admin. | group admins (groups) | `.promote @201012345678` |
| `.resetlink` | `.revoke` `.anularlink` | Revokes the group invite link and shows the new one. The bot must be a group admin. | group admins (groups) | `.resetlink` |
| `.setgdesc` | – | Changes the group description. The bot must be a group admin. | group admins (groups) | `.setgdesc Welcome to our study group` |
| `.setgname` | – | Changes the group name. The bot must be a group admin. | group admins (groups) | `.setgname Study Group` |
| `.setgpp` | – | Sets the group photo from the image or sticker you reply to. The bot must be a group admin. | group admins (groups) | `.setgpp` _(reply to an image)_ |
| `.tag` | – | Sends your text (or re-sends the replied message) while silently mentioning everyone. | group admins (groups) | `.tag Meeting at 8 pm` |
| `.tagall` | – | Mentions every member, one per line. | group admins (groups) | `.tagall` |
| `.tagnotadmin` | – | Mentions every member who is not an admin. | group admins (groups) | `.tagnotadmin` |
| `.unban` | – | Allows a banned user to use the bot again. | owner, sudo | `.unban @201012345678` |
| `.unlock` | – | Lets every member change the group name, photo and description. The bot must be a group admin. | group admins (groups) | `.unlock` |
| `.unmute` | – | Lets everyone send messages again. The bot must be a group admin. | group admins (groups) | `.unmute` |
| `.warn` | – | Warns a member. They are removed automatically at WARN_LIMIT warnings (default 3). The bot must be a group admin. | group admins (groups) | `.warn @201012345678` |
| `.warnings` | – | Shows how many warnings a member has in this group. | everyone (groups) | `.warnings @201012345678` |
| `.welcome` | – | Welcome messages when members join. Variables: {user}, {group}, {description}. | group admins (groups) | `.welcome on` |

### Owner

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.anticall` | – | Rejects incoming calls and blocks the caller. | owner | `.anticall on` |
| `.antidelete` | – | When someone deletes a message, sends you a copy (kept for 24 h, limited size). | owner | `.antidelete on` |
| `.autoreact` | `.areact` `.autoreaction` | Reacts with ⏳ to every command message. | owner | `.autoreact on` |
| `.autoread` | – | Marks every incoming message as read (except ones that mention the bot). | owner | `.autoread on` |
| `.autostatus` | – | Automatically views contacts' statuses, and optionally reacts to them with 💚. | owner | `.autostatus react on` |
| `.autotyping` | – | Shows a 'typing…' indicator when the bot receives messages. | owner | `.autotyping on` |
| `.clearsession` | `.clearsesi` | Deletes cached encryption key files from the session folder (keeps creds.json). Only for fixing persistent 'waiting for this message' errors; restart the bot afterwards. | owner | `.clearsession confirm` |
| `.cleartmp` | – | Deletes leftover temporary files. | owner, sudo | `.cleartmp` |
| `.doctor` | `.diag` `.diagnose` `.status` | Health report: connection, memory, tools (yt-dlp, ffmpeg …) checked live, and which commands are disabled and why. | owner | `.doctor` |
| `.leave` | `.leavegc` `.exit` | Makes the bot leave this group. | owner (groups) | `.leave` |
| `.mention` | – | Turns the automatic reply on or off for messages that mention the bot in groups. | owner | `.mention on` |
| `.mode` | – | Public: everyone can use commands. Private: only owner and sudo (group moderation keeps working). | owner | `.mode private` |
| `.pmblocker` | – | Blocks anyone who is not owner/sudo and messages the bot privately (they get a notice first). | owner | `.pmblocker on` |
| `.setmention` | – | Sets what the bot replies when mentioned: reply to a text, sticker, image, video or audio (max 1 MB). | owner | `.setmention` _(reply to a message)_ |
| `.setpp` | – | Sets the bot's profile picture from the image you reply to. | owner | `.setpp` _(reply to an image)_ |
| `.settings` | – | Shows the bot's global settings and, in a group, that group's protection settings. | owner, sudo | `.settings` |
| `.sudo` | – | Manages sudo users. Sudo users can moderate any group the bot administers and use ban/unban, but cannot change owner settings or add other sudo users. | owner | `.sudo add @friend` |
| `.update` | – | Checks GitHub for a newer version of the bot and of yt-dlp (nightly). '.update now' installs them: the bot is fast-forwarded from your repository, validated, rolled back if the check fails, and restarted. | owner | `.update` |
| `.vv` | – | Reveals the view-once photo or video you reply to (owner only, to protect other people's privacy). | owner | `.vv` _(reply to a view-once message)_ |

### Stickers

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.attp` | – | Makes an animated sticker of your text blinking in colours. _Needs: ffmpeg, font._ | everyone | `.attp hello` |
| `.crop` | – | Like .sticker but crops the media to a square. _Needs: ffmpeg._ | everyone | `.crop` _(send or reply to media)_ |
| `.emojimix` | `.emix` | Mixes two emojis into one sticker (Google Emoji Kitchen). _Needs: tenor, ffmpeg._ | everyone | `.emojimix 😎+🥰` |
| `.igs` | – | Turns the videos of an Instagram post into stickers. _Needs: ytdlp, ffmpeg._ | everyone | `.igs https://www.instagram.com/reel/C0abcdefghi/` |
| `.igsc` | – | Like .igs but crops to a square. _Needs: ytdlp, ffmpeg._ | everyone | `.igsc https://www.instagram.com/reel/C0abcdefghi/` |
| `.simage` | – | Converts the sticker you reply to into a picture. | everyone | `.simage` _(reply to a sticker)_ |
| `.sticker` | `.s` | Turns an image, GIF or short video (first 6 s) into a sticker. _Needs: ffmpeg._ | everyone | `.sticker` _(send or reply to media)_ |
| `.take` | `.steal` | Re-labels the sticker you reply to with your own pack name. | everyone | `.take My Pack` |
| `.tg` | `.stickertelegram` `.tgsticker` `.telesticker` | Copies a public Telegram sticker pack (up to 30 stickers; animated .tgs stickers are skipped). _Needs: telegramBot, ffmpeg._ | everyone | `.tg https://t.me/addstickers/Animals` |

### Images

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.blur` | – | Blurs the image you send or reply to. | everyone | `.blur` _(send or reply to an image)_ |
| `.remini` | `.enhance` `.upscale` | Enhances/upscales the image you send or reply to. _Needs: remini._ | everyone | `.remini` _(send or reply to an image)_ |
| `.removebg` | `.rmbg` `.nobg` | Removes the background of the image you send or reply to. _Needs: removeBg._ | everyone | `.removebg` _(send or reply to an image)_ |

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
| `.ai` | `.gpt` `.gemini` `.ask` `.claude` | Asks the AI a question (Claude). Reply to a message to ask about it, or send/reply to a photo or sticker to ask about the image. _Needs: ai._ | everyone | `.ai write a haiku about Cairo` |

### Fun

| Command | Aliases | What it does | Who | Example |
|---|---|---|---|---|
| `.8ball` | – | Answers a yes/no question like a magic 8-ball. | everyone | `.8ball Will it rain tomorrow?` |
| `.character` | – | A random, just-for-fun 'character analysis' of someone. | everyone | `.character @201012345678` |
| `.china` | – | Same as .pies china. | everyone | `.china` |
| `.compliment` | – | Compliments someone. | everyone | `.compliment @201012345678` |
| `.dare` | – | Gives a random dare. | everyone | `.dare` |
| `.flirt` | – | Sends a random flirty line. | everyone | `.flirt` |
| `.goodnight` | `.lovenight` `.gn` | Sends a good-night message. | everyone | `.goodnight` |
| `.india` | – | Same as .pies india. | everyone | `.india` |
| `.indonesia` | – | Same as .pies indonesia. | everyone | `.indonesia` |
| `.insult` | – | Teases someone with a light-hearted roast. | everyone | `.insult @201012345678` |
| `.japan` | – | Same as .pies japan. | everyone | `.japan` |
| `.korea` | – | Same as .pies korea. | everyone | `.korea` |
| `.malaysia` | – | Same as .pies malaysia. | everyone | `.malaysia` |
| `.meme` | – | Sends a random Cheems meme. | everyone | `.meme` |
| `.pies` | – | Sends a random picture for a country: india, malaysia, thailand, china, indonesia, japan, korea, vietnam. | everyone | `.pies japan` |
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
| `.surrender` | – | Gives up your current tic-tac-toe game. | everyone | `.surrender` |
| `.tictactoe` | `.ttt` | Starts or joins a tic-tac-toe game. Play by sending a number 1-9; send 'surrender' to give up. | everyone | `.tictactoe` |
| `.topmembers` | – | Shows the 5 most active members of this group (since the bot joined). | everyone (groups) | `.topmembers` |
| `.trivia` | – | Asks a multiple-choice trivia question. Answer with .answer <answer>. | everyone | `.trivia` |
### Games without a prefix

During a tic-tac-toe game, players send a bare number `1`–`9` to place their mark, or `surrender` to give up.

### Automatic features (no command)

| Feature | Turned on with | Behaviour |
|---|---|---|
| Group chatbot | `.chatbot on` (group admins; needs `ANTHROPIC_API_KEY`) | Replies when someone mentions the bot or replies to one of its messages. Only that message is sent to Claude. |
| Mention reply | `.mention on`, `.setmention` (owner) | Replies with your chosen text/sticker/media when the bot is mentioned in a group |
| Antidelete | `.antidelete on` (owner) | Sends you a copy of messages others delete, and view-once media, in the bot's own chat |
| Auto-read / auto-typing / auto-status | `.autoread on`, `.autotyping on`, `.autostatus on` (owner) | As named |
| PM blocker | `.pmblocker on` (owner) | Sends a notice to, then blocks, anyone who messages the bot privately (owner and sudo excepted) |
| Anticall | `.anticall on` (owner) | Rejects calls and blocks the caller |
| Promote/demote announcements | always in public mode | Announces admin changes in groups |
| AFK notices | `.afk [reason]` (anyone) | When someone mentions or replies to an AFK user, the bot says they are away (at most once per chat every 5 minutes). The AFK user's next message clears it |
| Reminders | `.remind 10m <text>` (anyone) | Sent in the chat where they were set, mentioning you. Stored in `DATA_DIR/reminders.json`, so they survive restarts; reminders that fell due while the bot was offline are sent on reconnect, marked late. Max 10 per person, 60 days ahead |

## Configuration options

All settings live in `MD-main/.env`. `MD-main/.env.example` lists every option with an explanation; copy it and edit:

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
| `STORE_MAX_CHATS` / `STORE_MESSAGES_PER_CHAT` | `500` / `20` | Recent messages kept in memory (for `.delete`) |
| `ANTIDELETE_MAX_MESSAGES` / `ANTIDELETE_MAX_MEDIA_MB` | `5000` / `10` | Antidelete limits |
| `FFMPEG_PATH` / `YTDLP_PATH` | `ffmpeg` / `yt-dlp` | Tool locations: a program name found in `PATH`, or a full path. `~` means your home folder (`~/.local/bin/yt-dlp`). Use the standalone yt-dlp nightly binary so `.update now` can update it |
| `TIMEZONE` | the server's time zone | IANA name such as `Africa/Cairo`; used by `.time` and `.remind` |
| `UPDATE_REMOTE` / `UPDATE_BRANCH` | `origin` / `main` | Where `.update` gets new versions of the bot |
| `YTDLP_COOKIES` | empty | cookies.txt for login-only content |
| `FONT_FILE` | DejaVu Sans Bold | Font for `.attp` |
| `ANTHROPIC_API_KEY` | empty | Enables `.ai` and the chatbot |
| `AI_MODEL` | `claude-opus-5-5` | Claude model |
| `AI_EFFORT` | `low` | `low`…`max` |
| `AI_MAX_TOKENS` | `1024` | Maximum answer length |
| `CHATBOT_PERSONA` | friendly, concise | Chatbot instructions |
| `NEWSAPI_KEY`, `TENOR_KEY`, `TELEGRAM_BOT_TOKEN`, `REMOVEBG_API_KEY`, `REMINI_API_KEY`, `GITHUB_REPO` | empty | Enable the matching commands |
| `OPENWEATHER_KEY` | empty | No longer needed: `.weather` uses Open-Meteo, which is free and keyless |

The pairing service has its own `Bot_Pair_Code-main/.env`; its options are explained in `Bot_Pair_Code-main/.env.example` and in [DEPLOYMENT.md](DEPLOYMENT.md).

## Privacy notes for group members

- Commands marked "uses external service" in `.help <command>` send the text, image or link to that service. `.ai` with a photo sends that photo to Anthropic. `.weather`, `.time` and `.prayer` send only the city name; `.wiki`, `.define`, `.currency` and `.quran` send only the search term. `.tourl`, `.remini` and the image-effect commands upload pictures to **public** file hosts.
- Antidelete and `.vv` are owner-only features that reveal deleted or view-once content to the bot owner. Tell your groups if you enable antidelete.

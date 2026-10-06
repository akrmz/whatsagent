# Troubleshooting

First, look at the logs. They almost always say what is wrong.

| Setup | Logs | Health |
|---|---|---|
| PM2 | `pm2 logs whatsapp-bot --lines 100` | `curl -s http://127.0.0.1:3000/healthz` |
| Docker | `docker compose logs --tail 100 bot` | same |

`/healthz` returns `"whatsapp": "open"` when connected. Other values: `waiting-for-session` (not paired), `connecting`, `disconnected` (will retry), `logged-out`.

To check the configuration without connecting to WhatsApp, run `npm run check` in `MD-main` (Docker: `docker compose run --rm bot node src/check.js`).

---

## Startup problems

### `Invalid configuration: OWNER_NUMBERS is required` (or another `Invalid configuration` message)
`.env` is missing or a value is wrong. Every problem is listed at once. Create the file with `cp .env.example .env` in `MD-main`, fix the listed values, and restart. Numbers need the country code and no leading 0: Egypt `01012345678` becomes `201012345678`.

### `Node.js 22.12 or newer is required`
Install Node 22 ([DEPLOYMENT.md §5.1](DEPLOYMENT.md#51-install-nodejs-22-ffmpeg-fonts-git-and-yt-dlp)) and check with `node --version`.

### `npm ci` fails with `git` / `Permission denied (publickey)` / `libsignal`
The WhatsApp encryption library is installed from GitHub. Install git and use HTTPS for GitHub:
```bash
sudo apt-get install -y git
git config --global url."https://github.com/".insteadOf ssh://git@github.com/
```
Then run `npm ci --omit=dev` again.

### `Invalid command in fun/x.js` / `already used by …` at startup
A command file has bad metadata or a name/alias that another command already uses. The message names the file and the problem. Fix it, then run `npm run check`.

### A command is missing from `.help`
It is disabled because something it needs is not configured. The startup log has a line `command disabled: requirement not configured` with `missing: [...]`. `npm run check` and the owner command `.doctor` also print the list, with what to install or set for each. Set the API key in `.env`, or install the tool (ffmpeg / yt-dlp / fonts), then restart.

## Connection and pairing

### Log says `No WhatsApp session yet … Waiting…`
The bot is not paired. Follow [DEPLOYMENT.md §7](DEPLOYMENT.md#7-first-time-pairing). Once a session appears, the bot connects within 10 seconds.

### No pairing code appears in the log
- Check that `PAIRING_NUMBER` is the **bot's** number with country code, and that the bot was restarted after setting it.
- `WhatsApp refused to issue a pairing code`: the number is wrong, or WhatsApp is rate-limiting it. Wait 10–15 minutes and try again.
- If a session folder already exists from an earlier attempt, the bot thinks it is paired. Stop the bot, move `MD-main/session` away, and start again.

### "Couldn't link device" / the code is rejected on the phone
Codes expire after about a minute. Restart the bot (or press the button again on the pairing page) and type the new code quickly. Make sure the phone's number matches the number you entered.

### Pairing page: `Missing or wrong access token`
Copy `PAIR_ACCESS_TOKEN` exactly from `Bot_Pair_Code-main/.env`. Restart the pairing service after changing it.

### Pairing page: `Too many requests`
The page allows `RATE_LIMIT_MAX` attempts (default 5) per `RATE_LIMIT_WINDOW_SECONDS` (10 minutes) per IP. Wait, or raise the limit temporarily. Behind a reverse proxy, set `TRUST_PROXY=true`, otherwise every visitor counts as the proxy's IP.

### Pairing page says the new session "was saved next to it"
A working session already existed, and the pairing service never overwrites one by default. Either keep the old one, or stop the bot, replace `session/` with the `session.new-<time>` folder the log names, and start it again. Setting `PAIR_OVERWRITE=true` backs up the old session and replaces it automatically.

### `logged-out` / `WhatsApp logged this bot out`
The linked device was removed on the phone, or WhatsApp ended the session. The old session was moved to `session.loggedout-<time>`. Pair again; the bot reconnects by itself.

### `connection replaced` (status 440) repeatedly
Two programs are using the same session: two bot processes, an old copy of the bot, or the pairing service and the bot at once. Run only one bot: check `pm2 status`, `docker ps` and any old servers or panels.

### Constant `connection closed; reconnecting`
Usually network trouble. The bot waits longer between each attempt, up to 60 s. If it never connects, check the server's internet access (`curl -I https://web.whatsapp.com`) and the time (`timedatectl`; the clock must be correct).

### `WhatsApp refused the connection (403)`
The account may be restricted or banned by WhatsApp. Check the phone. The bot retries every 5 minutes.

## Commands

### The bot doesn't respond to anything
1. Is it connected? Check `/healthz`.
2. Is the prefix right? Default `.`; see `PREFIX`.
3. Private mode? Only owner/sudo can use commands then. Send `.mode public` from your own number.
4. Are you banned? `.unban` from the owner's number.
5. Cooldown: repeated use of the same command within the cooldown is ignored after one notice.

### "This command is only for the bot owner" although I am the owner
- `OWNER_NUMBERS` must be your number with the country code.
- In some groups WhatsApp shows members by an anonymous `@lid` ID. Send `.whoami` in that group: it lists your IDs. Add the digits of your `@lid` ID to `OWNER_LIDS` in `.env` and restart. Commands you send from the bot's own WhatsApp account always count as owner.

### "Please make the bot a group admin first"
Commands that remove members, delete messages or change group settings need the bot to be an admin. Make it one in the group's settings.

### Stickers: `ffmpeg is not installed`
Picture stickers work without ffmpeg (since 2.4.0). GIFs, videos, `.igs`, the audio effects, `.toaudio` and `.tovn` need it: install ffmpeg (`sudo apt-get install -y ffmpeg`), then `.setvar FFMPEG_PATH /usr/bin/ffmpeg` or restart. Docker images include it.

### yt-dlp (or ffmpeg) is installed but its commands are missing from `.help`
The bot checks every tool once at startup and hides commands whose tool it can't run. To see exactly why:
- send `.doctor` (owner), or run `npm run check` on the server. Both print `✓`/`✗` per tool with the path that was tried and the reason, e.g. `… does not exist. Check YTDLP_PATH`, `… is not executable. Run: chmod +x …`.
- `YTDLP_PATH` may be a program name found in `PATH` (`yt-dlp`) or a full path. `~/…` works (since 2.2.0; older versions treated `~` literally, so `YTDLP_PATH=~/.local/bin/yt-dlp` was "not found").
- Under PM2 or systemd, `PATH` is often shorter than in your terminal. Use the full path (`which yt-dlp` shows it).
- Restart the bot after installing a tool. `.doctor` says "found now, restart to enable" when a tool appeared after startup.
- Without ffmpeg, `.video`, `.tiktok`, `.dl` … still work (single-file formats only); `.song`, `.spotify`, stickers, `.toaudio` and `.tovn` need ffmpeg.

### Downloads: `.song`, `.video`, `.tiktok` … fail
- `yt-dlp is not installed`: install it ([DEPLOYMENT.md §5.1](DEPLOYMENT.md#51-install-nodejs-22-ffmpeg-fonts-git-and-yt-dlp)).
- `Download failed …`: sites change often. Send `.update now` (it updates yt-dlp to the latest nightly), or on the server run `yt-dlp --update-to nightly`, then try again.
- `larger than the allowed limit` / `longer than the allowed duration`: raise `MAX_DOWNLOAD_MB` / `MAX_VIDEO_SECONDS`. WhatsApp itself limits media to about 100 MB.
- `private or needs a login`, YouTube "Sign in to confirm you're not a bot" or age-restricted videos: give the bot login cookies for that site with `.setcookie <site>` in a private chat ([USAGE.md → Cookies](USAGE.md#cookies-for-downloads-youtube-instagram-)). Instagram photo posts (not videos) cannot be downloaded.

### `The external service used by this command is not responding`
Some fun and image commands use free third-party APIs that the bot does not control (listed in `.help <command>`). They can be down or change without notice. Try later. Nothing is wrong with your bot.

### AI: `The AI provider rejected the API key`
The key is wrong, revoked, or the account has no credit/quota. Send `.setai` to see which provider is used, then set a new key with `.setai <claude|gemini|openai> <key>` in a private chat (it is tested before it is saved). `The AI declined to answer that` means the provider refused the request for safety reasons.

### AI: `The AI model was not found`
The model name is wrong or not available to your key (models are retired over time). Send `.aimodel` to list the ones your key can use and `.aimodel <number>` to switch.

### AI: `The AI is busy or the quota is used up`
Free tiers (e.g. Gemini) have per-minute and per-day limits. Wait, choose a cheaper model with `.aimodel`, or switch provider with `.setai`.

### AI: answers are cut off, or "The answer did not fit"
Raise the limit: `.setvar AI_MAX_TOKENS 2048`.

### `.imagine` / `.transcribe` missing from `.help`
They need a **Gemini** or **OpenAI** key (Claude can't draw pictures or listen to audio). Add one next to Claude: `.setvar GEMINI_API_KEY <key>` in a private chat. With an OpenAI-compatible service other than api.openai.com they stay off. "No picture came back" usually means the request was refused for safety reasons: describe it differently. Image generation may need a paid Gemini plan; check your quota at aistudio.google.com.

### `.crypto`: "CoinGecko's free limit was reached"
CoinGecko's free API allows only a few requests a minute. Prices are cached for 60 seconds; try again shortly.

### `.news` shows the wrong country or language
Set the default with `.setvar NEWS_REGION EG:ar` (COUNTRY:language), or ask once with `.news sa:ar`.

### Cookies: `.setcookie` says "No login cookie found", or downloads still ask for a login
- Export while logged in, on the site itself (e.g. youtube.com, not google.com).
- YouTube replaces the cookies of an open browser session within hours. Export from a private/incognito window and close it right after.
- Check with `.cookies`. If the login has expired, export again and send `.setcookie` again.
- `.update now` (newer yt-dlp) often fixes YouTube problems too.

### A setting changed with `.setvar` doesn't seem to apply
- `.vars NAME` shows the value in use and where it comes from (chat, `.env` or default). A chat value always wins over `.env`; remove it with `.delvar NAME`.
- `MARK_ONLINE` and `LOG_LEVEL` need `.restart`.
- If the log says `settings saved from chat are invalid and were ignored`, one saved value stopped validating (e.g. after an upgrade): the bot started with `.env` only. Fix it with `.setvar`/`.delvar`, or delete `DATA_DIR/env-overrides.json`.

### `.attp` missing
It needs ffmpeg and a bold font. Install `fonts-dejavu-core`, or set `FONT_FILE` to a TTF that exists.

## Updating with `.update`

### `This installation is not a git clone`
The bot was installed from an archive or runs in Docker. For PM2, clone the repository instead ([DEPLOYMENT.md §3](DEPLOYMENT.md#3-get-the-code-onto-the-server)), copy your `MD-main/.env`, `MD-main/session/` and `MD-main/data/` into the clone, and start it from there. For Docker, update with `git pull --ff-only && docker compose up -d --build`.

### `git fetch failed`
The server can't reach your repository. A public repo needs internet access only. A private repo needs the deploy key from [DEPLOYMENT.md §3](DEPLOYMENT.md#3-get-the-code-onto-the-server). Test it on the server with `cd ~/whatsapp-bot && git fetch origin`.

### `The server has local code changes` / `commits that are not on origin/main`
Someone edited files on the server. See them with `cd ~/whatsapp-bot && git status`. Commit and push them from your computer instead, or discard them with `git checkout -- .`. Then run `.update now` again.

### `The new version failed validation and was rolled back`
The new code from GitHub didn't pass `npm run check` (for example a broken command file, or a new required setting missing from `.env`). The bot keeps running the old version. The message shows the first error. Fix it, push, and update again.

### `yt-dlp could not update itself`
yt-dlp was installed with pip, pipx or apt. Those copies can't self-update. Install the standalone nightly binary ([DEPLOYMENT.md §5.1](DEPLOYMENT.md#51-install-nodejs-22-ffmpeg-fonts-git-and-yt-dlp)) and set `YTDLP_PATH` to it.

### The bot didn't come back after `.update now`
It restarts by exiting and relies on PM2 (or Docker) to start it again. If you started it with `npm start` in a terminal, start it again by hand, or switch to PM2. Check `pm2 logs whatsapp-bot`.

## Messages, decryption and memory

### Recipients see "Waiting for this message" / the bot misses messages
Encryption keys can get out of sync after crashes. Restarting usually fixes it. If it persists for days, send `.clearsession confirm` from the owner's number and restart. That deletes cached key files but keeps your login.

### The bot uses a lot of memory
Limits are set in `.env` (`STORE_MAX_CHATS`, `ANTIDELETE_MAX_MESSAGES`, `MAX_MEDIA_MB`). PM2 restarts the bot above 700 MB (`max_memory_restart` in `ecosystem.config.js`); Docker limits it to 768 MB (`mem_limit` in `docker-compose.yml`). Video stickers and downloads are the heaviest commands.

### Disk filling up
Temporary files go to `TMP_DIR` and are deleted after each command. `.cleartmp` removes leftovers. Log rotation: Docker is configured for it. With PM2, install `pm2 install pm2-logrotate`.

## Getting more detail

Set `LOG_LEVEL=debug` (and, for WhatsApp protocol issues, `BAILEYS_LOG_LEVEL=warn`) in `.env`, restart, reproduce the problem, and read the logs. Put them back to `info`/`silent` afterwards. Secrets are redacted in logs, and phone numbers are partly masked.

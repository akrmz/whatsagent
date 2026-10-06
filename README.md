# WhatsApp Bot

A self-hosted, multi-device WhatsApp bot with about 200 commands: group moderation and anti-spam, stickers, downloads from 13 sites (with login cookies set from WhatsApp), AI chat with Claude, Gemini or any OpenAI-compatible model (also about photos, web pages and YouTube videos), reminders, notes, polls, QR codes, unit conversion, prayer times, weather, Wikipedia, games and more. Most settings, including AI keys and models, can be changed from WhatsApp without touching the server. It also includes a small private web page for linking your WhatsApp account.

> ⚠️ **Unofficial.** This project uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial, reverse-engineered WhatsApp Web library. It is not affiliated with or endorsed by WhatsApp or Meta. Automating a WhatsApp account can break WhatsApp's Terms of Service, and **the account may be banned**. Use a separate number, don't spam, and use it at your own risk.

## What's in the repository

| Folder | What it is |
|---|---|
| [`MD-main/`](MD-main) | The bot |
| [`Bot_Pair_Code-main/`](Bot_Pair_Code-main) | Optional pairing page: links a WhatsApp account by pairing code or QR and saves the login on your server for the bot. Run it only while pairing. |
| [`docs/`](docs) | Documentation |

## Features

- **Group moderation:** antilink, antibadword, antitag (delete / warn / kick), warnings, kick, promote/demote, mute with timer, tag all, welcome and goodbye messages, delete messages, group name/description/photo.
- **Stickers and images:** image/GIF/video → sticker, square crop, sticker → image, re-label packs, animated text stickers, emoji mixing, Telegram packs, blur, background removal, upscaling, about 20 image effects.
- **Downloads** (via [yt-dlp](https://github.com/yt-dlp/yt-dlp)): YouTube audio and video, TikTok, Facebook, Instagram videos, with size and length limits.
- **AI:** `.ai` (also `.gpt`/`.gemini`) and an optional group chatbot, powered by Claude (your own API key).
- **Fun and games:** tic-tac-toe, hangman, trivia, truth/dare, jokes, quotes, text effects, anime reactions.
- **Owner tools:** `.update` (check / install the latest version from your GitHub repository, plus yt-dlp nightly), public/private mode, sudo users, auto-read, auto-typing, auto-status, anticall, PM blocker, antidelete, view-once reveal.
- **Built to be safe and maintainable:** strict owner/admin checks in one place, per-command cooldowns, size limits on every download, SSRF-safe HTTP client, no remote-code features, atomic settings storage, automatic reconnection with backoff, health endpoint, structured logs with secrets redacted.
- **Easy to extend:** one file per command, discovered automatically; `.help` is generated from the commands themselves.

## Quick start

On a server with Node.js 22.12+, git, ffmpeg and (optionally) the yt-dlp nightly binary:

```bash
git clone https://github.com/akrmz/whatsagent.git && cd whatsagent/MD-main
npm ci --omit=dev
cp .env.example .env
nano .env               # set OWNER_NUMBERS (your number with country code) and PAIRING_NUMBER (the bot's number)
npm run check           # validates the configuration without connecting
npm start               # prints a pairing code: WhatsApp → Linked devices → Link with phone number
```

Then, from your own WhatsApp, send `.ping` to the bot's number. Later, push changes to GitHub and send `.update` / `.update now` to update the bot (and yt-dlp nightly) from WhatsApp.

Or with Docker, from the repository root:

```bash
cp MD-main/.env.example MD-main/.env && nano MD-main/.env
cp Bot_Pair_Code-main/.env.example Bot_Pair_Code-main/.env
docker compose up -d --build
docker compose logs -f bot
```

For a real deployment (PM2 or Docker on an Ubuntu VPS, pairing, updates, backups, HTTPS), follow **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Documentation

| Document | Read it when you want to… |
|---|---|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | install, pair, update and back up the bot on a VPS |
| [docs/USAGE.md](docs/USAGE.md) | see every command with examples, and every setting |
| [docs/ADDING_FEATURES.md](docs/ADDING_FEATURES.md) | add a command, an event handler or a setting |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | fix a problem |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | understand how it works inside |
| [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) | see what was wrong with the original code, and its status |
| [CHANGELOG.md](CHANGELOG.md) | see what changed |

## Development

```bash
cd MD-main && npm ci && npm test && npm run lint && npm run check:demo
cd ../Bot_Pair_Code-main && npm ci && npm test && npm run lint
```

Tests never connect to WhatsApp.

## Security

Never share the `session/` folder or your `.env` files: the session folder is your WhatsApp login. Never use a pairing website run by someone else. See the checklist at the end of [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#11-security-checklist).

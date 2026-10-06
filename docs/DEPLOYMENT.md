# Deployment on an Ubuntu VPS

This guide takes you from an empty Ubuntu server to a running bot. It covers two ways to run it: **PM2** (plain Node.js) or **Docker**. Pick one. Commands are meant to be pasted into the server's terminal one block at a time.

Tested target: Ubuntu 22.04 or 24.04 LTS, 1 vCPU, 1 GB RAM (2 GB recommended if you use video downloads), 10 GB disk.

Contents:
1. [Before you start](#1-before-you-start)
2. [Prepare the server](#2-prepare-the-server)
3. [Get the code onto the server](#3-get-the-code-onto-the-server)
4. [Configure](#4-configure)
5. [Option A: run with PM2](#5-option-a-run-with-pm2)
6. [Option B: run with Docker](#6-option-b-run-with-docker)
7. [First-time pairing](#7-first-time-pairing)
8. [Updating](#8-updating)
9. [Backing up and restoring the session](#9-backing-up-and-restoring-the-session)
10. [Pairing service behind HTTPS (optional)](#10-pairing-service-behind-https-optional)
11. [Security checklist](#11-security-checklist)

---

## 1. Before you start

You need:
- A server running Ubuntu, and SSH access to it as a user with `sudo` rights.
- The WhatsApp account the bot will run on. Use a **separate number** if you can: this project uses an unofficial WhatsApp library, and WhatsApp can ban accounts that behave like bots.
- Your own API keys for any optional features you want (see `MD-main/.env.example`).

The project has two parts:

| Folder | What it is | Must run? |
|---|---|---|
| `MD-main/` | The bot | Always |
| `Bot_Pair_Code-main/` | A small web page that links ("pairs") a WhatsApp account and saves the login for the bot | Only while pairing. You can also pair from the terminal instead. |

## 2. Prepare the server

Log in to the server:

```bash
ssh your-user@your-server-ip
```

Update packages and turn on the firewall. Only SSH is needed; the bot makes outgoing connections only.

```bash
sudo apt update && sudo apt upgrade -y
sudo ufw allow OpenSSH
sudo ufw --force enable
```

Create a dedicated, unprivileged user to run the bot, and switch to it:

```bash
sudo adduser --disabled-password --gecos "" whatsapp
sudo usermod -aG sudo whatsapp
sudo passwd whatsapp
sudo -iu whatsapp
```

(The `sudo` group membership is only for the installation steps. Remove it afterwards with `sudo deluser whatsapp sudo` if you like.)

## 3. Get the code onto the server

The code lives in your GitHub repository <https://github.com/akrmz/whatsagent>. The server must be a **git clone** of it: that is what lets the `.update` command update the bot from WhatsApp.

**If the repository is public:**

```bash
git clone https://github.com/akrmz/whatsagent.git ~/whatsapp-bot
cd ~/whatsapp-bot && ls
```

**If the repository is private**, give the server a read-only *deploy key* (it can only read this one repository):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/whatsagent_deploy -N "" -C "whatsagent server"
cat ~/.ssh/whatsagent_deploy.pub
```

On GitHub, open the repository → **Settings → Deploy keys → Add deploy key**, paste the printed line, leave **Allow write access** unticked, and save. Then:

```bash
printf 'Host github-whatsagent\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/whatsagent_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
chmod 600 ~/.ssh/config
git clone git@github-whatsagent:akrmz/whatsagent.git ~/whatsapp-bot
cd ~/whatsapp-bot && ls
```

You should see `MD-main`, `Bot_Pair_Code-main`, `docs`, `docker-compose.yml` and `ecosystem.config.js`.

> The repository contains no secrets: `.env` files, sessions and runtime data are excluded by `.gitignore`. Keep it that way. Never commit `MD-main/.env` or `MD-main/session/`.

## 4. Configure

### 4.1 The bot

```bash
cd ~/whatsapp-bot/MD-main
cp .env.example .env
chmod 600 .env
nano .env
```

Set at least:

```env
OWNER_NUMBERS=201012345678
BOT_NAME=My Bot
OWNER_NAME=Your Name
```

- `OWNER_NUMBERS` is **your** WhatsApp number (the person allowed to control the bot), with the country code and without `+` or a leading `0`. Egypt 010 1234 5678 becomes `201012345678`.
- Add any API keys you want. Every option is explained in the file and in [USAGE.md](USAGE.md#configuration-options).

Save with `Ctrl+O`, `Enter`, then exit with `Ctrl+X`.

### 4.2 The pairing service (only if you will use the web page to pair)

```bash
cd ~/whatsapp-bot/Bot_Pair_Code-main
cp .env.example .env
chmod 600 .env
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
nano .env
```

Paste the printed random string as `PAIR_ACCESS_TOKEN=`. Keep the defaults for everything else: the page listens on `127.0.0.1:8000` only, and saves the session straight into `../MD-main/session`.

---

## 5. Option A: run with PM2

### 5.1 Install Node.js 22, ffmpeg, fonts, git and yt-dlp

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt-get install -y nodejs ffmpeg fonts-dejavu-core git
node --version
```

`node --version` must print `v22.12.0` or newer.

Install yt-dlp **nightly** (used by the download commands) as the official standalone binary, in a folder the `whatsapp` user owns. It needs no Python, and the bot can update it with `.update now`. Use `yt-dlp_linux_aarch64` instead of `yt-dlp_linux` on ARM servers.

```bash
mkdir -p ~/.local/bin
cd /tmp && curl -fsSLO https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_linux && curl -fsSLO https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/SHA2-256SUMS
grep " yt-dlp_linux$" SHA2-256SUMS | sha256sum -c -
install -m 755 yt-dlp_linux ~/.local/bin/yt-dlp && rm yt-dlp_linux SHA2-256SUMS
~/.local/bin/yt-dlp --version
```

`sha256sum -c` must print `yt-dlp_linux: OK`. The version looks like `2026.09.27.232945` (nightly builds have a time in the version).

In `MD-main/.env`, point the bot at it:

```env
YTDLP_PATH=/home/whatsapp/.local/bin/yt-dlp
```

### 5.2 Install the bot's dependencies

`git` must be installed (previous step): WhatsApp's encryption library is installed from GitHub. Tell git to use HTTPS for GitHub, so no GitHub SSH key is needed:

```bash
git config --global url."https://github.com/".insteadOf ssh://git@github.com/
```

```bash
cd ~/whatsapp-bot/MD-main && npm ci --omit=dev
cd ~/whatsapp-bot/Bot_Pair_Code-main && npm ci --omit=dev
```

Check the bot's configuration without connecting to WhatsApp:

```bash
cd ~/whatsapp-bot/MD-main && npm run check
```

It should print `✓ configuration valid`, the number of loaded commands, and which commands are disabled (because a key or tool is missing).

### 5.3 Install PM2 and start the bot

```bash
sudo npm install -g pm2@latest
cd ~/whatsapp-bot
pm2 start ecosystem.config.js --only whatsapp-bot
pm2 save
pm2 startup systemd -u whatsapp --hp /home/whatsapp
```

`pm2 startup` prints a command that starts with `sudo env PATH=...`. Copy it and run it. This makes the bot start again after a server reboot.

Useful commands:

| Task | Command |
|---|---|
| Status | `pm2 status` |
| Live logs | `pm2 logs whatsapp-bot` |
| Restart | `pm2 restart whatsapp-bot` |
| Stop | `pm2 stop whatsapp-bot` |
| Health | `curl -s http://127.0.0.1:3000/healthz` |

The bot is not paired yet, so the logs say `No WhatsApp session yet`. Continue with [7. First-time pairing](#7-first-time-pairing).

---

## 6. Option B: run with Docker

The images run as a non-root user. They already contain ffmpeg, fonts and the yt-dlp nightly binary, and keep the session and settings in Docker volumes that survive updates.

### 6.1 Install Docker

```bash
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sudo sh /tmp/get-docker.sh
sudo usermod -aG docker whatsapp
```

Log out and back in (`exit`, then `sudo -iu whatsapp`), then check:

```bash
docker compose version
```

### 6.2 Build and start

Both `.env` files must exist (step 4). The pairing one is needed even if you never start the pairing service; an empty file is fine:

```bash
cd ~/whatsapp-bot
test -f Bot_Pair_Code-main/.env || cp Bot_Pair_Code-main/.env.example Bot_Pair_Code-main/.env
docker compose up -d --build
```

Paths, health port and tool locations are set by `docker-compose.yml`, so leave `SESSION_DIR`, `DATA_DIR`, `TMP_DIR`, `FFMPEG_PATH` and `YTDLP_PATH` empty in `.env`.

Useful commands (run in `~/whatsapp-bot`):

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Live logs | `docker compose logs -f bot` |
| Restart | `docker compose restart bot` |
| Stop everything | `docker compose down` (volumes and your session are kept) |
| Health | `curl -s http://127.0.0.1:3000/healthz` |
| Check config | `docker compose run --rm bot node src/check.js` |

The container restarts automatically (`restart: unless-stopped`), including after a reboot. Continue with [7. First-time pairing](#7-first-time-pairing).

---

## 7. First-time pairing

Pairing links the bot to a WhatsApp account, like WhatsApp Web. Do it once. It needs doing again only if the bot is logged out.

Choose **one** method.

### Method 1: pairing code in the bot's log (simplest)

1. Edit `MD-main/.env` and set the **bot's** WhatsApp number:
   ```env
   PAIRING_NUMBER=201012345678
   ```
2. Restart the bot:
   - PM2: `pm2 restart whatsapp-bot`, then `pm2 logs whatsapp-bot --lines 30`
   - Docker: `docker compose up -d bot`, then `docker compose logs -f bot`
3. Within a few seconds the log shows `Pairing code for ********5678:  ABCD-EFGH`.
4. On the phone with that WhatsApp account: **Settings → Linked devices → Link a device → Link with phone number instead**, then type the code.
5. The log shows `connected to WhatsApp`. Remove `PAIRING_NUMBER` from `.env` again.

Codes expire after about a minute. If it expired, restart the bot to get a new one.

### Method 2: the pairing web page

The page is protected by your `PAIR_ACCESS_TOKEN` and listens only on the server itself. Reach it securely through an **SSH tunnel**, so nothing has to be opened to the internet.

1. Start it:
   - PM2: `cd ~/whatsapp-bot && pm2 start ecosystem.config.js --only whatsapp-pairing`
   - Docker: `cd ~/whatsapp-bot && docker compose --profile pairing up -d --build pairing`
2. **On your own computer**, open a tunnel (keep this window open):
   ```bash
   ssh -N -L 8000:127.0.0.1:8000 whatsapp@your-server-ip
   ```
3. Open <http://localhost:8000> in your browser. Paste the access token, enter the bot's number with country code and press **Get pairing code** (or use the **QR code** tab and scan it).
4. Enter the code in WhatsApp (**Settings → Linked devices → Link a device → Link with phone number instead**).
5. The page says "Linked. The session was saved on the server." The bot notices the new session within 10 seconds and connects. No restart is needed.
6. Stop the pairing service and close the tunnel:
   - PM2: `pm2 delete whatsapp-pairing && pm2 save`
   - Docker: `docker compose stop pairing`

Then test it: from **your own** WhatsApp (the `OWNER_NUMBERS` number), send `.ping` to the bot's number. It replies with `Pong!`.

> Never use a pairing website run by someone else. Whoever runs the server gets a full copy of your login.

## 8. Updating

### The normal way: from WhatsApp (PM2 installs)

1. Make your changes on your computer, commit them, and push to GitHub:
   ```bash
   git push origin main
   ```
2. From the **owner's** WhatsApp, send `.update` to the bot. It replies with the current and latest versions of the bot (from GitHub) and of yt-dlp (latest nightly), and lists the new commits.
3. Send `.update now` to install. The bot:
   - updates yt-dlp to the latest nightly, if a newer one exists;
   - fast-forwards its git clone to `origin/main` (it refuses if the server has local changes or commits that are not on GitHub);
   - runs `npm ci` if `package.json`/`package-lock.json` changed;
   - validates the new version with `npm run check`, and **rolls back automatically** if that fails;
   - restarts itself (PM2 starts the new version).

`.update` is owner-only (sudo users cannot use it). It never accepts a URL or any other input: it only pulls from `UPDATE_REMOTE`/`UPDATE_BRANCH` (default `origin`/`main`) of the clone the bot runs from. That makes your GitHub account the key to your server. **Turn on two-factor authentication on GitHub**, and don't give others write access to the repository.

After an update, read `CHANGELOG.md` for new settings and compare your `.env` with `.env.example`. If the pairing service's dependencies changed, run `cd ~/whatsapp-bot/Bot_Pair_Code-main && npm ci --omit=dev` before you next use it.

### Manually (PM2)

```bash
cd ~/whatsapp-bot && git pull --ff-only
cd ~/whatsapp-bot/MD-main && npm ci --omit=dev && npm run check && pm2 restart whatsapp-bot
cd ~/whatsapp-bot/Bot_Pair_Code-main && npm ci --omit=dev
~/.local/bin/yt-dlp --update-to nightly
```

### Docker

The image contains a copy of the code, not a git clone, so `.update` can't replace the bot's code inside the container. It still reports what's new on GitHub, and `.update now` still updates yt-dlp. To update the bot:

```bash
cd ~/whatsapp-bot && git pull --ff-only && docker compose up -d --build && docker image prune -f
```

Every rebuild downloads the newest yt-dlp nightly. A yt-dlp update made with `.update now` lasts until the container is recreated.

## 9. Backing up and restoring the session

The session folder **is your WhatsApp login**. Anyone who has a copy controls the account. Back it up, but store backups like passwords (encrypted, never in chats or cloud folders you share).

The `data` folder holds your settings, and since 2.3.0 also the keys and cookies set from WhatsApp (`env-overrides.json`, `cookies/`). Protect its backups the same way.

Stop the bot briefly while copying, so the files are consistent.

### PM2

Back up (session plus settings):

```bash
mkdir -p ~/backups && chmod 700 ~/backups
pm2 stop whatsapp-bot
tar czf ~/backups/bot-$(date +%F).tar.gz -C ~/whatsapp-bot/MD-main session data
pm2 start whatsapp-bot
chmod 600 ~/backups/*.tar.gz
```

Optionally encrypt it (asks for a passphrase; creates a `.gpg` file):

```bash
gpg -c ~/backups/bot-$(date +%F).tar.gz && rm ~/backups/bot-$(date +%F).tar.gz
```

Restore (replace the date):

```bash
pm2 stop whatsapp-bot
rm -rf ~/whatsapp-bot/MD-main/session ~/whatsapp-bot/MD-main/data
tar xzf ~/backups/bot-2026-10-04.tar.gz -C ~/whatsapp-bot/MD-main
pm2 start whatsapp-bot
```

### Docker

Back up:

```bash
mkdir -p ~/backups && chmod 700 ~/backups
cd ~/whatsapp-bot && docker compose stop bot
docker run --rm -v whatsapp-bot_session:/session:ro -v whatsapp-bot_data:/data:ro -v ~/backups:/backup alpine tar czf /backup/bot-$(date +%F).tar.gz -C / session data
docker compose start bot
```

Restore (replace the date):

```bash
cd ~/whatsapp-bot && docker compose stop bot
docker run --rm -v whatsapp-bot_session:/session -v whatsapp-bot_data:/data -v ~/backups:/backup alpine sh -c "rm -rf /session/* /data/* && tar xzf /backup/bot-2026-10-04.tar.gz -C / && chown -R 1000:1000 /session /data"
docker compose start bot
```

### If the bot was logged out

When you remove the linked device from your phone, or WhatsApp ends the session, the bot moves the old session aside to `session.loggedout-<date>` (it never deletes it), logs what happened, and waits. Pair again ([step 7](#7-first-time-pairing)); it reconnects by itself. You can delete the `session.loggedout-*` folder once the bot works again.

## 10. Pairing service behind HTTPS (optional)

The SSH tunnel in step 7 is the safest way to reach the pairing page. If you really need it on a public address, put it behind HTTPS **and** a password, and only run it while pairing.

1. Point a DNS record (for example `pair.example.com`) at the server's IP.
2. Open the web ports:
   ```bash
   sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
   ```
3. Install Caddy (it obtains and renews HTTPS certificates automatically):
   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update && sudo apt install -y caddy
   ```
4. Create a password hash for the extra login prompt:
   ```bash
   caddy hash-password --plaintext 'choose-a-long-password'
   ```
5. Put this in `/etc/caddy/Caddyfile` (`sudo nano /etc/caddy/Caddyfile`), replacing the domain and pasting the hash:
   ```caddy
   pair.example.com {
       basic_auth {
           admin PASTE_THE_HASH_HERE
       }
       reverse_proxy 127.0.0.1:8000
   }
   ```
6. Tell the pairing service it is behind a proxy, so rate limiting sees real visitor IPs. Set `TRUST_PROXY=true` in `Bot_Pair_Code-main/.env`, then restart it.
7. Reload Caddy and open `https://pair.example.com`:
   ```bash
   sudo systemctl reload caddy
   ```

When you are done pairing, stop the pairing service. The site then shows an error, which is fine. Remove the Caddy site and close ports 80/443 if you don't need them.

<details>
<summary>Using nginx instead of Caddy</summary>

```nginx
server {
    listen 443 ssl http2;
    server_name pair.example.com;
    ssl_certificate     /etc/letsencrypt/live/pair.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pair.example.com/privkey.pem;
    auth_basic "Pairing";
    auth_basic_user_file /etc/nginx/.htpasswd;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Get a certificate with `sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d pair.example.com`. Create the password file with `sudo apt install -y apache2-utils && sudo htpasswd -c /etc/nginx/.htpasswd admin`.
</details>

## 11. Security checklist

- [ ] `.env` files are `chmod 600` and never committed or shared.
- [ ] You use **your own** API keys. Keys found in the old code are public and must not be reused (see `docs/SECURITY_AUDIT.md`, "Actions you must take").
- [ ] The pairing service runs only while pairing, and is reached through an SSH tunnel or HTTPS with a password.
- [ ] The health port (3000) and pairing port (8000) are bound to `127.0.0.1` (the default), and `ufw` allows only SSH (plus 80/443 if you use step 10).
- [ ] Backups of `session/` are encrypted and stored privately.
- [ ] In WhatsApp → Linked devices, only the devices you expect are listed.
- [ ] yt-dlp and the bot are updated regularly (`.update`, step 8).
- [ ] Your GitHub account has two-factor authentication on (it controls what `.update` installs).

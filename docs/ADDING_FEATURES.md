# Adding features

Everything here happens in `MD-main/src/`. You never need to edit the core (`src/core/`) to add a command or a listener: drop a file in the right folder and restart.

```
MD-main/src/
├── commands/<category>/*.js   one file per command (auto-loaded)
├── listeners/*.js             reactions to messages and events (auto-loaded)
├── services/*.js              shared helpers (stickers, moderation, AI, yt-dlp, …)
├── core/                      framework: loader, dispatcher, permissions, http, media, state
├── config.js                  every setting, read from .env
└── main.js                    startup
```

Before restarting, check your work without connecting to WhatsApp:

```bash
cd MD-main && npm run check && npm test && npm run lint
```

`npm run check` validates `.env`, loads every command and listener (invalid metadata or duplicate names stop it with a clear message), and prints the generated `.help` menu.

---

## 1. Adding a command

### Step by step

1. Copy the template into a category folder. The folder name is just for you; the `category` field decides where the command appears in `.help`:
   ```bash
   cp src/commands/_template.js src/commands/fun/coinflip.js
   ```
2. Edit the fields and write `run(ctx)`.
3. Run `npm run check`. Your command appears in the printed menu.
4. Restart the bot (`pm2 restart whatsapp-bot`, or `docker compose up -d --build bot`).

### Full example: `.coinflip`

`src/commands/fun/coinflip.js`:

```js
"use strict";

const { UserError } = require("../../core/errors");

module.exports = {
  name: "coinflip",                 // what users type after the prefix
  aliases: ["flip", "coin"],        // other names (must be unique across all commands)
  category: "fun",                  // section in .help
  description: "Flips a coin, or flips it several times and counts the results.",
  usage: "[times]",                 // shown after the name in .help
  examples: [".coinflip", ".coinflip 10"],
  permission: "user",               // user | groupAdmin | sudo | owner
  cooldown: 5,                      // seconds per user (owner/sudo exempt)

  async run(ctx) {
    const times = ctx.args[0] ? Number(ctx.args[0]) : 1;
    if (!Number.isInteger(times) || times < 1 || times > 100) {
      // UserError messages are shown to the user as "❌ <message>".
      throw new UserError("Give a number of flips between 1 and 100.");
    }
    if (times === 1) {
      return ctx.reply(Math.random() < 0.5 ? "🪙 Heads!" : "🪙 Tails!");
    }
    let heads = 0;
    for (let i = 0; i < times; i++) if (Math.random() < 0.5) heads++;
    return ctx.reply(`🪙 ${times} flips: ${heads} heads, ${times - heads} tails.`);
  },
};
```

What you get for free:

- `.coinflip`, `.flip` and `.coin` all work, with any configured prefix.
- It is listed in `.help`, and `.help coinflip` shows the description, aliases, examples and cooldown.
- The cooldown, private mode, bans and errors are handled by the dispatcher (`src/core/dispatcher.js`). If `run` throws anything other than a `UserError`, the error is logged and the user sees a generic "Something went wrong" message, never a stack trace.

### Metadata reference

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Lowercase letters, digits, dashes. Unique. |
| `aliases` | no | Extra names. Unique across all commands. |
| `category` | yes | `general`, `tools`, `info`, `admin`, `owner`, `sticker`, `image`, `textmaker`, `download`, `ai`, `fun`, `misc`, `anime`, `games`, or a new one (it appears at the end of `.help`). |
| `description` | yes | One or two sentences for `.help <command>`. |
| `usage` | no | Arguments, e.g. `<city>`, `[on|off]`, `(reply to an image)`. |
| `examples` | no | Strings starting with `.`; the dot is replaced by the configured prefix in `.help`. |
| `permission` | no (`user`) | Minimum level: `user`, `groupAdmin`, `sudo`, `owner`. Enforced centrally; do not re-check in `run`. `groupAdmin` also makes the command group-only. |
| `groupOnly` / `privateOnly` | no | Where it may be used. |
| `botAdmin` | no | The bot must be an admin of the group (kicking, deleting, changing group settings). |
| `cooldown` | no | Seconds between uses per user. Default `DEFAULT_COOLDOWN_SECONDS`. |
| `requires` | no | Capabilities needed: `ffmpeg`, `ytdlp`, `ai`, `font`, `newsApi`, `openWeather`, `tenor`, `telegramBot`, `removeBg`, `remini`, `githubRepo`. If one is missing, the command is disabled and hidden at startup. |
| `externalService` | no | Shown in `.help <command>` so users know their data leaves the bot. |
| `hidden` | no | Leave it out of the menu (still runnable). |
| `run(ctx)` | yes | The command itself (async). |

A file may also export an **array** of commands, which is handy for families of near-identical commands (see `src/commands/textmaker/textmaker.js`).

### The `ctx` object

| Field / method | What it is |
|---|---|
| `ctx.args` | Arguments as an array, original casing (`.tag Hello World` → `["Hello", "World"]`) |
| `ctx.text` | Everything after the command name, original casing |
| `ctx.commandName` | The name or alias the user typed |
| `ctx.prefix` | The configured prefix |
| `ctx.reply(textOrContent)` | Reply quoting the user's message. A string sends text; an object is a Baileys message (`{ image: buffer, caption }`, `{ sticker: buffer }`, …) |
| `ctx.send(textOrContent)` | Send to the same chat without quoting |
| `ctx.react("✅")` | React to the user's message |
| `ctx.chatId`, `ctx.isGroup` | Where the message came from |
| `ctx.sender`, `ctx.senderName` | Who sent it (JID, display name) |
| `ctx.level` | `owner`, `sudo` or `user` |
| `ctx.mentions` | JIDs @mentioned in the message |
| `ctx.quoted` | `{ message, sender, id }` of the replied-to message, or `null` |
| `ctx.target()` | First mention, else the replied-to author |
| `ctx.findMedia(opts)` | Finds media in the message or the replied one: `{ type, mimetype, size, viewOnce }` |
| `ctx.download(media, maxBytes?)` | Downloads it with a size cap (default `MAX_MEDIA_MB`) |
| `ctx.groupMetadata()` | Cached group info (subject, participants) |
| `ctx.isSenderAdmin()`, `ctx.isBotAdmin()` | Group admin checks (async) |
| `ctx.config` | The validated configuration (read-only) |
| `ctx.state` | Persistent JSON storage (see below) |
| `ctx.log` | Logger (`ctx.log.info({...}, "message")`) |
| `ctx.sock` | The raw Baileys socket, for anything else |
| `ctx.app` | Shared services: `ai`, `identity`, `permissions`, `groups`, `store` |

### Rules that keep the bot safe

- **Outgoing HTTP:** use `src/core/http.js` (`getJson`, `getBuffer`, `request`). It refuses private network addresses, follows redirects safely and caps sizes. Do not use `fetch`/`axios` directly with user-provided URLs.
- **Media from the internet:** download it into a Buffer first (`getBuffer`/`getImage`) and send the Buffer. **Never** pass `{ url: something }` built from external data to Baileys: if the value is not an http(s) URL, Baileys reads it as a local file path.
- **WhatsApp media:** always `ctx.download(media)` (size-capped). Never read whole streams yourself.
- **External programs:** use `runFfmpeg` from `src/core/media.js`, or `spawn` with an argument array. Never `exec` a string.
- **Secrets:** API keys come from `ctx.config` (see section 3), never from code.
- **Temporary files:** use `withTempDir(ctx.config.paths.tmp, async (dir) => …)`. The folder is always deleted.

### Storing data

```js
const store = ctx.state.store("coinflips", { total: 0 });  // file DATA_DIR/coinflips.json, with defaults
store.update((d) => { d.total += 1; });                    // saved atomically shortly after
const total = store.data.total;                            // read
```

---

## 2. Adding an event handler (listener)

Listeners react to things that are not commands: every message, group joins and leaves, calls, statuses. They live in `src/listeners/` and are loaded automatically.

### Kinds of listeners

| `event` | `phase` | Runs | `run` receives |
|---|---|---|---|
| `message` | `pre` | For **every** message, before commands (including from banned users). Used for moderation, auto-read and antidelete. Return `"stop"` to stop processing the message. | `ctx` (as for commands, but `ctx.args`/`ctx.text` are empty) |
| `message` | `post` | Only for messages that are **not** commands (and not from banned users). Used for games, chatbot and mention replies. Return `"stop"` to skip later listeners. | `ctx` |
| `command:after` |  | After every command | `ctx`, `command` |
| `group-participants.update` |  | Members join, leave, are promoted or demoted | `{ app, sock, config, log, state }`, `{ id, participants, action, author }` |
| `call` |  | Incoming calls | same first argument, list of calls |
| `status` |  | Someone posts a status | same first argument, the status message |

Optional fields: `priority` (lower runs first, default 100), `groupOnly`, `privateOnly`, `publicOnly` (skipped in private mode for non-owners), `requires` (same capabilities as commands).

### Full example: answer "good morning" in groups

`src/listeners/good-morning.js`:

```js
"use strict";

const { LRU } = require("../core/lru");

// Remember which groups were greeted, so each group gets at most one reply per 6 hours.
// LRU keeps memory bounded no matter how many groups the bot is in.
const greeted = new LRU({ max: 1000, ttlMs: 6 * 60 * 60 * 1000 });

module.exports = {
  name: "good-morning",
  event: "message",
  phase: "post",      // only for messages that are not commands
  priority: 60,
  groupOnly: true,
  publicOnly: true,

  async run(ctx) {
    if (ctx.fromMe || !/^good\s*morning\b/i.test(ctx.body)) return undefined;
    if (greeted.get(ctx.chatId)) return undefined;
    greeted.set(ctx.chatId, true);
    await ctx.reply(ctx.config.greetings.morning);   // configurable, see section 3
    return "stop";
  },
};
```

### Full example: log when the bot is added to a group

`src/listeners/joined-group.js`:

```js
"use strict";

module.exports = {
  name: "joined-group",
  event: "group-participants.update",
  async run({ sock, log }, { id, participants, action }) {
    const me = sock.user.id.replace(/:\d+@/, "@");
    const ids = participants.map((p) => (typeof p === "string" ? p : p.id));
    if (action === "add" && ids.includes(me)) log.info({ group: id }, "bot was added to a group");
  },
};
```

---

## 3. Adding a configuration value

All configuration is read and validated once, in `src/config.js`. Adding a value takes three small edits.

Example: make the good-morning reply text configurable with `GOOD_MORNING_TEXT`.

**1.** In `src/config.js`, add it to the returned `config` object (next to the other groups). The reader helpers are `r.str`, `r.int(name, default, min, max)`, `r.bool`, `r.oneOf(name, default, allowedValues)` and `r.list`. Invalid values are reported at startup together with all other problems:

```js
    greetings: {
      morning: r.str("GOOD_MORNING_TEXT", "Good morning everyone! ☀️"),
    },
```

**2.** In `.env.example`, document it:

```env
# Reply to the first "good morning" in a group (every 6 hours).
GOOD_MORNING_TEXT=Good morning everyone! ☀️
```

**3.** Use it anywhere through `ctx.config`, e.g. `ctx.config.greetings.morning`.

### A setting that switches a command on or off (API keys)

If a command must only exist when a key is configured:

1. Read the key in `src/config.js` under `keys`, e.g. `jokesApi: r.str("JOKES_API_KEY")`.
2. Add a capability in `detectCapabilities()` in `src/main.js`: `jokesApi: Boolean(config.keys.jokesApi),`
3. Declare it in the command: `requires: ["jokesApi"]`.

Without the key the command is not loaded and not shown in `.help`, and the startup log says why.

---

## 4. Testing your change

Tests use Node's built-in test runner and never connect to WhatsApp. `test/helpers.js` provides `makeApp()`, `makeSock()` and `makeMsg()` for driving the real dispatcher with fake messages. See `test/dispatcher.test.js` for examples. A test for `.coinflip`:

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands } = require("../src/core/loader");
const { COMMANDS_DIR } = require("../src/main");
const { makeApp, makeSock, makeMsg } = require("./helpers");

test(".coinflip 10 counts ten flips", async () => {
  const all = new Proxy({}, { get: () => true, has: () => true });
  const app = makeApp({ commands: loadCommands(COMMANDS_DIR, { capabilities: all }) });
  const sock = makeSock();
  await createDispatcher(app).handleMessage(sock, makeMsg({ text: ".coinflip 10", chat: "447911123456@s.whatsapp.net" }));
  assert.match(sock.sent.at(-1).content.text, /10 flips: \d+ heads, \d+ tails/);
});
```

Run everything:

```bash
cd MD-main && npm test
```

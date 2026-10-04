"use strict";

const { getJson } = require("../../core/http");
const games = require("../../services/games");
const { files } = require("../../services/settings");
const { at } = require("../../services/targets");

const WORDS = ["javascript", "whatsapp", "hangman", "nodejs", "keyboard", "pyramid", "giraffe", "rainbow", "galaxy", "chocolate"];

const decode = (s) =>
  String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

module.exports = [
  {
    name: "tictactoe",
    aliases: ["ttt"],
    category: "games",
    description: "Starts or joins a tic-tac-toe game. Play by sending a number 1-9; send 'surrender' to give up.",
    usage: "[room name]",
    async run(ctx) {
      if (games.findRoomOf(ctx.sender)) return ctx.reply("❌ You are already in a game. Send *surrender* to quit.");
      const name = ctx.text.slice(0, 30);
      const waiting = games.tictactoe.values().find((r) => r.state === "WAITING" && (name ? r.name === name : true));
      if (waiting) {
        waiting.o = ctx.chatId;
        waiting.game.playerO = ctx.sender;
        waiting.state = "PLAYING";
        const { game } = waiting;
        return ctx.send({
          text: `🎮 *TicTacToe started!*\n\nWaiting for ${at(game.currentTurn)} to play…\n\n${games.renderBoard(game)}\n\n• Send a number (1-9) to place your mark\n• Send *surrender* to give up`,
          mentions: [game.playerX, game.playerO],
        });
      }
      const id = `ttt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      games.tictactoe.set(id, { id, x: ctx.chatId, o: "", name, state: "WAITING", game: new games.TicTacToe(ctx.sender, "o") });
      return ctx.reply(`⏳ *Waiting for an opponent*\nType *${ctx.prefix}ttt${name ? ` ${name}` : ""}* to join!`);
    },
  },
  {
    name: "surrender",
    category: "games",
    description: "Gives up your current tic-tac-toe game.",
    async run(ctx) {
      if (!(await games.handleTicTacToeMove(ctx, "surrender"))) return ctx.reply("You are not in a game.");
      return undefined;
    },
  },
  {
    name: "hangman",
    category: "games",
    description: "Starts a game of hangman in this chat. Guess with .guess <letter>.",
    async run(ctx) {
      const word = WORDS[Math.floor(Math.random() * WORDS.length)];
      games.hangman.set(ctx.chatId, { word, masked: Array(word.length).fill("_"), guessed: [], wrong: 0, max: 6 });
      return ctx.reply(`Game started! The word is: ${Array(word.length).fill("_").join(" ")}`);
    },
  },
  {
    name: "guess",
    category: "games",
    description: "Guesses a letter in the current hangman game.",
    usage: "<letter>",
    async run(ctx) {
      const game = games.hangman.get(ctx.chatId);
      if (!game) return ctx.reply(`No game in progress. Start one with ${ctx.prefix}hangman`);
      const letter = (ctx.args[0] || "").toLowerCase();
      if (!/^[a-z]$/.test(letter)) return ctx.reply(`Guess one letter: ${ctx.prefix}guess <letter>`);
      if (game.guessed.includes(letter)) return ctx.reply(`You already guessed "${letter}".`);
      game.guessed.push(letter);
      if (game.word.includes(letter)) {
        [...game.word].forEach((ch, i) => ch === letter && (game.masked[i] = letter));
        if (!game.masked.includes("_")) {
          games.hangman.delete(ctx.chatId);
          return ctx.reply(`🎉 Congratulations! The word was: ${game.word}`);
        }
        return ctx.reply(`Good guess! ${game.masked.join(" ")}`);
      }
      game.wrong += 1;
      if (game.wrong >= game.max) {
        games.hangman.delete(ctx.chatId);
        return ctx.reply(`💀 Game over! The word was: ${game.word}`);
      }
      return ctx.reply(`Wrong guess! ${game.max - game.wrong} tries left.\n${game.masked.join(" ")}`);
    },
  },
  {
    name: "trivia",
    category: "games",
    description: "Asks a multiple-choice trivia question. Answer with .answer <answer>.",
    cooldown: 10,
    externalService: "opentdb.com",
    async run(ctx) {
      if (games.trivia.get(ctx.chatId)) return ctx.reply("A trivia question is already waiting for an answer!");
      const data = await getJson("https://opentdb.com/api.php?amount=1&type=multiple");
      const q = data.results?.[0];
      if (!q) return ctx.reply("Could not fetch a question. Try again later.");
      const options = [...q.incorrect_answers, q.correct_answer].map(decode).sort();
      games.trivia.set(ctx.chatId, { correct: decode(q.correct_answer) });
      return ctx.reply(`🧠 *Trivia*\n\n${decode(q.question)}\n\n${options.map((o) => `• ${o}`).join("\n")}\n\nAnswer with ${ctx.prefix}answer <answer>`);
    },
  },
  {
    name: "answer",
    category: "games",
    description: "Answers the current trivia question.",
    usage: "<answer>",
    async run(ctx) {
      const q = games.trivia.get(ctx.chatId);
      if (!q) return ctx.reply("No trivia question in progress.");
      if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}answer <answer>`);
      games.trivia.delete(ctx.chatId);
      const correct = ctx.text.trim().toLowerCase() === q.correct.toLowerCase();
      return ctx.reply(correct ? `✅ Correct! The answer is ${q.correct}` : `❌ Wrong! The correct answer was ${q.correct}`);
    },
  },
  {
    name: "topmembers",
    category: "games",
    description: "Shows the 5 most active members of this group (since the bot joined).",
    groupOnly: true,
    async run(ctx) {
      const counts = files.messageCounts(ctx.state).data[ctx.chatId] || {};
      const top = Object.entries(counts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);
      if (!top.length) return ctx.reply("No message activity recorded yet.");
      const text = top.map(([user, n], i) => `${i + 1}. ${at(user)} – ${n} messages`).join("\n");
      return ctx.send({ text: `🏆 *Top members*\n\n${text}`, mentions: top.map(([u]) => u) });
    },
  },
];

"use strict";

const TicTacToe = require("./tictactoe");
const { LRU } = require("../core/lru");
const { at } = require("./targets");

/** In-memory game state. Games expire after 30 minutes of inactivity. */
const TTL = 30 * 60 * 1000;
const tictactoe = new LRU({ max: 500, ttlMs: TTL }); // roomId → room
const hangman = new LRU({ max: 500, ttlMs: TTL }); // chatId → game
const trivia = new LRU({ max: 500, ttlMs: TTL }); // chatId → question

const EMOJI = { X: "❎", O: "⭕", 1: "1️⃣", 2: "2️⃣", 3: "3️⃣", 4: "4️⃣", 5: "5️⃣", 6: "6️⃣", 7: "7️⃣", 8: "8️⃣", 9: "9️⃣" };

function renderBoard(game) {
  const cells = game.render().map((v) => EMOJI[v]);
  return `${cells.slice(0, 3).join("")}\n${cells.slice(3, 6).join("")}\n${cells.slice(6).join("")}`;
}

function findRoomOf(player, state) {
  return tictactoe.values().find((r) => [r.game.playerX, r.game.playerO].includes(player) && (!state || r.state === state));
}

/** Handles a bare "1"-"9" or "surrender". Returns true if the message was a game move. */
async function handleTicTacToeMove(ctx, text) {
  const room = findRoomOf(ctx.sender, "PLAYING");
  if (!room) return false;
  const surrender = /^(surrender|give up)$/i.test(text);
  if (!surrender && !/^[1-9]$/.test(text)) return false;
  const { game } = room;
  if (!surrender && ctx.sender !== game.currentTurn) {
    await ctx.reply("❌ Not your turn!");
    return true;
  }
  if (surrender) {
    const winner = ctx.sender === game.playerX ? game.playerO : game.playerX;
    tictactoe.delete(room.id);
    await ctx.send({ text: `🏳️ ${at(ctx.sender)} surrendered! ${at(winner)} wins!`, mentions: [ctx.sender, winner] });
    return true;
  }
  const ok = game.turn(ctx.sender === game.playerO, Number(text) - 1);
  if (ok !== 1) {
    await ctx.reply("❌ Invalid move, that square is taken.");
    return true;
  }
  tictactoe.set(room.id, room); // refresh TTL
  const winner = game.winner;
  const tie = !winner && game.turns === 9;
  const status = winner ? `🎉 ${at(winner)} wins!` : tie ? "🤝 It's a draw!" : `🎲 Turn: ${at(game.currentTurn)}`;
  const text2 = `🎮 *TicTacToe*\n\n${status}\n\n${renderBoard(game)}\n\n❎ ${at(game.playerX)}\n⭕ ${at(game.playerO)}`;
  const mentions = [game.playerX, game.playerO];
  await ctx.sock.sendMessage(room.x, { text: text2, mentions });
  if (room.o !== room.x) await ctx.sock.sendMessage(room.o, { text: text2, mentions });
  if (winner || tie) tictactoe.delete(room.id);
  return true;
}

module.exports = { TicTacToe, tictactoe, hangman, trivia, renderBoard, findRoomOf, handleTicTacToeMove };

"use strict";

const todo = require("../../services/todo");
const { UserError } = require("../../core/errors");

/** Group admins (and owner/sudo) manage the whole list; in a private chat it's yours. */
async function isManager(ctx) {
  if (!ctx.isGroup || ctx.isSudoOrOwner) return true;
  return ctx.isSenderAdmin();
}

function render(ctx) {
  const items = todo.list(ctx.state, ctx.chatId);
  if (!items.length) return `📋 The to-do list is empty.\nAdd: ${ctx.prefix}todo add <task>`;
  const open = items.filter((x) => !x.done).length;
  const lines = items.map((x) => `${x.done ? "✅" : "⬜"} *${x.id}.* ${x.done ? `~${x.text}~` : x.text}`);
  return `📋 *To-do* (${open} open, ${items.length - open} done)\n\n${lines.join("\n")}\n\n${ctx.prefix}todo done <n> · ${ctx.prefix}todo add <task> · ${ctx.prefix}todo del <n>`;
}

const idArg = (ctx) => {
  const n = Number(String(ctx.args[1] || "").replace(/^#/, "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (!Number.isInteger(n) || n < 1) throw new UserError(`Give the task number, e.g. ${ctx.prefix}todo ${ctx.args[0]} 2`);
  return n;
};

module.exports = {
  name: "todo",
  aliases: ["tasks", "todolist", "mahamm"],
  category: "tools",
  description: "A shared to-do list for this chat: anyone can add tasks and tick them off; the author or an admin can delete one, admins can clear the list.",
  usage: "add <task> | done <n> | del <n> | clear [all] | (no argument: the list)",
  examples: [".todo add Buy the projector", ".todo done 2", ".todo", ".todo clear"],
  cooldown: 2,
  async run(ctx) {
    const sub = (ctx.args[0] || "").toLowerCase();
    if (!sub || sub === "list") return ctx.reply(render(ctx));
    if (sub === "add" || sub === "+") {
      const item = todo.add(ctx.state, ctx.chatId, ctx.sender, ctx.text.slice(ctx.args[0].length));
      return ctx.reply(`➕ Added *${item.id}.* ${item.text}`);
    }
    if (sub === "done" || sub === "check" || sub === "undo") {
      const item = todo.toggle(ctx.state, ctx.chatId, ctx.sender, idArg(ctx));
      return ctx.reply(`${item.done ? "✅ Done" : "⬜ Not done"}: *${item.id}.* ${item.text}`);
    }
    if (sub === "del" || sub === "delete" || sub === "rm") {
      const item = todo.remove(ctx.state, ctx.chatId, ctx.sender, idArg(ctx), { manager: await isManager(ctx) });
      return ctx.reply(`🗑️ Deleted *${item.id}.* ${item.text}`);
    }
    if (sub === "clear") {
      if (!(await isManager(ctx))) return ctx.reply("Only group admins can clear the list.");
      const all = (ctx.args[1] || "").toLowerCase() === "all";
      const n = todo.clear(ctx.state, ctx.chatId, { all });
      return ctx.reply(n ? `🧹 Removed ${n} ${all ? "" : "finished "}task(s).` : "Nothing to clear.");
    }
    return ctx.reply(`Usage: ${ctx.prefix}todo add <task> | done <n> | del <n> | clear [all]`);
  },
};

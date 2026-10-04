"use strict";

/**
 * Names and defaults of the bot's persistent state files (in DATA_DIR).
 * File names and shapes match the original bot, so existing data keeps working.
 */

const GROUP_DEFAULTS = {
  antilink: {}, // { [groupJid]: { enabled, action: delete|kick|warn } }
  antitag: {}, // { [groupJid]: { enabled, action: delete|kick } }
  antibadword: {}, // { [groupJid]: { enabled, action: delete|kick|warn } }
  welcome: {}, // { [groupJid]: { enabled, message } }
  goodbye: {}, // { [groupJid]: { enabled, message } }
  chatbot: {}, // { [groupJid]: true }
  sudo: [], // [ jid ]
  autoReaction: false,
};

const groupData = (state) => state.store("userGroupData", GROUP_DEFAULTS);
const toggle = (state, name, defaults = { enabled: false }) => state.store(name, defaults);
const sudoList = (state) => groupData(state).data.sudo || [];

const PM_BLOCK_DEFAULT_MESSAGE =
  "⚠️ Direct messages to this bot are blocked. Please contact the owner in a group instead.";

const files = {
  antidelete: (s) => toggle(s, "antidelete"),
  autoread: (s) => toggle(s, "autoread"),
  autotyping: (s) => toggle(s, "autotyping"),
  autoStatus: (s) => toggle(s, "autoStatus", { enabled: false, reactOn: false }),
  anticall: (s) => toggle(s, "anticall"),
  pmblocker: (s) => toggle(s, "pmblocker", { enabled: false, message: PM_BLOCK_DEFAULT_MESSAGE }),
  mention: (s) => toggle(s, "mention", { enabled: false, assetPath: "", type: "text" }),
  banned: (s) => s.store("banned", []),
  warnings: (s) => s.store("warnings", {}),
  messageCounts: (s) => s.store("messageCounts", {}),
};

module.exports = { groupData, toggle, sudoList, files, GROUP_DEFAULTS, PM_BLOCK_DEFAULT_MESSAGE };

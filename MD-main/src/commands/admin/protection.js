"use strict";

const { featureCommand } = require("../../services/moderation");

const base = { category: "admin", permission: "groupAdmin", botAdmin: true, usage: "on | off | set <action> | get" };

module.exports = [
  {
    ...base,
    name: "antilink",
    description: "Deletes links posted by non-admins. Action: delete, kick or warn.",
    examples: [".antilink on", ".antilink set warn"],
    run: featureCommand({ key: "antilink", label: "Antilink", actions: ["delete", "kick", "warn"] }),
  },
  {
    ...base,
    name: "antitag",
    description: "Deletes messages from non-admins that mention most of the group. Action: delete or kick.",
    run: featureCommand({ key: "antitag", label: "Antitag", actions: ["delete", "kick"] }),
  },
  {
    ...base,
    name: "antibadword",
    description: "Deletes messages from non-admins that contain bad words. Action: delete, kick or warn.",
    run: featureCommand({ key: "antibadword", label: "Antibadword", actions: ["delete", "kick", "warn"] }),
  },
];

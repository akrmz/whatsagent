"use strict";

const leads = require("./leads");

/**
 * New clients handed to the team in turn (.team autoassign @a @b): a client who arrives by
 * themselves (a #12 question, a written request, the customer assistant, a self-booked
 * viewing) is assigned to the next member, so their notices, viewing reminders and handoffs
 * go to that member instead of the owner. Clients the team adds by hand are not touched.
 *   DATA_DIR/rotation.json { on, members: [jid], next }
 */

const store = (state) => state.store("rotation", { on: false, members: [], next: 0 });
const settings = (state) => ({ ...store(state).data });

function setMembers(state, members) {
  const list = [...new Set(members)];
  store(state).update((d) => Object.assign(d, { on: list.length > 0, members: list, next: 0 }));
  return settings(state);
}
const turnOff = (state) => store(state).update((d) => Object.assign(d, { on: false }));

/** The member whose turn it is (without moving the turn), or null. */
function nextMember(state) {
  const s = store(state).data;
  return s.on && s.members.length ? s.members[s.next % s.members.length] : null;
}

/**
 * Gives a new client to the member whose turn it is. A client already assigned keeps their
 * member. @returns {string|null} the member's jid
 */
function assignNext(state, leadId, now = Date.now()) {
  const lead = leads.get(state, leadId);
  if (!lead) return null;
  if (lead.assignee) return lead.assignee;
  const member = nextMember(state);
  if (!member) return null;
  store(state).update((d) => (d.next = (d.next + 1) % d.members.length));
  leads.update(state, leadId, { assignee: member }, now);
  leads.note(state, leadId, "bot", `أُسند تلقائياً إلى @${member.split("@")[0]}`, now);
  return member;
}

/** Who hears about a client: their assigned member, else the owner. */
const notifyJid = (config, lead) => lead?.assignee || `${config.owners.numbers[0]}@s.whatsapp.net`;

module.exports = { settings, setMembers, turnOff, nextMember, assignNext, notifyJid };

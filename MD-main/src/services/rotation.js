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

/** Still on the team: the owner or a sudo user (someone whose sudo was removed is not). */
const isStaff = (app, jid) => Boolean(jid) && (app.permissions.isOwner(jid) || app.permissions.isSudo(jid));
const ownerJid = (config) => `${config.owners.numbers[0]}@s.whatsapp.net`;

/** The member whose turn it is (without moving the turn), skipping anyone no longer on the team; or null. */
function nextMember(app) {
  const s = store(app.state).data;
  if (!s.on || !s.members.length) return null;
  for (let i = 0; i < s.members.length; i++) {
    const m = s.members[(s.next + i) % s.members.length];
    if (isStaff(app, m)) return m;
  }
  return null;
}

/**
 * Gives a new client to the member whose turn it is. A client already assigned keeps their
 * member. @returns {string|null} the member's jid
 */
function assignNext(app, leadId, now = Date.now()) {
  const lead = leads.get(app.state, leadId);
  if (!lead) return null;
  if (lead.assignee) return lead.assignee;
  const member = nextMember(app);
  if (!member) return null;
  store(app.state).update((d) => (d.next = (d.members.indexOf(member) + 1) % d.members.length));
  leads.update(app.state, leadId, { assignee: member }, now);
  leads.note(app.state, leadId, "bot", `أُسند تلقائياً إلى @${member.split("@")[0]}`, now);
  return member;
}

/**
 * Who hears about a client: their assigned member while still on the team, else the owner —
 * so removing someone's sudo also stops clients' details reaching them.
 */
const notifyJid = (app, lead) => (isStaff(app, lead?.assignee) ? lead.assignee : ownerJid(app.config));

module.exports = { settings, setMembers, turnOff, nextMember, assignNext, notifyJid, isStaff };

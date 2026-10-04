import fs from "node:fs";
import path from "node:path";

function hasRegisteredCreds(dir) {
  try {
    const creds = JSON.parse(fs.readFileSync(path.join(dir, "creds.json"), "utf8"));
    return Boolean(creds.registered || creds.me);
  } catch {
    return false;
  }
}

function copySessionFiles(fromDir, toDir) {
  fs.mkdirSync(toDir, { recursive: true, mode: 0o700 });
  for (const name of fs.readdirSync(fromDir)) {
    const src = path.join(fromDir, name);
    if (!fs.statSync(src).isFile()) continue;
    const dest = path.join(toDir, name);
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o600);
  }
}

/**
 * Copies a freshly paired session (Baileys multi-file auth state) to where the bot reads it.
 * An existing, registered session is never overwritten unless `overwrite` is true;
 * instead the new session is written next to it as `<dir>.new-<timestamp>`.
 *
 * @returns {{ path: string, replaced: boolean, sidecar: boolean }}
 */
export function deliverLocal(fromDir, outputDir, { overwrite = false } = {}) {
  if (!hasRegisteredCreds(outputDir) || overwrite) {
    const replaced = hasRegisteredCreds(outputDir);
    if (replaced) {
      fs.renameSync(outputDir, `${outputDir}.bak-${Date.now()}`);
    }
    copySessionFiles(fromDir, outputDir);
    return { path: outputDir, replaced, sidecar: false };
  }
  const sidecarDir = `${outputDir}.new-${Date.now()}`;
  copySessionFiles(fromDir, sidecarDir);
  return { path: sidecarDir, replaced: false, sidecar: true };
}

/** Sends creds.json to the account's own chat (legacy behaviour, opt-in). */
export async function deliverWhatsApp(sock, fromDir) {
  const userJid = sock.user?.id?.replace(/:\d+@/, "@");
  if (!userJid) throw new Error("Could not determine the linked account's JID");
  const creds = fs.readFileSync(path.join(fromDir, "creds.json"));
  await sock.sendMessage(userJid, {
    document: creds,
    mimetype: "application/json",
    fileName: "creds.json",
  });
  await sock.sendMessage(userJid, {
    text:
      "This file is your bot session. Anyone who has it controls this WhatsApp account.\n" +
      "Copy it to the bot's session/ folder, then delete this message (Delete for me).",
  });
  return { jid: userJid };
}

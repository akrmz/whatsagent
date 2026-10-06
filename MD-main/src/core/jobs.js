"use strict";

const { UserError } = require("./errors");

/**
 * Limits how many heavy external programs (yt-dlp, ffmpeg) run at the same time, so a
 * busy group can't exhaust the server's CPU/RAM. Extra jobs wait in a queue; when the
 * queue is full the user is told to try again. MAX_PARALLEL_JOBS sets the limit.
 */

let max = 2;
const MAX_QUEUE = 25;
let running = 0;
const queue = [];

function setLimit(n) {
  max = Math.max(1, Number(n) || 1);
  drain();
}

function drain() {
  while (running < max && queue.length) {
    running++;
    queue.shift()();
  }
}

/** Runs fn() when a slot is free. @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
async function heavy(fn) {
  if (running >= max) {
    if (queue.length >= MAX_QUEUE) throw new UserError("The server is busy with other downloads and conversions. Try again in a minute.");
    await new Promise((resolve) => queue.push(resolve));
  } else {
    running++;
  }
  try {
    return await fn();
  } finally {
    running--;
    drain();
  }
}

const status = () => ({ running, queued: queue.length, max });

module.exports = { heavy, setLimit, status };

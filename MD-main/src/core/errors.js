"use strict";

/**
 * Throw a UserError from a command to show `message` to the user as-is.
 * Any other error is logged and the user sees a generic failure message, so
 * internal details (paths, stack traces, API responses) never leak into chats.
 */
class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserError";
  }
}

module.exports = { UserError };

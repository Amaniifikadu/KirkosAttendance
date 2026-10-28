"use strict";

const path = require("node:path");
const { TextDecoder } = require("node:util");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const Admin = require("../src/models/Admin");
const connectToDatabase = require("../src/config/database");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_BYTES = 72;
const BCRYPT_ROUNDS = 12;
const CONFIRMATION_PHRASE = "RESET ADMIN PASSWORD";

class SafeError extends Error {}

function requireInteractiveTerminal() {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    typeof process.stdin.setRawMode !== "function"
  ) {
    throw new SafeError(
      "Run this script in an interactive terminal that supports hidden input."
    );
  }
}

function createTerminalReader() {
  const input = process.stdin;
  const output = process.stdout;
  const originalRawMode = input.isRaw;

  let activePrompt = null;
  let closed = false;
  let cleanupComplete = false;
  let cleanupFailed = false;
  let rawModeChangeAttempted = false;
  let skipNextLineFeed = false;

  function attemptCleanup(action) {
    try {
      action();
    } catch {
      cleanupFailed = true;
    }
  }

  function cleanup() {
    if (cleanupComplete) {
      return;
    }
    cleanupComplete = true;

    attemptCleanup(() => input.removeListener("data", onData));
    attemptCleanup(() => input.removeListener("error", onInputError));
    attemptCleanup(() => input.removeListener("end", onEnd));
    attemptCleanup(() => output.removeListener("error", onOutputError));
    attemptCleanup(() => process.removeListener("SIGINT", onSigint));

    if (rawModeChangeAttempted) {
      attemptCleanup(() => input.setRawMode(Boolean(originalRawMode)));
    }

    attemptCleanup(() => input.pause());
  }

  function finish(error) {
    if (closed) {
      return;
    }

    closed = true;
    const prompt = activePrompt;
    activePrompt = null;
    cleanup();

    if (prompt) {
      prompt.reject(error || new SafeError("Terminal input was closed."));
    }
  }

  function appendDecoded(prompt, text) {
    for (const character of text) {
      if (character === "\b" || character === "\u007f") {
        const characters = Array.from(prompt.value);
        if (characters.length > 0) {
          characters.pop();
          prompt.value = characters.join("");
        }
      } else if (/[\u0000-\u001f\u007f]/u.test(character)) {
        finish(new SafeError("Terminal input contains an unsupported control character."));
        return;
      } else {
        prompt.value += character;
      }
    }
  }

  function handleBackspace(prompt) {
    if (!finalizeDecoder(prompt)) {
      return false;
    }

    const characters = Array.from(prompt.value);
    if (characters.length > 0) {
      characters.pop();
      prompt.value = characters.join("");
    }

    prompt.decoder = new TextDecoder("utf-8", { fatal: true });
    return true;
  }

  function decodeBytes(prompt, bytes) {
    try {
      appendDecoded(prompt, prompt.decoder.decode(bytes, { stream: true }));
      return true;
    } catch {
      finish(new SafeError("Terminal input was not valid UTF-8."));
      return false;
    }
  }

  function finalizeDecoder(prompt) {
    try {
      appendDecoded(prompt, prompt.decoder.decode());
      return true;
    } catch {
      finish(new SafeError("Terminal input was not valid UTF-8."));
      return false;
    }
  }

  function completePrompt(prompt) {
    if (!finalizeDecoder(prompt)) {
      return;
    }
    if (closed || activePrompt !== prompt) {
      return;
    }

    try {
      output.write("\n");
    } catch {
      finish(new SafeError("Could not complete the terminal prompt."));
      return;
    }
    activePrompt = null;
    prompt.resolve(prompt.trim ? prompt.value.trim() : prompt.value);
  }

  function rejectUnexpectedInput() {
    finish(
      new SafeError(
        "Input arrived between prompts. No further input was accepted."
      )
    );
  }

  function onData(buffer) {
    if (closed) {
      return;
    }

    let offset = 0;

    if (skipNextLineFeed) {
      skipNextLineFeed = false;
      if (buffer[offset] === 0x0a) {
        offset += 1;
      }
    }

    while (offset < buffer.length && !closed) {
      if (skipNextLineFeed) {
        skipNextLineFeed = false;
        if (buffer[offset] === 0x0a) {
          offset += 1;
          continue;
        }
      }

      const prompt = activePrompt;
      if (!prompt) {
        rejectUnexpectedInput();
        return;
      }

      let delimiter = offset;
      while (
        delimiter < buffer.length &&
        buffer[delimiter] !== 0x0a &&
        buffer[delimiter] !== 0x0d &&
        buffer[delimiter] !== 0x03 &&
        buffer[delimiter] !== 0x04 &&
        buffer[delimiter] !== 0x08 &&
        buffer[delimiter] !== 0x7f &&
        buffer[delimiter] !== 0x1a
      ) {
        delimiter += 1;
      }

      if (delimiter > offset) {
        if (!decodeBytes(prompt, buffer.subarray(offset, delimiter))) {
          return;
        }
        offset = delimiter;
      }

      if (offset >= buffer.length) {
        return;
      }

      const byte = buffer[offset];
      offset += 1;

      if (byte === 0x03) {
        finish(new SafeError("Password reset cancelled."));
        return;
      }

      if (byte === 0x04 || byte === 0x1a) {
        finish(new SafeError("Terminal input ended."));
        return;
      }

      if (byte === 0x08 || byte === 0x7f) {
        if (!handleBackspace(prompt)) {
          return;
        }
        continue;
      }

      if (byte === 0x0d || byte === 0x0a) {
        completePrompt(prompt);
        if (closed) {
          return;
        }
        if (byte === 0x0d) {
          skipNextLineFeed = true;
        }
      }
    }
  }

  function onInputError() {
    finish(new SafeError("Could not read terminal input."));
  }

  function onOutputError() {
    finish(new SafeError("Could not write terminal output."));
  }

  function onEnd() {
    finish(new SafeError("Terminal input ended."));
  }

  function onSigint() {
    finish(new SafeError("Password reset cancelled."));
  }

  input.on("data", onData);
  input.once("error", onInputError);
  input.once("end", onEnd);
  output.once("error", onOutputError);
  process.once("SIGINT", onSigint);

  try {
    rawModeChangeAttempted = true;
    input.setRawMode(true);
    input.resume();
  } catch {
    finish(new SafeError("Could not enable hidden terminal input."));
    throw new SafeError("Could not enable hidden terminal input.");
  }

  function readLine(promptText, { trim = false } = {}) {
    if (closed) {
      return Promise.reject(new SafeError("Terminal input is closed."));
    }
    if (activePrompt) {
      return Promise.reject(new SafeError("Another prompt is already active."));
    }

    return new Promise((resolve, reject) => {
      activePrompt = {
        decoder: new TextDecoder("utf-8", { fatal: true }),
        value: "",
        trim,
        resolve,
        reject,
      };

      try {
        output.write(promptText);
      } catch {
        finish(new SafeError("Could not display the terminal prompt."));
      }
    });
  }

  return {
    askLine(promptText) {
      return readLine(promptText, { trim: true });
    },

    askExactLine(promptText) {
      return readLine(promptText);
    },

    readHidden(promptText) {
      return readLine(promptText);
    },

    close() {
      finish();
    },

    get cleanupFailed() {
      return cleanupFailed;
    },
  };
}

function validatePassword(password) {
  if (Array.from(password).length < MIN_PASSWORD_LENGTH) {
    throw new SafeError(
      `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }

  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    throw new SafeError(
      `The password must be no more than ${MAX_PASSWORD_BYTES} UTF-8 bytes for bcrypt.`
    );
  }
}

async function performReset(state) {
  if (process.argv.length !== 2) {
    throw new SafeError("This script does not accept command-line arguments.");
  }

  requireInteractiveTerminal();

  if (!process.env.MONGODB_URI) {
    throw new SafeError("MONGODB_URI is not configured in the backend .env.");
  }

  await connectToDatabase();
  const databaseName = mongoose.connection.name;
  console.log(`Connected database: ${databaseName}`);

  state.reader = createTerminalReader();
  const enteredEmail = await state.reader.askLine(
    "Existing administrator email (input is not echoed): "
  );

  if (!EMAIL_PATTERN.test(enteredEmail) || enteredEmail.length > 254) {
    throw new SafeError("Enter a valid administrator email.");
  }

  const normalizedEmail = enteredEmail.toLowerCase();
  const matches = await Admin.find({
    email: normalizedEmail,
    role: "admin",
  })
    .select("+passwordHash")
    .limit(2);

  if (matches.length !== 1) {
    throw new SafeError(
      `Expected exactly one matching administrator; found ${matches.length}. No update was attempted.`
    );
  }

  const admin = matches[0];
  if (typeof admin.passwordHash !== "string" || !admin.passwordHash) {
    throw new SafeError(
      "The administrator password hash could not be loaded. No update was attempted."
    );
  }

  console.log(`Administrator email: ${normalizedEmail}`);
  console.log(`Target database: ${databaseName}`);

  let password;
  let passwordConfirmation;
  let newPasswordHash;

  try {
    password = await state.reader.readHidden("New password (hidden): ");
    passwordConfirmation = await state.reader.readHidden(
      "Confirm new password (hidden): "
    );

    if (password !== passwordConfirmation) {
      throw new SafeError(
        "The passwords did not match. No update was attempted."
      );
    }

    validatePassword(password);
    newPasswordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const confirmation = await state.reader.askExactLine(
      `Type "${CONFIRMATION_PHRASE}" to proceed (input is not echoed): `
    );
    if (confirmation !== CONFIRMATION_PHRASE) {
      throw new SafeError(
        "Confirmation did not match. No update was attempted."
      );
    }

    state.writeAttempted = true;
    let updateResult;
    try {
      updateResult = await Admin.collection.updateOne(
        {
          _id: admin._id,
          passwordHash: admin.passwordHash,
          email: normalizedEmail,
          role: "admin",
        },
        {
          $set: { passwordHash: newPasswordHash },
        },
        { upsert: false }
      );
    } catch {
      throw new SafeError("The database write outcome is uncertain.");
    }

    if (updateResult.matchedCount === 0) {
      state.writeNoMatch = true;
      throw new SafeError(
        "The administrator record changed before the update; no document matched the update guard."
      );
    }

    if (
      updateResult.matchedCount !== 1 ||
      updateResult.modifiedCount !== 1
    ) {
      throw new SafeError("The database did not confirm exactly one update.");
    }

    state.writeConfirmed = true;

    let updatedAdmin;
    let passwordVerified;
    try {
      updatedAdmin = await Admin.findOne({
        _id: admin._id,
        email: normalizedEmail,
        role: "admin",
      }).select("+passwordHash");

      passwordVerified =
        updatedAdmin &&
        (await bcrypt.compare(password, updatedAdmin.passwordHash));
    } catch {
      throw new SafeError("Post-update verification could not be completed.");
    }

    if (!passwordVerified) {
      throw new SafeError("Post-update password verification failed.");
    }

    state.resetVerified = true;
  } finally {
    password = undefined;
    passwordConfirmation = undefined;
    newPasswordHash = undefined;
  }
}

async function main() {
  const state = {
    reader: null,
    writeAttempted: false,
    writeNoMatch: false,
    writeConfirmed: false,
    resetVerified: false,
  };

  let operationError = null;
  let cleanupFailed = false;

  try {
    await performReset(state);
  } catch (error) {
    operationError = error;
  } finally {
    if (state.reader) {
      try {
        state.reader.close();
        cleanupFailed = cleanupFailed || state.reader.cleanupFailed;
      } catch {
        cleanupFailed = true;
      }
    }

    if (mongoose.connection.readyState !== 0) {
      try {
        await mongoose.disconnect();
      } catch {
        cleanupFailed = true;
      }
    }
  }

  if (state.resetVerified) {
    console.log("Administrator password reset and verified.");
  } else if (state.writeConfirmed) {
    console.error(
      "The password update was confirmed, but post-update verification failed. The new password may be active; do not retry blindly."
    );
    process.exitCode = 1;
  } else if (state.writeAttempted && !state.writeNoMatch) {
    console.error(
      "The database write outcome is uncertain; the password may already have changed. Do not retry or restore automatically. Verify the account state before taking further action."
    );
    process.exitCode = 1;
  } else if (operationError instanceof SafeError) {
    console.error(operationError.message);
    process.exitCode = 1;
  } else if (operationError) {
    console.error(
      "Password reset failed due to a database or runtime error. Sensitive details were not displayed."
    );
    process.exitCode = 1;
  }

  if (cleanupFailed) {
    console.error(
      "Cleanup reported an error while restoring terminal state or closing the database connection."
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error("Password reset failed due to an unexpected runtime error.");
    process.exitCode = 1;
  });
}
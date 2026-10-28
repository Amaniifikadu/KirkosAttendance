require("dotenv").config();

const bcrypt = require("bcryptjs");
const readline = require("node:readline");
const Admin = require("../src/models/Admin");
const connectToDatabase = require("../src/config/database");
const { getJwtSecret } = require("../src/middleware/authenticateAdmin");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;
const MAX_BCRYPT_PASSWORD_BYTES = 72;

function ask(question) {
  return new Promise((resolve, reject) => {
    const terminal = process.stdin.isTTY && process.stdout.isTTY;
    const interfaceOptions = {
      input: process.stdin,
      output: process.stdout,
      terminal,
    };
    const rl = readline.createInterface(interfaceOptions);
    let value = "";

    if (terminal) {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    process.stdout.write(question);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", function onData(chunk) {
      for (const character of chunk) {
        if (character === "\n" || character === "\r") {
          process.stdin.removeListener("data", onData);
          rl.close();
          process.stdout.write("\n");
          resolve(value);
        } else if (character === "\u0003") {
          process.stdin.removeListener("data", onData);
          rl.close();
          reject(new Error("Administrator setup cancelled."));
        } else if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    });
  });
}

async function readPassword() {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    typeof process.stdin.setRawMode !== "function"
  ) {
    throw new Error(
      "Run this one-time setup command in an interactive terminal so the password can be entered hidden."
    );
  }

  return new Promise((resolve, reject) => {
    const wasRaw = process.stdin.isRaw;
    let password = "";
    let settled = false;

    const restore = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(Boolean(wasRaw));
      process.stdout.write("\n");
    };

    const onData = (buffer) => {
      for (const character of buffer.toString("utf8")) {
        if (character === "\u0003") {
          settled = true;
          restore();
          reject(new Error("Administrator setup cancelled."));
          return;
        }

        if (character === "\r" || character === "\n") {
          settled = true;
          restore();
          resolve(password);
          return;
        }

        if (character === "\u007f" || character === "\b") {
          password = password.slice(0, -1);
          continue;
        }

        password += character;
      }
    };

    process.stdout.write("Administrator password (hidden): ");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);

    process.once("SIGINT", () => {
      if (!settled) {
        settled = true;
        restore();
        reject(new Error("Administrator setup cancelled."));
      }
    });
  });
}

async function bootstrapAdmin() {
  getJwtSecret();
  await connectToDatabase();

  try {
    try {
      await Admin.createCollection();
    } catch (error) {
      if (error.code !== 48) {
        throw error;
      }
    }

    await Admin.createIndexes();

    const existingAdmin = await Admin.exists({ role: "admin" });
    if (existingAdmin) {
      throw new Error(
        "An administrator already exists. Initial administrator setup is one-time only."
      );
    }

    const email = (await ask("Administrator email: ")).trim().toLowerCase();

    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      throw new Error("Enter a valid administrator email address.");
    }

    const password = await readPassword();
    const passwordBytes = Buffer.byteLength(password, "utf8");

    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `Administrator password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      );
    }

    if (passwordBytes > MAX_BCRYPT_PASSWORD_BYTES) {
      throw new Error(
        "Administrator password must be no more than 72 UTF-8 bytes for bcrypt."
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await Admin.create({
      email,
      passwordHash,
      role: "admin",
      bootstrapKey: "initial-admin",
    });

    console.log("Initial administrator created. Keep the credentials private.");
  } finally {
    const mongoose = require("mongoose");
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

bootstrapAdmin()
  .catch((error) => {
    console.error(`Administrator setup failed: ${error.message}`);
    process.exitCode = 1;
  });

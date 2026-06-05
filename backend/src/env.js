"use strict";

const fs = require("node:fs");
const path = require("node:path");

function stripInlineComment(value) {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  // Walk the value character by character so we only treat # as a comment marker
  // when it is outside quotes.
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const previous = value[index - 1];

    if (character === "'" && !inDoubleQuote && previous !== "\\") {
      inSingleQuote = !inSingleQuote;
    }

    if (character === '"' && !inSingleQuote && previous !== "\\") {
      inDoubleQuote = !inDoubleQuote;
    }

    if (character === "#" && !inSingleQuote && !inDoubleQuote) {
      const beforeHash = value[index - 1];
      if (index === 0 || /\s/.test(beforeHash)) {
        return value.slice(0, index).trim();
      }
    }
  }

  return value.trim();
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvFile(contents) {
  const values = {};

  // We keep the parser deliberately small: key=value lines, comments, and quoted strings.
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = unquote(stripInlineComment(line.slice(equalsIndex + 1)));

    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      values[key] = value;
    }
  }

  return values;
}

function loadEnvFile(filePath = path.join(__dirname, "..", ".env"), targetEnv = process.env) {
  if (!fs.existsSync(filePath)) {
    // Missing .env is normal; the backend can still run from shell environment variables alone.
    return {
      loaded: false,
      path: filePath,
      values: {},
    };
  }

  const values = parseEnvFile(fs.readFileSync(filePath, "utf8"));

  for (const [key, value] of Object.entries(values)) {
    if (targetEnv[key] === undefined) {
      // Only fill gaps so explicit shell variables always win.
      targetEnv[key] = value;
    }
  }

  return {
    loaded: true,
    path: filePath,
    values,
  };
}

module.exports = {
  loadEnvFile,
  parseEnvFile,
};

"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Removes inline `#` comments from an env value while respecting quoted text.
 * @param {string} value - Raw value text from the right-hand side of a `key=value` line.
 * @returns {string} The value with any trailing inline comment removed and whitespace trimmed.
 */
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

/**
 * Removes matching outer quotes from a string value.
 * @param {string} value - A possibly quoted string value.
 * @returns {string} The unquoted value when the outer quotes match, otherwise the original value.
 */
function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

/**
 * Parses the contents of a `.env` file into a simple object.
 * @param {string} contents - Entire file contents read from disk.
 * @returns {Record<string, string>} Parsed environment variable values.
 */
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

/**
 * Loads a `.env` file into an environment object without overwriting existing keys.
 * @param {string} [filePath=path.join(__dirname, "..", ".env")] - Location of the env file to read.
 * @param {Record<string, string | undefined>} [targetEnv=process.env] - Environment object to populate.
 * @returns {{loaded: boolean, path: string, values: Record<string, string>}} Load status and parsed values.
 */
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

// scripts/write-git-sha.js
//
// Stamps the current HEAD commit short-hash into .env.production so the
// `REACT_APP_GIT_SHA` env var gets baked into the production bundle.
// RetailPrintInvoice reads it and prints it on every receipt footer
// ("build: 7718b2d"), so anyone holding a printed invoice can confirm
// at a glance that the live bundle matches the expected commit on main.
//
// Idempotent: writes REACT_APP_GIT_SHA only; leaves the rest of the
// .env.production file (or its absence) untouched.
//
// Skip silently when git isn't available or we're not in a repo, so the
// script works in CI sandboxes and on developer machines without git.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let sha = "";
try {
  sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch (_) {
  // No git or not in a repo. Fall back to a timestamp so dev builds still
  // get a visible fingerprint, distinct from any real commit.
  sha = `dev-${Date.now().toString(36)}`;
}

const envFile = path.join(__dirname, "..", ".env.production");
const line = `REACT_APP_GIT_SHA=${sha}\n`;

// If the file exists, replace any prior REACT_APP_GIT_SHA line; otherwise
// create it. We don't try to merge other env vars — that file is meant
// only for build-time constants.
let existing = "";
if (fs.existsSync(envFile)) {
  existing = fs.readFileSync(envFile, "utf8");
}
const filtered = existing
  .split(/\r?\n/)
  .filter((l) => l && !l.startsWith("REACT_APP_GIT_SHA="))
  .join("\n");
const next = (filtered ? filtered + "\n" : "") + line;
fs.writeFileSync(envFile, next);
console.log(`[write-git-sha] REACT_APP_GIT_SHA=${sha}`);
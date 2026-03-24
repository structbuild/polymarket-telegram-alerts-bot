import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { replaceTomlVar } from "./lib/toml.mjs";
import {
  fetchBotInfo as fetchTelegramBotInfo,
  setTelegramCommands,
  setTelegramWebhook as updateTelegramWebhook,
} from "./lib/telegram.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const COLORS = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

const REQUIRED_SECRETS = ["BOT_TOKEN", "STRUCT_API_KEY", "STRUCT_WEBHOOK_SECRET"];

const PLACEHOLDER_VALUES = new Set([
  "your-telegram-bot-token",
  "your-struct-api-key",
  "your-webhook-signing-secret",
  "",
]);

function log(color, symbol, message) {
  console.log(`${COLORS[color]}${symbol}${COLORS.reset} ${message}`);
}

function success(msg) {
  log("green", "\u2713", msg);
}

function error(msg) {
  log("red", "\u2717", msg);
}

function info(msg) {
  log("yellow", "\u25B6", msg);
}

function header(msg) {
  console.log(`\n${COLORS.bold}${COLORS.cyan}${msg}${COLORS.reset}`);
}

function filePath(name) {
  return resolve(ROOT, name);
}

function readFile(name) {
  return readFileSync(filePath(name), "utf-8");
}

function writeFile(name, content) {
  writeFileSync(filePath(name), content, "utf-8");
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf-8", stdio: "pipe", ...opts });
}

function parseDevVars(content) {
  const vars = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    vars[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
  return vars;
}

async function ensureDevVars() {
  header("Step 1: Checking .dev.vars");
  const devVarsPath = filePath(".dev.vars");
  if (!existsSync(devVarsPath)) {
    copyFileSync(filePath(".dev.vars.example"), devVarsPath);
    info("Created .dev.vars from .dev.vars.example");
    error("Please fill in your secrets in .dev.vars and re-run this script.");
    process.exit(1);
  }
  success(".dev.vars exists");
  return parseDevVars(readFile(".dev.vars"));
}

function validateSecrets(vars) {
  header("Step 2: Validating secrets");
  const missing = [];
  for (const key of REQUIRED_SECRETS) {
    if (!vars[key] || PLACEHOLDER_VALUES.has(vars[key])) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    error(`Missing or placeholder values for: ${missing.join(", ")}`);
    info("Please update .dev.vars with real values and re-run.");
    process.exit(1);
  }
  success("All required secrets are set");
}

function checkWranglerAuth() {
  header("Step 3: Checking Wrangler authentication");
  try {
    run("npx wrangler whoami");
    success("Wrangler is authenticated");
  } catch {
    error("Wrangler is not logged in.");
    info("Run: npx wrangler login");
    process.exit(1);
  }
}

async function fetchBotInfo(botToken) {
  header("Step 4: Fetching bot info from Telegram");
  const botInfo = await fetchTelegramBotInfo(botToken);
  success(`Bot: @${botInfo.username} (ID: ${botInfo.id})`);
  return botInfo;
}

function updateBotInfo(botInfo) {
  header("Step 5: Updating BOT_INFO in wrangler.toml");
  let toml = readFile("wrangler.toml");
  toml = replaceTomlVar(toml, "BOT_INFO", JSON.stringify(botInfo));
  writeFile("wrangler.toml", toml);
  success("BOT_INFO updated in wrangler.toml");
}

function createD1Database() {
  header("Step 6: Creating D1 database");
  let databaseId;

  try {
    const output = run("npx wrangler d1 create polymarket-alerts");
    const match = output.match(/database_id\s*=\s*"([^"]+)"/);
    if (match) {
      databaseId = match[1];
      success(`Created D1 database with ID: ${databaseId}`);
    }
  } catch (e) {
    info("D1 database creation failed (may already exist). Looking up existing database...");
    databaseId = findExistingDatabaseId();
  }

  if (!databaseId) {
    error("Could not determine D1 database ID.");
    info("Create it manually with: npx wrangler d1 create polymarket-alerts");
    process.exit(1);
  }

  let toml = readFile("wrangler.toml");
  toml = toml.replace(
    /database_id\s*=\s*"[^"]*"/,
    `database_id = "${databaseId}"`
  );
  writeFile("wrangler.toml", toml);
  success(`wrangler.toml updated with database_id = "${databaseId}"`);
  return databaseId;
}

function findExistingDatabaseId() {
  try {
    const output = run("npx wrangler d1 list --json");
    const databases = JSON.parse(output);
    const db = databases.find((d) => d.name === "polymarket-alerts");
    if (db) {
      success(`Found existing database: ${db.uuid}`);
      return db.uuid;
    }
  } catch {
    try {
      const output = run("npx wrangler d1 list");
      for (const line of output.split("\n")) {
        if (line.includes("polymarket-alerts")) {
          const uuidMatch = line.match(
            /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
          );
          if (uuidMatch) return uuidMatch[1];
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}

function runSchemaMigration() {
  header("Step 7: Running schema migration");
  try {
    run("npx wrangler d1 execute polymarket-alerts --remote --file=./src/db/schema.sql");
    success("Schema migration completed");
  } catch (e) {
    error(`Schema migration failed: ${e.message}`);
    process.exit(1);
  }
}

function pushSecrets(vars) {
  header("Step 8: Pushing secrets to Cloudflare");
  for (const key of REQUIRED_SECRETS) {
    try {
      run(`echo "${vars[key]}" | npx wrangler secret put ${key}`);
      success(`Secret ${key} pushed`);
    } catch (e) {
      error(`Failed to push secret ${key}: ${e.message}`);
      process.exit(1);
    }
  }
}

function deployWorker() {
  header("Step 9: Deploying worker");
  try {
    const output = run("npx wrangler deploy");
    success("Worker deployed");

    const urlMatch = output.match(/https:\/\/[^\s]+\.workers\.dev/);
    if (urlMatch) {
      const workerUrl = urlMatch[0];
      success(`Worker URL: ${workerUrl}`);
      updateWebhookBaseUrl(workerUrl);
      return workerUrl;
    }

    info("Could not extract worker URL from deploy output.");
    info("Set WEBHOOK_BASE_URL manually in wrangler.toml if needed.");
    return null;
  } catch (e) {
    error(`Deployment failed: ${e.message}`);
    process.exit(1);
  }
}

function updateWebhookBaseUrl(workerUrl) {
  let toml = readFile("wrangler.toml");
  toml = toml.replace(
    /WEBHOOK_BASE_URL\s*=\s*"[^"]*"/,
    `WEBHOOK_BASE_URL = "${workerUrl}"`
  );
  writeFile("wrangler.toml", toml);
  success(`WEBHOOK_BASE_URL updated to ${workerUrl}`);
}

async function syncTelegramWebhookStep(botToken, workerUrl) {
  header("Step 10: Setting Telegram webhook");
  if (!workerUrl) {
    info("Skipping webhook setup - no worker URL available.");
    info("Set it manually: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>/telegram");
    return;
  }

  try {
    const webhookUrl = await updateTelegramWebhook(botToken, workerUrl);
    success(`Telegram webhook set to ${webhookUrl}`);
  } catch (e) {
    error(`Failed to set webhook: ${e.message}`);
    return;
  }
}

async function syncTelegramCommandsStep(botToken) {
  header("Step 11: Syncing Telegram commands");
  try {
    const commands = await setTelegramCommands(botToken);
    success(`Synced ${commands.length} Telegram commands`);
  } catch (e) {
    error(`Failed to sync Telegram commands: ${e.message}`);
  }
}

function printSummary(botInfo, databaseId, workerUrl) {
  header("Setup Complete!");
  console.log("");
  console.log(`  ${COLORS.green}Bot:${COLORS.reset}         @${botInfo.username}`);
  console.log(`  ${COLORS.green}Database:${COLORS.reset}    ${databaseId}`);
  console.log(`  ${COLORS.green}Worker URL:${COLORS.reset}  ${workerUrl || "Not detected - set manually"}`);
  console.log(`  ${COLORS.green}Webhook:${COLORS.reset}     ${workerUrl ? `${workerUrl}/telegram` : "Not set - set manually"}`);
  console.log("");
  info("Your bot is now live and ready to receive messages!");
}

async function main() {
  console.log(`\n${COLORS.bold}${COLORS.cyan}=== Polymarket Telegram Alerts Bot Setup ===${COLORS.reset}\n`);

  const vars = await ensureDevVars();
  validateSecrets(vars);
  checkWranglerAuth();

  const botInfo = await fetchBotInfo(vars.BOT_TOKEN);
  updateBotInfo(botInfo);

  const databaseId = createD1Database();
  runSchemaMigration();
  pushSecrets(vars);

  const workerUrl = deployWorker();

  if (workerUrl) {
    info("Redeploying with correct WEBHOOK_BASE_URL...");
    run("npx wrangler deploy");
    success("Redeployed with updated WEBHOOK_BASE_URL");
  }

  await syncTelegramWebhookStep(vars.BOT_TOKEN, workerUrl);
  await syncTelegramCommandsStep(vars.BOT_TOKEN);

  printSummary(botInfo, databaseId, workerUrl);
}

main().catch((e) => {
  error(`Setup failed: ${e.message}`);
  process.exit(1);
});

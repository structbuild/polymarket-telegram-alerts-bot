import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchBotInfo as fetchTelegramBotInfo,
  setTelegramCommands,
  setTelegramWebhook,
} from "./lib/telegram.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function devVarsPath() {
  return resolve(ROOT, ".dev.vars");
}

function parseDevVars() {
  const content = readFileSync(devVarsPath(), "utf-8");
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function updateDevVar(key, value) {
  const path = devVarsPath();
  let content = readFileSync(path, "utf-8");
  const regex = new RegExp(`^${escapeRegex(key)}=.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  writeFileSync(path, content, "utf-8");
}

function deleteDevVar(key) {
  const path = devVarsPath();
  let content = readFileSync(path, "utf-8");
  const regex = new RegExp(`^${escapeRegex(key)}=.*(?:\n|$)`, "m");
  content = content.replace(regex, "");
  writeFileSync(path, content, "utf-8");
}

function getProductionUrl() {
  const toml = readFileSync(resolve(ROOT, "wrangler.toml"), "utf-8");
  const match = toml.match(/WEBHOOK_BASE_URL\s*=\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function syncTelegramBot(botToken, url) {
  const webhookUrl = `${url}/telegram`;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await setTelegramWebhook(botToken, url);
      const commands = await setTelegramCommands(botToken);
      console.log(`${GREEN}Webhook set to ${webhookUrl}${RESET}`);
      console.log(`${GREEN}Synced ${commands.length} Telegram commands${RESET}`);
      return true;
    } catch (error) {
      if (attempt < 10) {
        console.log(`${CYAN}Waiting for tunnel DNS to propagate (${attempt}/10)...${RESET}`);
        await sleep(5000);
        continue;
      }
      console.error(`${RED}Failed to sync Telegram bot: ${error.message}${RESET}`);
    }
  }
  return false;
}

const vars = parseDevVars();
if (!vars.BOT_TOKEN) {
  console.error(`${RED}BOT_TOKEN not found in .dev.vars${RESET}`);
  process.exit(1);
}
const hadWebhookBaseUrl = Object.prototype.hasOwnProperty.call(vars, "WEBHOOK_BASE_URL");
const originalWebhookBaseUrl = hadWebhookBaseUrl ? vars.WEBHOOK_BASE_URL : null;
let temporaryWebhookBaseUrl = null;

console.log(`${BOLD}${CYAN}Starting dev environment...${RESET}\n`);

console.log(`${CYAN}Fetching bot info...${RESET}`);
let botInfo;
try {
  botInfo = await fetchTelegramBotInfo(vars.BOT_TOKEN);
} catch (error) {
  console.error(`${RED}Invalid BOT_TOKEN: ${error.message}${RESET}`);
  process.exit(1);
}
updateDevVar("BOT_INFO", JSON.stringify(botInfo));
console.log(`${GREEN}BOT_INFO updated in .dev.vars for @${botInfo.username}${RESET}`);

const children = [];
let shutdownPromise = null;

function cleanup() {
  for (const child of children) {
    try { child.kill(); } catch {}
  }
}

function restoreWebhookBaseUrl() {
  if (temporaryWebhookBaseUrl === null) return;

  if (originalWebhookBaseUrl !== null) {
    updateDevVar("WEBHOOK_BASE_URL", originalWebhookBaseUrl);
    console.log(`${GREEN}WEBHOOK_BASE_URL restored in .dev.vars${RESET}`);
  } else {
    deleteDevVar("WEBHOOK_BASE_URL");
    console.log(`${GREEN}Temporary WEBHOOK_BASE_URL removed from .dev.vars${RESET}`);
  }

  temporaryWebhookBaseUrl = null;
}

async function restoreAndExit() {
  return restoreAndExitWithCode(0, "Shutting down...");
}

async function restoreAndExitWithCode(exitCode, reason) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    let finalExitCode = exitCode;

    try {
      console.log(`\n${CYAN}${BOLD}${reason}${RESET}`);
      restoreWebhookBaseUrl();

      const prodUrl = getProductionUrl();
      if (prodUrl) {
        console.log(`${CYAN}Restoring production webhook...${RESET}`);
        await syncTelegramBot(vars.BOT_TOKEN, prodUrl);
      }
    } catch (error) {
      finalExitCode = finalExitCode || 1;
      console.error(`${RED}Shutdown restore failed:${RESET}`, error);
    } finally {
      cleanup();
      process.exit(finalExitCode);
    }
  })();

  return shutdownPromise;
}

process.on("SIGINT", () => {
  void restoreAndExit();
});
process.on("SIGTERM", () => {
  void restoreAndExit();
});
process.on("exit", restoreWebhookBaseUrl);

console.log(`${CYAN}Starting cloudflared tunnel...${RESET}`);

const tunnel = spawn("npx", ["cloudflared", "tunnel", "--url", "http://localhost:8787"], {
  cwd: ROOT,
  stdio: ["inherit", "pipe", "pipe"],
});
children.push(tunnel);

const tunnelUrl = await new Promise((resolve, reject) => {
  let buffer = "";
  const timeoutId = setTimeout(() => {
    reject(new Error("Timed out waiting for tunnel URL. Is cloudflared installed? Install with: npm i -g cloudflared"));
  }, 30000);

  function check(data) {
    buffer += data.toString();
    const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      clearTimeout(timeoutId);
      resolve(match[0]);
    }
  }

  tunnel.stdout.on("data", check);
  tunnel.stderr.on("data", check);
  tunnel.on("exit", (code) => {
    clearTimeout(timeoutId);
    reject(new Error(`cloudflared exited with code ${code}. Install with: npm i -g cloudflared`));
  });
});

console.log(`${GREEN}Tunnel: ${tunnelUrl}${RESET}\n`);

console.log(`${CYAN}Pointing worker callbacks at the tunnel...${RESET}`);
updateDevVar("WEBHOOK_BASE_URL", tunnelUrl);
temporaryWebhookBaseUrl = tunnelUrl;
console.log(`${GREEN}WEBHOOK_BASE_URL updated in .dev.vars to ${tunnelUrl}${RESET}`);

console.log(`${CYAN}Starting wrangler dev server...${RESET}`);

const wrangler = spawn("npx", ["wrangler", "dev", "--remote"], {
  cwd: ROOT,
  stdio: ["inherit", "pipe", "pipe"],
});
children.push(wrangler);

wrangler.stdout.on("data", (d) => process.stdout.write(d));
wrangler.stderr.on("data", (d) => process.stderr.write(d));
wrangler.on("exit", (code) => {
  console.log(`${RED}Wrangler exited with code ${code}${RESET}`);
  if (shutdownPromise) {
    return;
  }
  void restoreAndExitWithCode(code ?? 1, `Wrangler exited with code ${code}`);
});

await new Promise((resolve) => {
  function onData(data) {
    if (data.toString().includes("Ready on")) {
      wrangler.stdout.off("data", onData);
      wrangler.stderr.off("data", onStderr);
      resolve();
    }
  }
  function onStderr(data) {
    if (data.toString().includes("Ready on")) {
      wrangler.stdout.off("data", onData);
      wrangler.stderr.off("data", onStderr);
      resolve();
    }
  }
  wrangler.stdout.on("data", onData);
  wrangler.stderr.on("data", onStderr);
});

await syncTelegramBot(vars.BOT_TOKEN, tunnelUrl);

console.log(`\n${BOLD}${GREEN}Dev environment ready!${RESET}`);
console.log(`${CYAN}Local:  ${RESET}http://localhost:8787`);
console.log(`${CYAN}Tunnel: ${RESET}${tunnelUrl}`);
console.log(`${CYAN}Bot:    ${RESET}https://t.me/${botInfo.username}`);
console.log(`\n${CYAN}Press Ctrl+C to stop and restore production webhook${RESET}\n`);

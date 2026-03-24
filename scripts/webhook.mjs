import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseDevVars() {
  const content = readFileSync(resolve(ROOT, ".dev.vars"), "utf-8");
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

function getProductionUrl() {
  const toml = readFileSync(resolve(ROOT, "wrangler.toml"), "utf-8");
  const match = toml.match(/WEBHOOK_BASE_URL\s*=\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

async function setWebhook(botToken, url) {
  const webhookUrl = `${url}/telegram`;
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
  );
  const data = await res.json();
  if (!data.ok) {
    console.error(`\x1b[31m\u2717\x1b[0m Failed: ${data.description}`);
    process.exit(1);
  }
  console.log(`\x1b[32m\u2713\x1b[0m Telegram webhook set to ${webhookUrl}`);
}

const command = process.argv[2];
const vars = parseDevVars();

if (!vars.BOT_TOKEN) {
  console.error("\x1b[31m\u2717\x1b[0m BOT_TOKEN not found in .dev.vars");
  process.exit(1);
}

if (command === "dev") {
  const tunnelUrl = process.argv[3];
  if (!tunnelUrl) {
    console.error("Usage: node scripts/webhook.mjs dev <TUNNEL_URL>");
    console.error("Example: node scripts/webhook.mjs dev https://abc123.trycloudflare.com");
    process.exit(1);
  }
  await setWebhook(vars.BOT_TOKEN, tunnelUrl.replace(/\/$/, ""));
} else if (command === "prod") {
  const prodUrl = getProductionUrl();
  if (!prodUrl) {
    console.error("\x1b[31m\u2717\x1b[0m Could not read WEBHOOK_BASE_URL from wrangler.toml");
    process.exit(1);
  }
  await setWebhook(vars.BOT_TOKEN, prodUrl);
} else {
  console.log("Usage:");
  console.log("  node scripts/webhook.mjs dev <TUNNEL_URL>   Point bot to local dev tunnel");
  console.log("  node scripts/webhook.mjs prod               Point bot back to production");
}

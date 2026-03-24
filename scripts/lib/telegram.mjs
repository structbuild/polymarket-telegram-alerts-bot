const BOT_COMMANDS = [
  { command: "start", description: "Open the main menu" },
  { command: "help", description: "Show help and alert types" },
  { command: "list", description: "View your active monitors" },
  { command: "unsubscribe", description: "Remove active monitors" },
  { command: "trader", description: "Track a trader wallet" },
  { command: "example", description: "Preview alert message formats" },
];

function telegramApiUrl(botToken, method) {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

async function callTelegramApi(botToken, method, payload) {
  const res = await fetch(telegramApiUrl(botToken, method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.description || `Telegram API error calling ${method}`);
  }
  return data.result;
}

export { BOT_COMMANDS };

export async function fetchBotInfo(botToken) {
  return callTelegramApi(botToken, "getMe");
}

export async function setTelegramWebhook(botToken, url) {
  const webhookUrl = `${url.replace(/\/$/, "")}/telegram`;
  await callTelegramApi(botToken, "setWebhook", { url: webhookUrl });
  return webhookUrl;
}

export async function setTelegramCommands(botToken) {
  await callTelegramApi(botToken, "setMyCommands", { commands: BOT_COMMANDS });
  return BOT_COMMANDS;
}

export async function syncTelegramBot(botToken, url) {
  const webhookUrl = await setTelegramWebhook(botToken, url);
  const commands = await setTelegramCommands(botToken);
  return { webhookUrl, commands };
}

import { webhookCallback } from "grammy";
import { createBot } from "./bot/setup";
import { handleStructWebhook } from "./struct/event-handler";
import type { Env } from "./env";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/telegram") {
      const bot = createBot(env);
      return webhookCallback(bot, "cloudflare-mod")(request);
    }

    if (request.method === "POST" && url.pathname.startsWith("/struct/webhook/")) {
      const webhookId = url.pathname.slice("/struct/webhook/".length);
      if (webhookId.length > 0 && !webhookId.includes("/")) {
        return handleStructWebhook(request, env, ctx, webhookId);
      }
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },
};

import { InlineKeyboard } from "grammy";
import type { Env } from "../../env";
import {
  getMarketMonitorsByUser,
  getTraderMonitorsByUser,
  getTagMonitorsByUser,
} from "../../db/monitors";
import type { DbMarketMonitor, DbTraderMonitor, DbTagMonitor } from "../../types/database";
import {
  bold,
  code,
  escapeHtml,
  shortenAddress,
  truncate,
} from "../../utils/formatting";
import { getEventTypeLabel } from "./monitor-draft";
import {
  MONITOR_PAGE_SIZE,
  buildMonitorKey,
  paginateItems,
  sanitizeSelectedKeys,
} from "./monitor-selection";
export {
  MONITOR_PAGE_SIZE,
  buildMonitorKey,
  parseMonitorRemovalCallbackData,
  parseMonitorSelectionCallbackData,
} from "./monitor-selection";

type MonitorKind = "market" | "trader" | "tag";

export interface MonitorEntry {
  kind: MonitorKind;
  id: number;
  key: string;
  sectionLabel: "Markets" | "Traders" | "Tags & Series";
  listLabelHtml: string;
  unsubscribeLabel: string;
}

function scopeKindLabel(scopeType: string): string {
  return scopeType === "series" ? "Series" : "Tag";
}

interface MonitorPage {
  entries: MonitorEntry[];
  page: number;
  startIndex: number;
  totalItems: number;
  totalPages: number;
}

export interface MonitorReply {
  text: string;
  keyboard?: InlineKeyboard;
}

export function buildMonitorEntries(
  marketSubs: DbMarketMonitor[],
  traderSubs: DbTraderMonitor[],
  tagSubs: DbTagMonitor[] = []
): MonitorEntry[] {
  return [
    ...marketSubs.map((sub) => ({
      kind: "market" as const,
      id: sub.id,
      key: buildMonitorKey("market", sub.id),
      sectionLabel: "Markets" as const,
      listLabelHtml: `${escapeHtml(sub.market_title)} (${escapeHtml(getEventTypeLabel(sub.event_type))})`,
      unsubscribeLabel: truncate(sub.market_title, 40),
    })),
    ...traderSubs.map((sub) => {
      const listLabelHtml = sub.label
        ? escapeHtml(sub.label)
        : code(sub.wallet_address);
      const unsubscribeLabel = sub.label ?? shortenAddress(sub.wallet_address);

      return {
        kind: "trader" as const,
        id: sub.id,
        key: buildMonitorKey("trader", sub.id),
        sectionLabel: "Traders" as const,
        listLabelHtml: `${listLabelHtml} (${escapeHtml(getEventTypeLabel(sub.event_type))})`,
        unsubscribeLabel: `[Trader] ${truncate(unsubscribeLabel, 30)}`,
      };
    }),
    ...tagSubs.map((sub) => {
      const kindLabel = scopeKindLabel(sub.scope_type);
      return {
        kind: "tag" as const,
        id: sub.id,
        key: buildMonitorKey("tag", sub.id),
        sectionLabel: "Tags & Series" as const,
        listLabelHtml: `${kindLabel} ${code(escapeHtml(sub.scope_value))} (${escapeHtml(getEventTypeLabel(sub.event_type))})`,
        unsubscribeLabel: `[${kindLabel}] ${truncate(sub.scope_value, 30)}`,
      };
    }),
  ];
}

export function paginateMonitorEntries(
  entries: MonitorEntry[],
  page = 0
): MonitorPage | null {
  const pageItems = paginateItems(entries, page, MONITOR_PAGE_SIZE);
  if (!pageItems) {
    return null;
  }

  return {
    entries: pageItems.items,
    page: pageItems.page,
    startIndex: pageItems.startIndex,
    totalItems: pageItems.totalItems,
    totalPages: pageItems.totalPages,
  };
}

export function sanitizeSelectedMonitorKeys(
  entries: MonitorEntry[],
  selectedMonitorKeys: string[]
): string[] {
  return sanitizeSelectedKeys(
    entries.map((entry) => entry.key),
    selectedMonitorKeys
  );
}

function buildPaginationKeyboard(
  prefix: "mlp" | "usp",
  page: number,
  totalPages: number
): InlineKeyboard | undefined {
  if (totalPages <= 1) {
    return undefined;
  }

  const keyboard = new InlineKeyboard();
  if (page > 0) {
    keyboard.text("« Prev", `${prefix}:${page - 1}`);
  }
  keyboard.text(`${page + 1}/${totalPages}`, "noop");
  if (page < totalPages - 1) {
    keyboard.text("Next »", `${prefix}:${page + 1}`);
  }

  return keyboard;
}

function appendPaginationRow(
  keyboard: InlineKeyboard,
  prefix: "usp",
  page: number,
  totalPages: number
): void {
  if (totalPages <= 1) {
    return;
  }

  if (page > 0) {
    keyboard.text("« Prev", `${prefix}:${page - 1}`);
  }
  keyboard.text(`${page + 1}/${totalPages}`, "noop");
  if (page < totalPages - 1) {
    keyboard.text("Next »", `${prefix}:${page + 1}`);
  }
  keyboard.row();
}

function buildMonitorListText(page: MonitorPage): string {
  const lines: string[] = [
    bold("Your Active Monitors"),
    `${page.totalItems} total • Page ${page.page + 1}/${page.totalPages}`,
    "",
  ];

  let currentSection: MonitorEntry["sectionLabel"] | null = null;
  for (let i = 0; i < page.entries.length; i++) {
    const entry = page.entries[i];
    if (entry.sectionLabel !== currentSection) {
      if (currentSection !== null) {
        lines.push("");
      }
      lines.push(bold(`${entry.sectionLabel}:`));
      currentSection = entry.sectionLabel;
    }

    lines.push(`${page.startIndex + i + 1}. ${entry.listLabelHtml}`);
  }

  return lines.join("\n");
}

async function getUserMonitorEntries(
  env: Env,
  telegramId: number
): Promise<MonitorEntry[]> {
  const [marketSubs, traderSubs, tagSubs] = await Promise.all([
    getMarketMonitorsByUser(env.DB, telegramId),
    getTraderMonitorsByUser(env.DB, telegramId),
    getTagMonitorsByUser(env.DB, telegramId),
  ]);

  return buildMonitorEntries(marketSubs, traderSubs, tagSubs);
}

function buildUnsubscribeText(
  page: MonitorPage,
  selectedCount: number
): string {
  return [
    bold("Remove Active Monitors"),
    `${page.totalItems} total • ${selectedCount} selected • Page ${page.page + 1}/${page.totalPages}`,
    "",
    "Select the monitors you want to remove:",
  ].join("\n");
}

export async function getMonitorEntriesForUser(
  env: Env,
  telegramId: number
): Promise<MonitorEntry[]> {
  return getUserMonitorEntries(env, telegramId);
}

export async function buildMonitorListReply(
  env: Env,
  telegramId: number,
  page = 0
): Promise<MonitorReply | null> {
  const monitorEntries = await getUserMonitorEntries(env, telegramId);
  const monitorPage = paginateMonitorEntries(monitorEntries, page);
  if (!monitorPage) {
    return null;
  }

  return {
    text: buildMonitorListText(monitorPage),
    keyboard: buildPaginationKeyboard("mlp", monitorPage.page, monitorPage.totalPages),
  };
}

export async function buildUnsubscribeReply(
  env: Env,
  telegramId: number,
  selectedMonitorKeys: string[] = [],
  page = 0
): Promise<MonitorReply | null> {
  const monitorEntries = await getUserMonitorEntries(env, telegramId);
  const monitorPage = paginateMonitorEntries(monitorEntries, page);
  if (!monitorPage) {
    return null;
  }

  const sanitizedSelection = sanitizeSelectedMonitorKeys(
    monitorEntries,
    selectedMonitorKeys
  );
  const selectedMonitorKeySet = new Set(sanitizedSelection);
  const keyboard = new InlineKeyboard();

  const removalPrefix: Record<MonitorKind, string> = {
    market: "urm",
    trader: "urt",
    tag: "urg",
  };

  for (const entry of monitorPage.entries) {
    const callbackData = `${removalPrefix[entry.kind]}:${monitorPage.page}:${entry.id}`;
    const isSelected = selectedMonitorKeySet.has(entry.key);
    keyboard
      .text(`${isSelected ? "☑️" : "⏹️"} ${entry.unsubscribeLabel}`, callbackData)
      .row();
  }

  appendPaginationRow(keyboard, "usp", monitorPage.page, monitorPage.totalPages);

  const allSelected = sanitizedSelection.length === monitorEntries.length;
  keyboard
    .text(allSelected ? "Deselect All" : "Select All", `usa:${monitorPage.page}`)
    .row();

  if (sanitizedSelection.length > 0) {
    const label = sanitizedSelection.length === 1
      ? "Remove 1 Monitor →"
      : `Remove ${sanitizedSelection.length} Monitors →`;
    keyboard.text(label, `usc:${monitorPage.page}`);
  } else {
    keyboard.text("Select at least one monitor", "noop");
  }

  return {
    text: buildUnsubscribeText(monitorPage, sanitizedSelection.length),
    keyboard,
  };
}

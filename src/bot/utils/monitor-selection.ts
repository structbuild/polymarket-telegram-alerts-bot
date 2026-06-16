export const MONITOR_PAGE_SIZE = 8;

type MonitorKind = "market" | "trader" | "tag";

export interface MonitorRemovalCallback {
  id: number;
  kind: MonitorKind;
  page: number;
}

export interface MonitorSelectionCallback {
  id: number;
  kind: MonitorKind;
  page: number;
}

export interface PaginatedItems<T> {
  items: T[];
  page: number;
  startIndex: number;
  totalItems: number;
  totalPages: number;
}

export function buildMonitorKey(kind: MonitorKind, id: number): string {
  return `${kind}:${id}`;
}

export function paginateItems<T>(
  items: T[],
  page = 0,
  pageSize = MONITOR_PAGE_SIZE
): PaginatedItems<T> | null {
  if (items.length === 0) {
    return null;
  }

  const totalPages = Math.ceil(items.length / pageSize);
  const normalizedPage = Number.isInteger(page)
    ? Math.min(Math.max(page, 0), totalPages - 1)
    : 0;
  const startIndex = normalizedPage * pageSize;

  return {
    items: items.slice(startIndex, startIndex + pageSize),
    page: normalizedPage,
    startIndex,
    totalItems: items.length,
    totalPages,
  };
}

export function parseMonitorRemovalCallbackData(
  data: string
): MonitorRemovalCallback | null {
  let kind: MonitorKind | null = null;
  if (data.startsWith("um:")) {
    kind = "market";
  } else if (data.startsWith("ut:")) {
    kind = "trader";
  } else if (data.startsWith("ug:")) {
    kind = "tag";
  }

  if (!kind) {
    return null;
  }

  const parts = data.split(":");
  let page = 0;
  let id: number;

  if (parts.length === 2) {
    id = Number.parseInt(parts[1], 10);
  } else if (parts.length === 3) {
    page = Number.parseInt(parts[1], 10);
    id = Number.parseInt(parts[2], 10);
  } else {
    return null;
  }

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  if (!Number.isInteger(page) || page < 0) {
    return null;
  }

  return { id, kind, page };
}

export function parseMonitorSelectionCallbackData(
  data: string
): MonitorSelectionCallback | null {
  let kind: MonitorKind | null = null;
  if (data.startsWith("urm:")) {
    kind = "market";
  } else if (data.startsWith("urt:")) {
    kind = "trader";
  } else if (data.startsWith("urg:")) {
    kind = "tag";
  }

  if (!kind) {
    return null;
  }

  const parts = data.split(":");
  if (parts.length !== 3) {
    return null;
  }

  const page = Number.parseInt(parts[1], 10);
  const id = Number.parseInt(parts[2], 10);
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(id) || id <= 0) {
    return null;
  }

  return { id, kind, page };
}

export function sanitizeSelectedKeys(
  validKeys: string[],
  selectedKeys: string[]
): string[] {
  const validKeySet = new Set(validKeys);
  return [...new Set(selectedKeys)].filter((key) => validKeySet.has(key));
}

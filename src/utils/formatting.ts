export function bold(text: string): string {
  return `<b>${text}</b>`;
}

export function code(text: string): string {
  return `<code>${text}</code>`;
}

export function italic(text: string): string {
  return `<i>${text}</i>`;
}

export function link(text: string, url: string): string {
  return `<a href="${url}">${text}</a>`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatShares(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 8)}...${address.slice(-4)}`;
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

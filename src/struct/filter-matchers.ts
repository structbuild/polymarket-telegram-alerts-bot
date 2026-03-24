type StoredFilters = Record<string, unknown>;

export function matchesExcludeShortTerm(filters: StoredFilters, eventSlug: string | null): boolean {
  if (filters.exclude_shortterm_markets !== true) {
    return true;
  }

  if (eventSlug === null) {
    return false;
  }

  return !eventSlug.toLowerCase().includes("updown");
}

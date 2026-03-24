import test from "node:test";
import assert from "node:assert/strict";
import { isActiveDraftCallbackMessage } from "../.test-dist/src/bot/utils/draft-callback.js";
import {
  buildMarketOnboardingText,
  buildTraderOnboardingText,
  getStartReplyKind,
  resolveStartRoute,
} from "../.test-dist/src/bot/utils/onboarding.js";
import { matchesExcludeShortTerm } from "../.test-dist/src/struct/filter-matchers.js";
import {
  buildMonitorKey,
  paginateItems,
  parseMonitorRemovalCallbackData,
  parseMonitorSelectionCallbackData,
  sanitizeSelectedKeys,
} from "../.test-dist/src/bot/utils/monitor-selection.js";

test("active draft callbacks require matching setup message ids", () => {
  assert.equal(isActiveDraftCallbackMessage(42, 42), true);
  assert.equal(isActiveDraftCallbackMessage(42, 99), false);
  assert.equal(isActiveDraftCallbackMessage(42, null), false);
  assert.equal(isActiveDraftCallbackMessage(null, 42), false);
});

test("exclude_shortterm_markets fails closed when event_slug is missing", () => {
  assert.equal(matchesExcludeShortTerm({ exclude_shortterm_markets: true }, null), false);
});

test("exclude_shortterm_markets still rejects updown slugs and allows normal slugs", () => {
  assert.equal(
    matchesExcludeShortTerm({ exclude_shortterm_markets: true }, "election-updown-2026"),
    false
  );
  assert.equal(
    matchesExcludeShortTerm({ exclude_shortterm_markets: true }, "presidential-election"),
    true
  );
  assert.equal(matchesExcludeShortTerm({}, null), true);
});

test("/start deep links route to the correct onboarding prompt", () => {
  assert.equal(resolveStartRoute(" Market "), "market");
  assert.equal(resolveStartRoute("TRADER"), "trader");
  assert.equal(getStartReplyKind("market"), "market");
  assert.equal(getStartReplyKind("trader"), "trader");
  assert.match(buildMarketOnboardingText(), /^<b>🏪 Market<\/b>/);
  assert.match(buildTraderOnboardingText(), /^<b>👤 Trader<\/b>/);
});

test("/start falls back to the welcome message for empty or unknown payloads", () => {
  assert.equal(getStartReplyKind(undefined), "welcome");
  assert.equal(getStartReplyKind("unknown"), "welcome");
});

test("monitor pagination clamps invalid pages and preserves item ordering", () => {
  const monitorKeys = [
    ...Array.from({ length: 9 }, (_, index) => buildMonitorKey("market", index + 1)),
    buildMonitorKey("trader", 51),
  ];
  const page = paginateItems(monitorKeys, 99, 8);

  assert.equal(monitorKeys.length, 10);
  assert.equal(page?.page, 1);
  assert.equal(page?.items.length, 2);
  assert.equal(page?.items[0], "market:9");
  assert.equal(page?.items[1], "trader:51");
});

test("monitor removal callbacks support legacy delete and new selection formats", () => {
  assert.deepEqual(parseMonitorRemovalCallbackData("um:12"), {
    id: 12,
    kind: "market",
    page: 0,
  });
  assert.deepEqual(parseMonitorRemovalCallbackData("ut:3:19"), {
    id: 19,
    kind: "trader",
    page: 3,
  });
  assert.deepEqual(parseMonitorSelectionCallbackData("urm:2:44"), {
    id: 44,
    kind: "market",
    page: 2,
  });
  assert.deepEqual(parseMonitorSelectionCallbackData("urt:0:91"), {
    id: 91,
    kind: "trader",
    page: 0,
  });
  assert.equal(parseMonitorSelectionCallbackData("ut:91"), null);
});

test("monitor removal selection ignores stale keys and deduplicates current ones", () => {
  const validKeys = [buildMonitorKey("market", 1), buildMonitorKey("trader", 2)];
  assert.deepEqual(
    sanitizeSelectedKeys(validKeys, [
      "market:1",
      "market:1",
      "trader:2",
      "market:999",
    ]),
    ["market:1", "trader:2"]
  );
});

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

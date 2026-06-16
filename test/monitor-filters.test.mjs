import test from "node:test";
import assert from "node:assert/strict";
import {
  areStructWebhookFiltersEqual,
  getStructWebhookReuseScore,
  normalizeStructWebhookFilters,
} from "../.test-dist/src/services/monitor-filters.js";

test("normalizes spike webhook defaults for Struct comparisons", () => {
  const filters = normalizeStructWebhookFilters("probability_spike", {
    condition_ids: ["0xabc"],
    min_probability_change_pct: 10,
  });

  assert.deepEqual(filters, {
    condition_ids: ["0xabc"],
    min_probability_change_pct: 10,
    spike_direction: "both",
  });
});

test("reuses broader trader min_usd webhook for stricter monitor", () => {
  const score = getStructWebhookReuseScore(
    "trader_whale_trade",
    {
      wallet_addresses: ["0xabc"],
      min_usd_value: 10,
    },
    {
      wallet_addresses: ["0xabc"],
      min_usd_value: 100,
    }
  );

  assert.equal(typeof score, "number");
  assert.ok(score > 0);
});

test("does not reuse stricter trader min_usd webhook for broader monitor", () => {
  const score = getStructWebhookReuseScore(
    "trader_whale_trade",
    {
      wallet_addresses: ["0xabc"],
      min_usd_value: 100,
    },
    {
      wallet_addresses: ["0xabc"],
      min_usd_value: 10,
    }
  );

  assert.equal(score, null);
});

test("does not reuse spike webhooks across different window sizes", () => {
  const score = getStructWebhookReuseScore(
    "probability_spike",
    {
      condition_ids: ["0xabc"],
      min_probability_change_pct: 10,
      window_secs: 60,
      spike_direction: "up",
    },
    {
      condition_ids: ["0xabc"],
      min_probability_change_pct: 10,
      window_secs: 300,
      spike_direction: "up",
    }
  );

  assert.equal(score, null);
});

test("exclude_shortterm broad webhook can serve stricter monitor, but not the inverse", () => {
  assert.equal(
    getStructWebhookReuseScore(
      "trader_whale_trade",
      {
        wallet_addresses: ["0xabc"],
      },
      {
        wallet_addresses: ["0xabc"],
        exclude_shortterm_markets: true,
      }
    ),
    1
  );

  assert.equal(
    getStructWebhookReuseScore(
      "trader_whale_trade",
      {
        wallet_addresses: ["0xabc"],
        exclude_shortterm_markets: true,
      },
      {
        wallet_addresses: ["0xabc"],
      }
    ),
    null
  );
});

test("normalizes trader_global_pnl traders to lowercase exact-match list", () => {
  const filters = normalizeStructWebhookFilters("trader_global_pnl", {
    traders: ["0xABCdef"],
    min_realized_pnl_usd: 1000,
  });

  assert.deepEqual(filters, {
    traders: ["0xabcdef"],
    min_realized_pnl_usd: 1000,
  });
});

test("reuses lower spike_ratio volume-spike webhook for a stricter monitor", () => {
  const score = getStructWebhookReuseScore(
    "market_volume_spike",
    { condition_ids: ["0xabc"], spike_ratio: 2 },
    { condition_ids: ["0xabc"], spike_ratio: 3 }
  );

  assert.equal(typeof score, "number");
  assert.ok(score > 0);
});

test("does not reuse webhooks with different tag filters", () => {
  const score = getStructWebhookReuseScore(
    "price_spike",
    { condition_ids: ["0xabc"], tags: ["crypto"] },
    { condition_ids: ["0xabc"], tags: ["politics"] }
  );

  assert.equal(score, null);
});

test("exact filter matches are treated as equal after normalization", () => {
  assert.equal(
    areStructWebhookFiltersEqual(
      "trader_whale_trade",
      {
        wallet_addresses: ["0xabc"],
        min_usd_value: 10,
      },
      {
        min_usd_value: 10,
        wallet_addresses: ["0xabc"],
      }
    ),
    true
  );
});

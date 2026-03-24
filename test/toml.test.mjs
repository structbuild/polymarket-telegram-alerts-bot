import test from "node:test";
import assert from "node:assert/strict";
import { replaceTomlVar, toTomlBasicString } from "../scripts/lib/toml.mjs";

test("toTomlBasicString escapes embedded quotes, backslashes, and control characters", () => {
  const value = `Bob's "Alerts"\\bot\nline`;
  assert.equal(
    toTomlBasicString(value),
    `"Bob's \\"Alerts\\"\\\\bot\\nline"`
  );
});

test("replaceTomlVar writes BOT_INFO as a valid TOML basic string", () => {
  const original = `[vars]\nBOT_INFO = '{"username":"old"}'\n`;
  const botInfo = JSON.stringify({ username: "bob_alerts_bot", first_name: "Bob's Alerts" });
  const updated = replaceTomlVar(original, "BOT_INFO", botInfo);

  assert.match(updated, /^BOT_INFO = "/m);
  assert.ok(updated.includes(`Bob's Alerts`));
  assert.ok(updated.includes(`\\"username\\"`));
});

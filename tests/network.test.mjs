import assert from "node:assert/strict";
import test from "node:test";
import { chainIdLabel, isStudioNetChainId, normalizeChainId, STUDIONET_CHAIN_ID } from "../.test-output/network.js";

test("recognizes StudioNet in hexadecimal and decimal wallet formats", () => {
  assert.equal(STUDIONET_CHAIN_ID, "61999");
  assert.equal(isStudioNetChainId("0xf22f"), true);
  assert.equal(isStudioNetChainId("0xF22F"), true);
  assert.equal(isStudioNetChainId("61999"), true);
  assert.equal(isStudioNetChainId("0x1"), false);
});

test("normalizes wallet chain IDs and labels unknown networks safely", () => {
  assert.equal(normalizeChainId("0xF22F"), "61999");
  assert.equal(normalizeChainId("61999"), "61999");
  assert.equal(normalizeChainId(null), null);
  assert.equal(chainIdLabel("0x1"), "chain 1");
  assert.equal(chainIdLabel(null), "wallet network unavailable");
});

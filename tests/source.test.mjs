import assert from "node:assert/strict";
import test from "node:test";
import { derivePayloadHash, fetchSourceReceipt, normalizeSourceInteger } from "../.test-output/source.js";

const TX_HASH = `0x${"a".repeat(64)}`;
const SENDER = `0x${"1".repeat(40)}`;
const RECIPIENT = `0x${"2".repeat(40)}`;

function response(body, ok = true, status = 200) {
  return { ok, status, async json() { return body; } };
}

test("derives the same payload commitment as the contract", async () => {
  assert.equal(
    await derivePayloadHash("0XABCDEF"),
    "0x5db35791c4129bc78415fc67bfdcb9fe2b48336074b0d245158e9722f31fbb9d",
  );
});

test("normalizes source integers from decimal and hexadecimal APIs", () => {
  assert.equal(normalizeSourceInteger("0x10", "nonce"), "16");
  assert.equal(normalizeSourceInteger("1000000000000000", "value"), "1000000000000000");
  assert.equal(normalizeSourceInteger(0, "nonce"), "0");
});

test("fetches and normalizes a Blockscout-style receipt", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("/logs")) return response({ items: [{ address: RECIPIENT }] });
    return response({
      hash: TX_HASH.toUpperCase(),
      from: { hash: SENDER },
      to: { hash: RECIPIENT },
      value: "0x10",
      nonce: "0x07",
      confirmations: "12",
      status: "1",
      raw_input: "0XABCDEF",
    });
  };

  const receipt = await fetchSourceReceipt(
    "https://source.example/tx/{tx_hash}",
    "https://source.example/tx/{tx_hash}/logs",
    TX_HASH,
    fetchImpl,
  );

  assert.deepEqual(receipt, {
    txHash: TX_HASH,
    sender: SENDER,
    recipient: RECIPIENT,
    value: "16",
    rawInput: "0xabcdef",
    payloadHash: await derivePayloadHash("0XABCDEF"),
    nonce: "7",
    confirmations: "12",
    status: "ok",
    logCount: 1,
  });
  assert.deepEqual(calls, [
    `https://source.example/tx/${TX_HASH}`,
    `https://source.example/tx/${TX_HASH}/logs`,
  ]);
});

test("fails closed when the transaction source is unavailable", async () => {
  await assert.rejects(
    fetchSourceReceipt(
      "https://source.example/tx/{tx_hash}",
      "https://source.example/tx/{tx_hash}/logs",
      TX_HASH,
      async () => response({ error: "offline" }, false, 503),
    ),
    /Transaction source returned HTTP 503/,
  );
});

test("fails closed when logs are not a list", async () => {
  await assert.rejects(
    fetchSourceReceipt(
      "https://source.example/tx/{tx_hash}",
      "https://source.example/tx/{tx_hash}/logs",
      TX_HASH,
      async (url) => url.endsWith("/logs") ? response({ items: null }) : response({ hash: TX_HASH }),
    ),
    /Logs source did not return an items list/,
  );
});

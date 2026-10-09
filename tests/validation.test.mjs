import assert from "node:assert/strict";
import test from "node:test";
import { getReceiptFailureMessage, isFailedReceipt } from "../.test-output/receipt.js";
import { validateProofForm } from "../.test-output/validation.js";

const validForm = {
  proofId: "proof-1",
  targetId: "sepolia-transfer",
  sourceChainId: "11155111",
  txHash: `0x${"a".repeat(64)}`,
  expectedSender: `0x${"1".repeat(40)}`,
  expectedRecipient: `0x${"2".repeat(40)}`,
  expectedValue: "100",
  expectedPayloadHash: `0x${"b".repeat(64)}`,
  expectedNonce: "7",
  minConfirmations: "12",
  validUntil: "2030-01-01T00:00",
};

test("accepts a complete future proof claim", () => {
  assert.deepEqual(validateProofForm(validForm, Date.parse("2029-01-01T00:00")), []);
});

test("accepts zero-valued transfers and first-transaction nonces", () => {
  assert.deepEqual(
    validateProofForm({ ...validForm, expectedValue: "0", expectedNonce: "0" }, Date.parse("2029-01-01T00:00")),
    [],
  );
});

test("rejects malformed receipt identity and addresses", () => {
  const errors = validateProofForm({ ...validForm, txHash: "0x12", expectedRecipient: "not-an-address" });
  assert.equal(errors.some((value) => value.includes("Transaction hash")), true);
  assert.equal(errors.some((value) => value.includes("Expected recipient")), true);
});

test("rejects an expired proof window", () => {
  const errors = validateProofForm({ ...validForm, validUntil: "2020-01-01T00:00" }, Date.parse("2025-01-01T00:00"));
  assert.deepEqual(errors, ["Expiry must be in the future."]);
});

test("treats a finalized contract rollback as a failed write", () => {
  assert.equal(
    isFailedReceipt({
      resultName: "MAJORITY_AGREE",
      txExecutionResultName: "FINISHED_WITH_ERROR",
    }),
    true,
  );
});

test("does not treat a successful finalized execution as a failed write", () => {
  assert.equal(
    isFailedReceipt({
      resultName: "MAJORITY_AGREE",
      txExecutionResultName: "FINISHED_WITH_RETURN",
    }),
    false,
  );
});

test("detects the snake-case rollback shape returned by StudioNet", () => {
  const receipt = {
    status_name: "FINALIZED",
    result_name: "MAJORITY_AGREE",
    consensus_data: {
      leader_receipt: [
        {
          execution_result: "ERROR",
          result: { status: "rollback", payload: "[EXPECTED] Source transaction already authorized" },
        },
      ],
      validators: [
        { execution_result: "ERROR", vote: "agree" },
        { execution_result: "ERROR", vote: "agree" },
      ],
    },
  };

  assert.equal(isFailedReceipt(receipt), true);
  assert.equal(getReceiptFailureMessage(receipt), "[EXPECTED] Source transaction already authorized");
});

test("accepts the snake-case success shape returned by StudioNet", () => {
  assert.equal(
    isFailedReceipt({
      status_name: "FINALIZED",
      result_name: "MAJORITY_AGREE",
      consensus_data: {
        leader_receipt: [{ execution_result: "SUCCESS", result: { status: "return" } }],
        validators: [{ execution_result: "SUCCESS", vote: "agree" }],
      },
    }),
    false,
  );
});

test("fails closed when finalization has no contract execution result", () => {
  assert.equal(
    isFailedReceipt({ status_name: "FINALIZED", result_name: "MAJORITY_AGREE" }),
    true,
  );
});

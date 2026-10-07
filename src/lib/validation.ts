export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export type ProofForm = {
  proofId: string;
  targetId: string;
  sourceChainId: string;
  txHash: string;
  expectedSender: string;
  expectedRecipient: string;
  expectedValue: string;
  expectedPayloadHash: string;
  expectedNonce: string;
  minConfirmations: string;
  validUntil: string;
};

export function validateAddress(value: string, label: string): string | null {
  if (!ADDRESS_RE.test(value.trim())) return `${label} must be a 20-byte 0x address.`;
  return null;
}

export function validateHash(value: string, label: string): string | null {
  if (!HASH_RE.test(value.trim())) return `${label} must be a 32-byte 0x hash.`;
  return null;
}

export function validateNonNegativeInteger(value: string, label: string): string | null {
  if (!/^\d+$/.test(value.trim())) {
    return `${label} must be a non-negative integer.`;
  }
  return null;
}

export function validatePositiveInteger(value: string, label: string): string | null {
  if (!/^\d+$/.test(value.trim()) || BigInt(value) <= 0n) {
    return `${label} must be a positive integer.`;
  }
  return null;
}

export function validateProofForm(form: ProofForm, now = Date.now()): string[] {
  const errors: string[] = [];
  if (!form.proofId.trim()) errors.push("Proof ID is required.");
  if (!form.targetId.trim()) errors.push("Target ID is required.");
  if (!form.sourceChainId.trim()) errors.push("Source chain ID is required.");
  const txError = validateHash(form.txHash, "Transaction hash");
  if (txError) errors.push(txError);
  const senderError = validateAddress(form.expectedSender, "Expected sender");
  if (senderError) errors.push(senderError);
  const recipientError = validateAddress(form.expectedRecipient, "Expected recipient");
  if (recipientError) errors.push(recipientError);
  const payloadError = validateHash(form.expectedPayloadHash, "Expected payload hash");
  if (payloadError) errors.push(payloadError);
  for (const [value, label] of [
    [form.expectedValue, "Expected value"],
    [form.expectedNonce, "Expected nonce"],
  ] as const) {
    const integerError = validateNonNegativeInteger(value, label);
    if (integerError) errors.push(integerError);
  }
  const confirmationsError = validatePositiveInteger(form.minConfirmations, "Minimum confirmations");
  if (confirmationsError) errors.push(confirmationsError);
  const expiry = Date.parse(form.validUntil);
  if (!Number.isFinite(expiry) || expiry <= now) errors.push("Expiry must be in the future.");
  return errors;
}

export function toUnixSeconds(value: string): bigint {
  return BigInt(Math.floor(Date.parse(value) / 1000));
}

export function defaultExpiry(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

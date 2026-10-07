export type Receipt = {
  resultName?: string;
  txExecutionResultName?: string;
  status?: string;
};

const FAILED_RESULT_NAMES = new Set([
  "DISAGREE",
  "TIMEOUT",
  "DETERMINISTIC_VIOLATION",
  "NO_MAJORITY",
  "MAJORITY_DISAGREE",
]);

export function isFailedReceipt(receipt: Receipt): boolean {
  return receipt.txExecutionResultName === "FINISHED_WITH_ERROR"
    || (receipt.resultName ? FAILED_RESULT_NAMES.has(receipt.resultName) : false);
}

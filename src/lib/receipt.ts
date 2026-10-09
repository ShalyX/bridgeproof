type ExecutionReceipt = {
  execution_result?: string;
  executionResult?: string;
  result?: {
    status?: string;
    payload?: unknown;
  };
};

export type Receipt = {
  resultName?: string;
  result_name?: string;
  txExecutionResultName?: string;
  tx_execution_result_name?: string;
  status?: string | number;
  statusName?: string;
  status_name?: string;
  consensus_data?: {
    leader_receipt?: ExecutionReceipt[];
    validators?: ExecutionReceipt[];
  };
  consensusData?: {
    leaderReceipt?: ExecutionReceipt[];
    validators?: ExecutionReceipt[];
  };
};

const FAILED_RESULT_NAMES = new Set([
  "DISAGREE",
  "TIMEOUT",
  "DETERMINISTIC_VIOLATION",
  "NO_MAJORITY",
  "MAJORITY_DISAGREE",
]);

const FAILED_EXECUTION_RESULTS = new Set(["ERROR", "FINISHED_WITH_ERROR", "ROLLBACK"]);
const SUCCESS_EXECUTION_RESULTS = new Set(["SUCCESS", "FINISHED_WITH_RETURN", "RETURN"]);

function normalized(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

function executionReceipts(receipt: Receipt): ExecutionReceipt[] {
  return [
    ...(receipt.consensus_data?.leader_receipt ?? []),
    ...(receipt.consensus_data?.validators ?? []),
    ...(receipt.consensusData?.leaderReceipt ?? []),
    ...(receipt.consensusData?.validators ?? []),
  ];
}

function executionResults(receipt: Receipt): string[] {
  const topLevel = [receipt.txExecutionResultName, receipt.tx_execution_result_name];
  const nested = executionReceipts(receipt).map((item) => item.execution_result ?? item.executionResult);
  return [...topLevel, ...nested]
    .map(normalized)
    .filter((value): value is string => value !== null);
}

export function isFailedReceipt(receipt: Receipt): boolean {
  const resultName = normalized(receipt.resultName ?? receipt.result_name);
  if (resultName && FAILED_RESULT_NAMES.has(resultName)) return true;

  const results = executionResults(receipt);
  if (results.some((value) => FAILED_EXECUTION_RESULTS.has(value))) return true;
  if (results.some((value) => SUCCESS_EXECUTION_RESULTS.has(value))) return false;

  // Finalization only proves that validators agreed. Without an explicit
  // successful execution result, a wallet write must fail closed.
  return true;
}

export function getReceiptFailureMessage(receipt: Receipt): string | null {
  for (const item of executionReceipts(receipt)) {
    if (normalized(item.result?.status) !== "ROLLBACK") continue;
    if (typeof item.result?.payload === "string" && item.result.payload.trim()) {
      return item.result.payload.trim();
    }
  }
  return null;
}

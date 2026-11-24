import { hashPattern, nodePattern } from './invoice';

// Diagnostic text must never include response bodies, invoice data, tokens or URLs.
const httpReasons = {
  marketHttp: 'The processor returned an error while checking availability.',
  previewHttp: 'The processor returned an error while checking the invoice.',
  proofHttp: 'The processor returned an error while requesting a proof-of-work challenge.',
  quoteHttp: 'The processor returned an error while requesting a quote.',
  statusHttp: 'The processor returned an error while checking swap status.',
} as const;

export type BridgeHttpReason = keyof typeof httpReasons;

export class BridgeHttpError extends Error {
  constructor(
    readonly reason: BridgeHttpReason,
    readonly status: number,
  ) {
    super(httpReasons[reason] + ' (HTTP ' + status + ')');
  }
}
export const historyReasons = {
  ...httpReasons,
  proofTimeout: 'The phone ran out of time solving the processor’s proof of work.',
  processorRefused: 'The processor was unavailable or refused the request.',
  rateLimit: 'The quote request limit was reached.',
  quoteResponseTimeout:
    'The quote response timed out. The processor may have reserved this invoice; RedWallet submitted no payment. Wait up to ten minutes before trying again.',
  existingQuote: 'A quote reservation already exists in RedWallet. This retry sent no quote request or payment.',
  existingPayment: 'An earlier payment must be checked before another attempt.',
  unavailable: 'The processor was unavailable for this direction.',
  outsideLimits: 'The invoice amount was outside the processor’s limits.',
  invalidQuote: 'The returned quote did not pass invoice or price checks.',
  liquidity: 'Available XBT Lightning liquidity was insufficient for the quote and fee limit.',
  canceled: 'The quote request was interrupted.',
  approvalExpired: 'The quote had too little time left to submit the payment.',
  approvalCanceled: 'Approval was interrupted before submission.',
  approvalCheck: 'The wallet could not complete its checks before submission.',
  quoteReview: 'The wallet could not complete its review of the returned quote.',
  quoteRequest: 'The quote request did not complete. A more specific reason was unavailable.',
} as const;

export type HistoryReason = keyof typeof historyReasons;
export type BridgeHistoryIssue = {
  node: string;
  hash: string;
  provider: string;
  at: number;
  reason: HistoryReason;
  httpStatus?: number;
};
export const maxHistoryIssues = 100;

const knownErrors = new Map<string, HistoryReason>([
  ['Bridge proof of work took too long. No payment was sent.', 'proofTimeout'],
  ['Proof of work timed out before the quote request. No payment was sent. You can request a new quote.', 'proofTimeout'],
  ['Bridge unavailable or request refused.', 'processorRefused'],
  ['Bridge quote limit reached. Wait before requesting another quote.', 'rateLimit'],
  ['Six quote requests per ten minutes. Please wait.', 'rateLimit'],
  [
    'Quote response timed out. The processor may have reserved this invoice. No payment was submitted. Wait for the reservation to expire before trying again.',
    'quoteResponseTimeout',
  ],
  [historyReasons.existingQuote, 'existingQuote'],
  ['This payment is pending, uncertain or already paid. Check its status; do not pay again.', 'existingPayment'],
  ['LND already knows this payment. Check its status before proceeding.', 'existingPayment'],
  ['Payment already exists or its result is unknown.', 'existingPayment'],
  ['This processor is unavailable for XBT → SHA256.', 'unavailable'],
  ['Invoice amount is outside the processor limits.', 'outsideLimits'],
  ['Bridge quote does not match the requested payment.', 'invalidQuote'],
  ['Unsafe bridge invoice, price, destination or expiration.', 'invalidQuote'],
  ['Insufficient available XBT Lightning liquidity for this quote and routing fee limit.', 'liquidity'],
  ['Quote canceled.', 'canceled'],
  ['Quote expired. Nothing was sent.', 'approvalExpired'],
  ['Action canceled. Nothing was submitted.', 'approvalCanceled'],
]);

export function historyDiagnostic(error: unknown, fallback: HistoryReason): Pick<BridgeHistoryIssue, 'reason' | 'httpStatus'> {
  if (error instanceof BridgeHttpError) return { reason: error.reason, httpStatus: error.status };
  return {
    reason: (error instanceof Error && knownErrors.get(error.message)) || fallback,
  };
}

export function historyDescription(issue: BridgeHistoryIssue): string {
  const description = historyReasons[issue.reason];
  return issue.httpStatus === undefined ? description : description + ' (HTTP ' + issue.httpStatus + ')';
}

export function savedIssues(value: unknown): BridgeHistoryIssue[] {
  if (!Array.isArray(value)) return [];
  // Diagnostic metadata is optional. An unknown reason must never block access to settlement records.
  return value.slice(-maxHistoryIssues).flatMap(issue => {
    if (
      !issue ||
      typeof issue.node !== 'string' ||
      !nodePattern.test(issue.node) ||
      typeof issue.hash !== 'string' ||
      !hashPattern.test(issue.hash) ||
      typeof issue.provider !== 'string' ||
      !/^[a-z0-9_-]{1,64}$/i.test(issue.provider) ||
      !Number.isSafeInteger(issue.at) ||
      issue.at < 0 ||
      issue.at > 8640000000000000 ||
      typeof issue.reason !== 'string' ||
      !Object.prototype.hasOwnProperty.call(historyReasons, issue.reason)
    )
      return [];
    const { node, hash, provider, at, reason } = issue;
    const result: BridgeHistoryIssue = { node, hash, provider, at, reason };
    const status = issue.httpStatus;
    if (
      Object.prototype.hasOwnProperty.call(httpReasons, reason) &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599 &&
      (status < 200 || status >= 300)
    )
      result.httpStatus = status;
    return [result];
  });
}

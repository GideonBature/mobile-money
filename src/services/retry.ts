/**
 * Exponential backoff retries for transient failures (network, timeouts, 5xx).
 * Permanent errors (validation, insufficient funds, etc.) are not retried.
 */

const TRANSIENT_HINTS =
  /econnreset|etimedout|econnrefused|enotfound|network|socket|timeout|temporar|unavailable|429|502|503|504|fetch failed|aborted/i;

const PERMANENT_HINTS =
  /invalid|insufficient|bad request|malformed|unauthorized|forbidden|not found|wrong\s+number|duplicate|rejected|bad\s+request|400|401|403|404|422/i;

export function isTransientError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? `${error.message} ${(error as NodeJS.ErrnoException).code ?? ""}`
      : String(error);

  if (PERMANENT_HINTS.test(msg)) return false;
  return TRANSIENT_HINTS.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WithRetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  /** Called after a failed attempt when another attempt will follow */
  onRetry?: (info: { attempt: number; error: unknown }) => void | Promise<void>;
}

/**
 * Runs `fn` up to `maxAttempts` times. After attempt `k` fails with a transient
 * error, waits `baseDelayMs * 2^(k-1)` ms before the next attempt.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions,
): Promise<T> {
  const { maxAttempts, baseDelayMs, onRetry } = options;
  if (maxAttempts < 1) throw new Error("maxAttempts must be at least 1");

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const canRetry =
        isTransientError(error) && attempt < maxAttempts;
      if (!canRetry) throw error;

      console.warn(
        `[retry] transient failure attempt ${attempt}/${maxAttempts}, backing off`,
        error instanceof Error ? error.message : error,
      );
      await onRetry?.({ attempt, error });
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

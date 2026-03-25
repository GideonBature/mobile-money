import { isTransientError, withRetry } from "../../src/services/retry";

describe("retry service", () => {
  describe("isTransientError", () => {
    it("treats timeouts and network errors as transient", () => {
      expect(isTransientError(new Error("ETIMEDOUT"))).toBe(true);
      expect(isTransientError(new Error("fetch failed"))).toBe(true);
      expect(isTransientError(new Error("503 Service Unavailable"))).toBe(true);
    });

    it("treats validation and business errors as permanent", () => {
      expect(isTransientError(new Error("Invalid phone number"))).toBe(false);
      expect(isTransientError(new Error("Insufficient funds"))).toBe(false);
      expect(isTransientError(new Error("Bad Request"))).toBe(false);
    });
  });

  describe("withRetry", () => {
    it("succeeds on first attempt", async () => {
      const fn = jest.fn().mockResolvedValue(42);
      await expect(
        withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 }),
      ).resolves.toBe(42);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries transient errors with zero delay then succeeds", async () => {
      let calls = 0;
      const fn = jest.fn(async () => {
        calls++;
        if (calls < 3) throw new Error("ECONNRESET");
        return "ok";
      });
      const onRetry = jest.fn();
      await expect(
        withRetry(fn, { maxAttempts: 5, baseDelayMs: 0, onRetry }),
      ).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it("does not retry permanent errors", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("Invalid amount"));
      const onRetry = jest.fn();
      await expect(
        withRetry(fn, { maxAttempts: 3, baseDelayMs: 0, onRetry }),
      ).rejects.toThrow("Invalid amount");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
    });

    it("throws after exhausting attempts on transient errors", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("socket hang up"));
      await expect(
        withRetry(fn, { maxAttempts: 2, baseDelayMs: 0 }),
      ).rejects.toThrow("socket hang up");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});

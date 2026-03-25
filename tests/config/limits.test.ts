import { KYCLevel, TRANSACTION_LIMITS, LimitConfig } from '../../src/config/limits';

describe('KYC Limits Configuration', () => {
  describe('KYCLevel enum', () => {
    it('should have correct enum values', () => {
      expect(KYCLevel.Unverified).toBe('unverified');
      expect(KYCLevel.Basic).toBe('basic');
      expect(KYCLevel.Full).toBe('full');
    });
  });

  describe('TRANSACTION_LIMITS', () => {
    it('should have default values when environment variables are not set', () => {
      expect(TRANSACTION_LIMITS[KYCLevel.Unverified]).toBe(10000);
      expect(TRANSACTION_LIMITS[KYCLevel.Basic]).toBe(100000);
      expect(TRANSACTION_LIMITS[KYCLevel.Full]).toBe(1000000);
    });

    it('should have all required KYC levels', () => {
      expect(TRANSACTION_LIMITS).toHaveProperty(KYCLevel.Unverified);
      expect(TRANSACTION_LIMITS).toHaveProperty(KYCLevel.Basic);
      expect(TRANSACTION_LIMITS).toHaveProperty(KYCLevel.Full);
    });

    it('should have positive finite numbers for all limits', () => {
      const values = Object.values(TRANSACTION_LIMITS);
      values.forEach(value => {
        expect(value).toBeGreaterThan(0);
        expect(isFinite(value)).toBe(true);
      });
    });

    it('should maintain monotonic ordering of limits', () => {
      expect(TRANSACTION_LIMITS[KYCLevel.Basic]).toBeGreaterThanOrEqual(
        TRANSACTION_LIMITS[KYCLevel.Unverified]
      );
      expect(TRANSACTION_LIMITS[KYCLevel.Full]).toBeGreaterThanOrEqual(
        TRANSACTION_LIMITS[KYCLevel.Basic]
      );
    });
  });
});

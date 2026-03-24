import { isValidReferenceNumber } from '../../src/utils/referenceGenerator';

describe('Reference Number Generator', () => {
  describe('isValidReferenceNumber', () => {
    it('should validate correct reference number format', () => {
      expect(isValidReferenceNumber('TXN-20260322-00001')).toBe(true);
      expect(isValidReferenceNumber('TXN-20260322-99999')).toBe(true);
    });

    it('should reject invalid formats', () => {
      expect(isValidReferenceNumber('TXN-2026032-00001')).toBe(false);  // Wrong date length
      expect(isValidReferenceNumber('TXN-20260322-0001')).toBe(false);   // Wrong sequence length
      expect(isValidReferenceNumber('TX-20260322-00001')).toBe(false);   // Wrong prefix
      expect(isValidReferenceNumber('TXN-20260322-ABCDE')).toBe(false);  // Non-numeric sequence
      expect(isValidReferenceNumber('invalid')).toBe(false);
    });
  });
});

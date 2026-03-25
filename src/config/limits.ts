export enum KYCLevel {
  Unverified = 'unverified',
  Basic = 'basic',
  Full = 'full'
}

export interface LimitConfig {
  [KYCLevel.Unverified]: number;
  [KYCLevel.Basic]: number;
  [KYCLevel.Full]: number;
}

export const TRANSACTION_LIMITS: LimitConfig = {
  [KYCLevel.Unverified]: parseFloat(process.env.LIMIT_UNVERIFIED || '10000'),
  [KYCLevel.Basic]: parseFloat(process.env.LIMIT_BASIC || '100000'),
  [KYCLevel.Full]: parseFloat(process.env.LIMIT_FULL || '1000000')
};

// Validation on module load
function validateLimits(limits: LimitConfig): void {
  const values = Object.values(limits);
  if (values.some(v => v <= 0 || !isFinite(v))) {
    throw new Error('All transaction limits must be positive finite numbers');
  }
  if (limits[KYCLevel.Basic] < limits[KYCLevel.Unverified]) {
    throw new Error('Basic KYC limit must be >= Unverified limit');
  }
  if (limits[KYCLevel.Full] < limits[KYCLevel.Basic]) {
    throw new Error('Full KYC limit must be >= Basic limit');
  }
}

validateLimits(TRANSACTION_LIMITS);

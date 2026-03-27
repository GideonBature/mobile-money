import {
  Asset,
  Transaction,
  FeeBumpTransaction,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  Memo,
  Timebounds,
  Asset,
  FeeBumpTransactionBuilder,
} from "stellar-sdk";
import { getStellarServer, getNetworkPassphrase, getFeeBumpConfig } from "../config/stellar";

// ============================================================================
// Types
// ============================================================================

export interface FeeBumpOptions {
  /** Source account that creates the inner transaction */
  sourceAccount: string;
  /** Operations to include in the inner transaction */
  operations: Operation[];
  /** Memo to attach to the transaction */
  memo?: Memo;
  /** Timebounds for transaction validity */
  timebounds?: Timebounds;
  /** Whether to enable fee bumping (default: true) */
  enableFeeBump?: boolean;
}

export interface FeeBumpResult {
  /** The transaction envelope (base64 encoded) */
  envelope: string;
  /** The inner transaction hash */
  innerTransactionHash: string;
  /** The fee bump transaction hash */
  feeBumpTransactionHash: string;
  /** Fee amount in stroops */
  fee: number;
  /** Whether fee bump was used */
  usedFeeBump: boolean;
}

export interface FeeEstimate {
  /** Base fee in stroops per operation */
  baseFee: number;
  /** Number of operations */
  operationCount: number;
  /** Estimated total fee in stroops */
  estimatedFee: number;
  /** Maximum allowed fee in stroops */
  maxFee: number;
  /** Whether the estimated fee exceeds the maximum */
  exceedsMax: boolean;
}

// In-memory store for fee payer sequence (in production, use a database or cache)
let feePayerSequence: number | null = null;

// ============================================================================
// Fee Bump Transaction Builder
// ============================================================================

/**
 * Wraps a transaction in a FeeBumpTransaction.
 */
export const wrapInFeeBump = (
  innerTransaction: Transaction,
  feePayerKeypair: Keypair,
  maxFee: number
): FeeBumpTransaction => {
  return new FeeBumpTransactionBuilder({
    innerTransaction,
    feePayer: feePayerKeypair.publicKey(),
    maxFee,
  }).build();
};

/**
 * Builds and optionally wraps a transaction with fee bumping.
 */
export const buildTransactionWithFeeBump = async (
  options: FeeBumpOptions
): Promise<FeeBumpResult> => {
  const config = getFeeBumpConfig();
  const server = getStellarServer();
  const networkPassphrase = getNetworkPassphrase();
  
  const { 
    sourceAccount, 
    operations, 
    memo, 
    timebounds, 
    enableFeeBump = true 
  } = options;

  if (!StrKey.isValidEd25519PublicKey(sourceAccount)) {
    throw new Error("Invalid source account address");
  }

  if (operations.length > config.maxOperationsPerTransaction) {
    throw new Error(
      `Too many operations: ${operations.length}. Maximum is ${config.maxOperationsPerTransaction}`
    );
  }

  const sourceAccountRecord = await server.loadAccount(sourceAccount);
  const txTimebounds = timebounds || await server.getTimebounds(300);
  
  let transactionBuilder = new TransactionBuilder(sourceAccountRecord, {
    fee: config.baseFeeStroops.toString(),
    timebounds: txTimebounds,
    networkPassphrase,
  });

  if (memo) {
    transactionBuilder = transactionBuilder.addMemo(memo);
  }

  for (const op of operations) {
    transactionBuilder = transactionBuilder.addOperation(op);
  }

  const innerTransaction = transactionBuilder.build();

  if (!enableFeeBump) {
    const envelope = innerTransaction.toEnvelope().toXDR("base64");
    return {
      envelope,
      innerTransactionHash: innerTransaction.hash().toString("hex"),
      feeBumpTransactionHash: "",
      fee: innerTransaction.fee,
      usedFeeBump: false,
    };
  }

  if (!config.feePayerPublicKey || !config.feePayerPrivateKey) {
    throw new Error("Fee payer not configured.");
  }

  const feePayerKeypair = Keypair.fromSecret(config.feePayerPrivateKey);
  await updateFeePayerSequence();

  const maxFee = calculateMaxFee(operations.length, config.baseFeeStroops, config.maxFeePerTransaction);

  const feeBumpTransaction = wrapInFeeBump(
    innerTransaction,
    feePayerKeypair,
    maxFee
  );

  feeBumpTransaction.sign(feePayerKeypair);

  return {
    envelope: feeBumpTransaction.toEnvelope().toXDR("base64"),
    innerTransactionHash: innerTransaction.hash().toString("hex"),
    feeBumpTransactionHash: feeBumpTransaction.hash().toString("hex"),
    fee: maxFee,
    usedFeeBump: true,
  };
};

// ============================================================================
// Fee Payer Sequence Management
// ============================================================================

export const updateFeePayerSequence = async (): Promise<number> => {
  const config = getFeeBumpConfig();
  if (!config.feePayerPublicKey) throw new Error("Fee payer not configured");

  const server = getStellarServer();
  const feePayerAccount = await server.loadAccount(config.feePayerPublicKey);
  
  feePayerSequence = Number(feePayerAccount.sequenceNumber);
  return feePayerSequence;
};

export const getFeePayerSequence = (): number | null => feePayerSequence;

export const incrementFeePayerSequence = (): void => {
  if (feePayerSequence !== null) feePayerSequence += 1;
};

// ============================================================================
// Fee Estimation
// ============================================================================

export const estimateFee = (operationCount: number): FeeEstimate => {
  const config = getFeeBumpConfig();
  const baseFee = config.baseFeeStroops;
  const estimatedFee = baseFee * operationCount;
  
  return {
    baseFee,
    operationCount,
    estimatedFee,
    maxFee: config.maxFeePerTransaction,
    exceedsMax: estimatedFee > config.maxFeePerTransaction,
  };
};

export const calculateMaxFee = (
  operationCount: number,
  baseFee: number,
  maxAllowedFee: number
): number => {
  const calculatedFee = Math.ceil(operationCount * baseFee * 1.1);
  return Math.min(calculatedFee, maxAllowedFee);
};

// ============================================================================
// Transaction Submission
// ============================================================================

export interface SubmitTransactionResult {
  success: boolean;
  transactionHash?: string;
  envelope?: string;
  feeCharged?: number;
  resultXdr?: string;
  error?: string;
}

export const submitTransaction = async (
  envelope: string
): Promise<SubmitTransactionResult> => {
  const server = getStellarServer();

  try {
    const response = await server.submitTransaction(envelope);
    await updateFeePayerSequence();

    return {
      success: true,
      transactionHash: response.hash,
      envelope,
      feeCharged: response.fee_charged,
      resultXdr: response.result_xdr,
    };
  } catch (error: unknown) {
    const err = error as { message?: string; response?: { status: number } };
    if (err.response?.status === 400) {
      await updateFeePayerSequence();
    }

    return {
      success: false,
      error: err.message || "Transaction submission failed",
    };
  }
};

// ============================================================================
// Convenience Functions (Fixed ESLint Issues)
// ============================================================================

export const createSimplePaymentWithFeeBump = async (
  sourceAccount: string,
  destination: string,
  asset: "native" | { code: string; issuer: string },
  amount: string,
  memo?: string
): Promise<FeeBumpResult> => {
  const stellarAsset = asset === "native" 
    ? Asset.native() 
    : new Asset(asset.code, asset.issuer);

  const operation = Operation.payment({
    destination,
    asset: stellarAsset,
    asset: asset === "native" 
      ? Asset.native()
      : new Asset(asset.code, asset.issuer),
    amount,
  });

  return buildTransactionWithFeeBump({
    sourceAccount,
    operations: [operation],
    memo: memo ? Memo.text(memo) : undefined,
  });
};

export const createTrustAndPaymentWithFeeBump = async (
  sourceAccount: string,
  destination: string,
  assetCode: string,
  assetIssuer: string,
  amount: string,
  memo?: string
): Promise<FeeBumpResult> => {
  const asset = new Asset(assetCode, assetIssuer);

  const operations: Operation[] = [
    Operation.changeTrust({
      asset,
      limit: amount,
      source: destination,
    }),
    Operation.payment({
      destination,
      asset,
      amount,
      source: sourceAccount,
    }),
  ];

  return buildTransactionWithFeeBump({
    sourceAccount,
    operations,
    memo: memo ? Memo.text(memo) : undefined,
  });
};

export default {
  buildTransactionWithFeeBump,
  submitTransaction,
  wrapInFeeBump,
  estimateFee,
  createSimplePaymentWithFeeBump,
  createTrustAndPaymentWithFeeBump,
  updateFeePayerSequence,
  getFeePayerSequence,
};

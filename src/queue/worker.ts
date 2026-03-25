import { Worker, Job, JobProgress } from "bullmq";
import {
  TransactionJobData,
  TransactionJobResult,
  TRANSACTION_QUEUE_NAME,
} from "./transactionQueue";
import { queueOptions } from "./config";
import { TransactionModel, TransactionStatus } from "../models/transaction";
import { MobileMoneyService } from "../services/mobilemoney/mobileMoneyService";
import { StellarService } from "../services/stellar/stellarService";
import { withRetry } from "../services/retry";
import { SmsService } from "../services/sms";

const transactionModel = new TransactionModel();
const mobileMoneyService = new MobileMoneyService();
const stellarService = new StellarService();
const smsService = new SmsService();

const workerOptions = {
  ...queueOptions,
  concurrency: 5,
  limiter: {
    max: 10,
    duration: 1000,
  },
};

export const transactionWorker = new Worker<
  TransactionJobData,
  TransactionJobResult
>(
  TRANSACTION_QUEUE_NAME,
  async (job: Job<TransactionJobData, TransactionJobResult>) => {
    const {
      transactionId,
      type,
      amount,
      phoneNumber,
      provider,
      stellarAddress,
    } = job.data;

    console.log(`[${job.id}] Processing ${type} transaction: ${transactionId}`);

    const maxAttempts = Math.max(
      1,
      parseInt(process.env.MAX_RETRY_ATTEMPTS || "3", 10),
    );
    const baseDelayMs = Math.max(
      0,
      parseInt(process.env.RETRY_DELAY_MS || "1000", 10),
    );

    const retryConfig = {
      maxAttempts,
      baseDelayMs,
      onRetry: async ({
        attempt,
        error,
      }: {
        attempt: number;
        error: unknown;
      }) => {
        await transactionModel.incrementRetryCount(transactionId);
        console.warn(
          `[${job.id}] transient failure (attempt ${attempt}), will retry:`,
          error instanceof Error ? error.message : error,
        );
      },
    };

    const sendTxnSms = async (
      kind: "transaction_completed" | "transaction_failed",
      errorMessage?: string,
    ) => {
      try {
        const txRow = await transactionModel.findById(transactionId);
        const ref = txRow?.referenceNumber ?? transactionId;
        await smsService.notifyTransactionEvent(phoneNumber, {
          referenceNumber: ref,
          type,
          amount: String(amount),
          provider,
          kind,
          errorMessage,
        });
      } catch (smsErr) {
        console.error(`[${job.id}] SMS notification error`, smsErr);
      }
    };

    try {
      await job.updateProgress(10);

      if (type === "deposit") {
        await job.updateProgress(20);

        await withRetry(async () => {
          const mobileMoneyResult = await mobileMoneyService.initiatePayment(
            provider,
            phoneNumber,
            amount,
          );
          if (!mobileMoneyResult.success) {
            throw new Error(
              (mobileMoneyResult.error as string) ||
                "Payment initiation failed",
            );
          }
          return mobileMoneyResult;
        }, retryConfig);

        await job.updateProgress(50);

        await job.updateProgress(70);

        await withRetry(
          () => stellarService.sendPayment(stellarAddress, amount),
          retryConfig,
        );

        await job.updateProgress(90);

        await transactionModel.updateStatus(
          transactionId,
          TransactionStatus.Completed,
        );

        await sendTxnSms("transaction_completed");

        await job.updateProgress(100);

        console.log(
          `[${job.id}] Deposit completed successfully: ${transactionId}`,
        );

        return {
          success: true,
          transactionId,
        };
      } else {
        await job.updateProgress(20);

        await withRetry(async () => {
          const mobileMoneyResult = await mobileMoneyService.sendPayout(
            provider,
            phoneNumber,
            amount,
          );
          if (!mobileMoneyResult.success) {
            throw new Error(
              (mobileMoneyResult.error as string) || "Payout failed",
            );
          }
          return mobileMoneyResult;
        }, retryConfig);

        await job.updateProgress(50);

        await job.updateProgress(90);

        await transactionModel.updateStatus(
          transactionId,
          TransactionStatus.Completed,
        );

        await sendTxnSms("transaction_completed");

        await job.updateProgress(100);

        console.log(
          `[${job.id}] Withdraw completed successfully: ${transactionId}`,
        );

        return {
          success: true,
          transactionId,
        };
      }
    } catch (error) {
      console.error(`[${job.id}] Transaction failed:`, error);
      await transactionModel.updateStatus(
        transactionId,
        TransactionStatus.Failed,
      );
      const msg = error instanceof Error ? error.message : String(error);
      await sendTxnSms("transaction_failed", msg);
      throw error;
    }
  },
  workerOptions,
);

transactionWorker.on(
  "completed",
  (job: Job<TransactionJobData, TransactionJobResult>) => {
    console.log(`[${job.id}] Job completed successfully`);
  },
);

transactionWorker.on(
  "failed",
  (
    job: Job<TransactionJobData, TransactionJobResult> | undefined,
    error: Error,
  ) => {
    console.error(
      `[${job?.id}] Job failed after ${job?.attemptsMade} attempts:`,
      error.message,
    );
  },
);

transactionWorker.on(
  "progress",
  (
    job: Job<TransactionJobData, TransactionJobResult>,
    progress: JobProgress,
  ) => {
    console.log(`[${job.id}] Job progress: ${progress}%`);
  },
);

export async function closeWorker() {
  await transactionWorker.close();
}

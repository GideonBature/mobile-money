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

const transactionModel = new TransactionModel();
const mobileMoneyService = new MobileMoneyService();
const stellarService = new StellarService();

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

    try {
      await job.updateProgress(10);

      if (type === "deposit") {
        await job.updateProgress(20);

        const mobileMoneyResult = await mobileMoneyService.initiatePayment(
          provider,
          phoneNumber,
          amount,
        );

        await job.updateProgress(50);

        if (!mobileMoneyResult.success) {
          throw new Error(
            (mobileMoneyResult.error as string) || "Payment initiation failed",
          );
        }

        await job.updateProgress(70);

        await stellarService.sendPayment(stellarAddress, amount);

        await job.updateProgress(90);

        await transactionModel.updateStatus(transactionId, TransactionStatus.Completed);

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

        const mobileMoneyResult = await mobileMoneyService.sendPayout(
          provider,
          phoneNumber,
          amount,
        );

        await job.updateProgress(50);

        if (!mobileMoneyResult.success) {
          throw new Error(
            (mobileMoneyResult.error as string) || "Payout failed",
          );
        }

        await job.updateProgress(90);

        await transactionModel.updateStatus(transactionId, TransactionStatus.Completed);

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
      await transactionModel.updateStatus(transactionId, TransactionStatus.Failed);
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

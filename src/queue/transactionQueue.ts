import { Queue } from "bullmq";
import { queueOptions } from "./config";

export const TRANSACTION_QUEUE_NAME = "transaction-processing";

export interface TransactionJobData {
  transactionId: string;
  type: "deposit" | "withdraw";
  amount: string;
  phoneNumber: string;
  provider: string;
  stellarAddress: string;
}

export interface TransactionJobResult {
  success: boolean;
  transactionId: string;
  error?: string;
}

export const transactionQueue = new Queue<
  TransactionJobData,
  TransactionJobResult
>(TRANSACTION_QUEUE_NAME, queueOptions);

export async function addTransactionJob(
  data: TransactionJobData,
  options?: {
    priority?: number;
    delay?: number;
    repeat?: { every: number };
    jobId?: string;
  },
) {
  return await transactionQueue.add("process-transaction", data, {
    jobId: options?.jobId ?? data.transactionId,
    priority: options?.priority,
    delay: options?.delay,
    repeat: options?.repeat,
  });
}

export async function getJobById(jobId: string) {
  return await transactionQueue.getJob(jobId);
}

export async function getJobProgress(jobId: string): Promise<number> {
  const job = await transactionQueue.getJob(jobId);
  if (!job) return 0;
  return (job.progress as number) || 0;
}

export async function getQueueStats() {
  const [waiting, active, completed, failed] = await Promise.all([
    transactionQueue.getWaitingCount(),
    transactionQueue.getActiveCount(),
    transactionQueue.getCompletedCount(),
    transactionQueue.getFailedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    isPaused: await transactionQueue.isPaused(),
  };
}

export async function pauseQueue() {
  await transactionQueue.pause();
}

export async function resumeQueue() {
  await transactionQueue.resume();
}

export async function drainQueue() {
  await transactionQueue.drain();
}

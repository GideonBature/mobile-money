import { connection } from "./config";
import { transactionQueue } from "./transactionQueue";
import { transactionWorker, closeWorker } from "./worker";

export async function shutdownQueue(): Promise<void> {
  await closeWorker().catch(() => undefined);
  await transactionQueue.close().catch(() => undefined);
  await connection.quit().catch(() => undefined);
}

export {
  transactionQueue,
  addTransactionJob,
  getJobById,
  getJobProgress,
  getQueueStats,
  pauseQueue,
  resumeQueue,
  drainQueue,
} from "./transactionQueue";
export type {
  TransactionJobData,
  TransactionJobResult,
} from "./transactionQueue";
export { transactionWorker, closeWorker };
export { createQueueDashboard } from "./dashboard";
export {
  getQueueHealth,
  pauseQueueEndpoint,
  resumeQueueEndpoint,
} from "./health";
export { queueOptions } from "./config";

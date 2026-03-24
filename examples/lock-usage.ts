/**
 * Examples of using distributed locks to prevent race conditions
 */

import { lockManager, LockKeys } from '../src/utils/lock';
import { TransactionModel, TransactionStatus } from '../src/models/transaction';

const transactionModel = new TransactionModel();

/**
 * Example 1: Prevent duplicate transactions
 * Ensures only one transaction can be created per phone number at a time
 */
export async function createTransactionSafely(
  phoneNumber: string,
  amount: string,
  provider: string,
  stellarAddress: string
) {
  const lockKey = LockKeys.phoneNumber(phoneNumber);
  
  return await lockManager.withLock(lockKey, async () => {
    // Check for existing pending transaction
    const existing = await transactionModel.findById(phoneNumber);
    if (existing && existing.status === TransactionStatus.Pending) {
      throw new Error('Transaction already in progress for this phone number');
    }
    
    // Create new transaction
    return await transactionModel.create({
      type: 'deposit',
      amount,
      phoneNumber,
      provider,
      stellarAddress,
      status: TransactionStatus.Pending
    });
  }, 15000);
}

/**
 * Example 2: Ensure single processing
 * Prevents multiple workers from processing the same transaction
 */
export async function processTransactionSafely(transactionId: string) {
  const lockKey = LockKeys.transaction(transactionId);
  
  return await lockManager.withLock(lockKey, async () => {
    const tx = await transactionModel.findById(transactionId);
    
    if (!tx) {
      throw new Error('Transaction not found');
    }
    
    if (tx.status !== TransactionStatus.Pending) {
      throw new Error('Transaction already processed');
    }
    
    // Process transaction (this can only happen once)
    console.log(`Processing transaction: ${tx.referenceNumber}`);
    
    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await transactionModel.updateStatus(transactionId, TransactionStatus.Completed);
    
    return tx;
  }, 30000);
}

/**
 * Example 3: Coordinate distributed workers
 * Multiple workers can safely pick up jobs without conflicts
 */
export async function pickUpNextJob(workerId: string) {
  const jobs = await getAvailableJobs();
  
  for (const job of jobs) {
    const lockKey = `job:${job.id}`;
    
    // Try to acquire lock without blocking
    const lock = await lockManager.tryAcquire(lockKey, 60000);
    
    if (lock) {
      try {
        console.log(`Worker ${workerId} picked up job ${job.id}`);
        await executeJob(job);
        return job;
      } finally {
        await lockManager.release(lock);
      }
    }
    // If lock not available, try next job
  }
  
  return null; // No jobs available
}

/**
 * Example 4: Provider-specific rate limiting
 * Ensure only one request per provider per phone number at a time
 */
export async function callProviderAPI(
  provider: string,
  phoneNumber: string,
  operation: () => Promise<any>
) {
  const lockKey = LockKeys.provider(provider, phoneNumber);
  
  return await lockManager.withLock(lockKey, async () => {
    console.log(`Calling ${provider} API for ${phoneNumber}`);
    return await operation();
  }, 10000);
}

/**
 * Example 5: Manual lock management with extension
 * For long-running operations that need periodic extension
 */
export async function longRunningOperation(resourceId: string) {
  const lockKey = `resource:${resourceId}`;
  const lock = await lockManager.acquire(lockKey, 10000);
  
  try {
    // Start operation
    await step1();
    
    // Extend lock if needed
    await lockManager.extend(lock, 10000);
    await step2();
    
    // Extend again
    await lockManager.extend(lock, 10000);
    await step3();
    
    return 'completed';
  } finally {
    await lockManager.release(lock);
  }
}

// Helper functions for examples
async function getAvailableJobs() {
  return [{ id: '1' }, { id: '2' }, { id: '3' }];
}

async function executeJob(job: any) {
  await new Promise(resolve => setTimeout(resolve, 1000));
}

async function step1() {
  await new Promise(resolve => setTimeout(resolve, 3000));
}

async function step2() {
  await new Promise(resolve => setTimeout(resolve, 3000));
}

async function step3() {
  await new Promise(resolve => setTimeout(resolve, 3000));
}

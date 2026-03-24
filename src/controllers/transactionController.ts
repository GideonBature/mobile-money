import { Request, Response } from "express";
import { StellarService } from "../services/stellar/stellarService";
import { MobileMoneyService } from "../services/mobilemoney/mobileMoneyService";
import { TransactionModel, TransactionStatus } from "../models/transaction";
import { lockManager, LockKeys } from "../utils/lock";
import { addTransactionJob, getJobProgress } from "../queue";

const stellarService = new StellarService();
const mobileMoneyService = new MobileMoneyService();
const transactionModel = new TransactionModel();

export const depositHandler = async (req: Request, res: Response) => {
  try {
    const { amount, phoneNumber, provider, stellarAddress } = req.body;

    const result = await lockManager.withLock(
      LockKeys.phoneNumber(phoneNumber),
      async () => {
        const transaction = await transactionModel.create({
          type: "deposit",
          amount,
          phoneNumber,
          provider,
          stellarAddress,
          status: TransactionStatus.Pending,
          tags: [],
        });

        const job = await addTransactionJob({
          transactionId: transaction.id,
          type: "deposit",
          amount,
          phoneNumber,
          provider,
          stellarAddress,
        });

        return {
          transactionId: transaction.id,
          referenceNumber: transaction.referenceNumber,
          status: TransactionStatus.Pending,
          jobId: job.id,
        };
      },
      15000,
    );

    res.json(result);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Unable to acquire lock")
    ) {
      return res
        .status(409)
        .json({
          error: "Transaction already in progress for this phone number",
        });
    }
    res.status(500).json({ error: "Transaction failed" });
  }
};

export const withdrawHandler = async (req: Request, res: Response) => {
  try {
    const { amount, phoneNumber, provider, stellarAddress } = req.body;

    const transaction = await transactionModel.create({
      type: "withdraw",
      amount,
      phoneNumber,
      provider,
      stellarAddress,
      status: TransactionStatus.Pending,
      tags: [],
    });

    const job = await addTransactionJob({
      transactionId: transaction.id,
      type: "withdraw",
      amount,
      phoneNumber,
      provider,
      stellarAddress,
    });

    res.json({
      transactionId: transaction.id,
      referenceNumber: transaction.referenceNumber,
      status: TransactionStatus.Pending,
      jobId: job.id,
    });
  } catch (error) {
    res.status(500).json({ error: "Transaction failed" });
  }
};

export const getTransactionHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const transaction = await transactionModel.findById(id);

    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    let jobProgress = null;
    if (transaction.status === TransactionStatus.Pending) {
      jobProgress = await getJobProgress(id);
    }

    res.json({ ...transaction, jobProgress });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch transaction" });
  }
};


export const cancelTransactionHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const transaction = await transactionModel.findById(id);

    if (!transaction) {
      return res.status(404).json({
        error: "Transaction not found",
      });
    }

    if (transaction.status !== "pending") {
      return res.status(400).json({
        error: `Cannot cancel transaction with status '${transaction.status}'`,
      });
    }

    const updatedTransaction = await transactionModel.updateStatus(id, "cancelled" );

    console.log("Transaction cancelled", {
      transactionId: id,
      reason: reason || null,
      cancelledAt: new Date().toISOString(),
    });

    try {
      if (process.env.WEBHOOK_URL) {
        await fetch(process.env.WEBHOOK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            event: "transaction.cancelled",
            data: updatedTransaction,
          }),
        });
      }
    } catch (webhookError) {
      console.error("Webhook notification failed", webhookError);
    }

    return res.json({
      message: "Transaction cancelled successfully",
      transaction: updatedTransaction,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to cancel transaction",
    });
  }
};

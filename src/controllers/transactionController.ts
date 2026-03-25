import { Request, Response } from 'express';
import { StellarService } from '../services/stellar/stellarService';
import { MobileMoneyService } from '../services/mobilemoney/mobileMoneyService';
import { TransactionModel } from '../models/transaction';
import { lockManager, LockKeys } from '../utils/lock';
import { TransactionLimitService } from '../services/transactionLimit/transactionLimitService';
import { KYCService } from '../services/kyc/kycService';

const stellarService = new StellarService();
const mobileMoneyService = new MobileMoneyService();
const transactionModel = new TransactionModel();
const kycService = new KYCService();
const transactionLimitService = new TransactionLimitService(kycService, transactionModel);

export const depositHandler = async (req: Request, res: Response) => {
  try {
    const { amount, phoneNumber, provider, stellarAddress, userId } = req.body;
    
    // Validate transaction limit
    const limitCheck = await transactionLimitService.checkTransactionLimit(
      userId,
      parseFloat(amount)
    );
    
    if (!limitCheck.allowed) {
      return res.status(400).json({
        error: 'Transaction limit exceeded',
        details: {
          kycLevel: limitCheck.kycLevel,
          dailyLimit: limitCheck.dailyLimit,
          currentDailyTotal: limitCheck.currentDailyTotal,
          remainingLimit: limitCheck.remainingLimit,
          message: limitCheck.message,
          upgradeAvailable: limitCheck.upgradeAvailable
        }
      });
    }
    
    // Use distributed lock to prevent duplicate transactions from same phone number
    const result = await lockManager.withLock(
      LockKeys.phoneNumber(phoneNumber),
      async () => {
        const transaction = await transactionModel.create({
          type: 'deposit',
          amount,
          phoneNumber,
          provider,
          stellarAddress,
          status: 'pending',
          tags: []
        });

        const mobileMoneyResult = await mobileMoneyService.initiatePayment(
          provider,
          phoneNumber,
          amount
        );

        if (mobileMoneyResult.success) {
          await stellarService.sendPayment(stellarAddress, amount);
          await transactionModel.updateStatus(transaction.id, 'completed');
        }

        return { transactionId: transaction.id, referenceNumber: transaction.referenceNumber, status: 'completed' };
      },
      15000 // 15 second TTL
    );

    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unable to acquire lock')) {
      return res.status(409).json({ error: 'Transaction already in progress for this phone number' });
    }
    res.status(500).json({ error: 'Transaction failed' });
  }
};

export const withdrawHandler = async (req: Request, res: Response) => {
  try {
    const { amount, phoneNumber, provider, stellarAddress, userId } = req.body;
    
    // Validate transaction limit
    const limitCheck = await transactionLimitService.checkTransactionLimit(
      userId,
      parseFloat(amount)
    );
    
    if (!limitCheck.allowed) {
      return res.status(400).json({
        error: 'Transaction limit exceeded',
        details: {
          kycLevel: limitCheck.kycLevel,
          dailyLimit: limitCheck.dailyLimit,
          currentDailyTotal: limitCheck.currentDailyTotal,
          remainingLimit: limitCheck.remainingLimit,
          message: limitCheck.message,
          upgradeAvailable: limitCheck.upgradeAvailable
        }
      });
    }
    
    const transaction = await transactionModel.create({
      type: 'withdraw',
      amount,
      phoneNumber,
      provider,
      stellarAddress,
      status: 'pending',
      tags: []
    });

    res.json({ transactionId: transaction.id, status: 'pending' });
  } catch (error) {
    res.status(500).json({ error: 'Transaction failed' });
  }
};

export const getTransactionHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const transaction = await transactionModel.findById(id);
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(transaction);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch transaction' });
  }
};

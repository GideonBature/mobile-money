import { Router } from 'express';
import { depositHandler, withdrawHandler, getTransactionHandler } from '../controllers/transactionController';
import { TimeoutPresets, haltOnTimedout } from '../middleware/timeout';

export const transactionRoutes = Router();

// Deposit and withdraw operations may take longer due to external API calls
transactionRoutes.post('/deposit', TimeoutPresets.long, haltOnTimedout, depositHandler);
transactionRoutes.post('/withdraw', TimeoutPresets.long, haltOnTimedout, withdrawHandler);

// Quick read operation
transactionRoutes.get('/:id', TimeoutPresets.quick, haltOnTimedout, getTransactionHandler);

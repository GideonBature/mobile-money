import { Router } from "express";
import {
  depositHandler,
  withdrawHandler,
  getTransactionHandler,
  cancelTransactionHandler,
  validateTransaction,
  getTransactionHistoryHandler,
  updateNotesHandler,
  searchTransactionsHandler,
} from "../controllers/transactionController";
import { TimeoutPresets, haltOnTimedout } from "../middleware/timeout";

export const transactionRoutes = Router();

// --- Transaction History ---
transactionRoutes.get(
  "/",
  TimeoutPresets.quick,
  haltOnTimedout,
  getTransactionHistoryHandler,
);

// Static paths before /:id
transactionRoutes.get(
  "/search",
  TimeoutPresets.quick,
  haltOnTimedout,
  searchTransactionsHandler,
);

transactionRoutes.post(
  "/deposit",
  TimeoutPresets.long,
  haltOnTimedout,
  validateTransaction,
  depositHandler,
);

transactionRoutes.post(
  "/withdraw",
  TimeoutPresets.long,
  haltOnTimedout,
  validateTransaction,
  withdrawHandler,
);

transactionRoutes.get(
  "/:id",
  TimeoutPresets.quick,
  haltOnTimedout,
  getTransactionHandler,
);

transactionRoutes.patch(
  "/:id/notes",
  TimeoutPresets.quick,
  haltOnTimedout,
  updateNotesHandler,
);

transactionRoutes.post(
  "/:id/cancel",
  TimeoutPresets.quick,
  haltOnTimedout,
  cancelTransactionHandler,
);

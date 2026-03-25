/**
 * Bulk Transaction Import via CSV
 *
 * CSV Format:
 *   amount,phoneNumber,provider,stellarAddress
 *   10000,+237670000000,MTN,GABC...XYZ
 *
 * Fields:
 *   - amount        : Positive number (e.g. 10000)
 *   - phoneNumber   : E.164 format phone number (e.g. +237670000000)
 *   - provider      : One of MTN, AIRTEL, ORANGE (case-insensitive)
 *   - stellarAddress: 56-character Stellar public key starting with G
 *
 * Endpoints:
 *   POST /api/transactions/bulk
 *     Accepts multipart/form-data with field name "file" (CSV, max 10 MB).
 *     Validates all rows first — returns 422 with validation errors if any fail.
 *     On success starts async processing and returns a jobId (HTTP 202).
 *
 *   GET /api/transactions/bulk/:jobId
 *     Returns current status of the bulk import job.
 */

import { Router, Request, Response, NextFunction } from "express";
import multer, { MulterError } from "multer";
import csvParser from "csv-parser";
import { Readable } from "stream";
import { TransactionModel, TransactionStatus } from "../models/transaction";
import { MobileMoneyService } from "../services/mobilemoney/mobileMoneyService";
import { StellarService } from "../services/stellar/stellarService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CsvRow {
  amount: string;
  phoneNumber: string;
  provider: string;
  stellarAddress: string;
}

interface ValidationError {
  row: number;
  field: string;
  message: string;
}

type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface BulkJob {
  id: string;
  status: JobStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
  createdAt: Date;
  completedAt?: Date;
}

// ---------------------------------------------------------------------------
// In-memory job store
// ---------------------------------------------------------------------------

const jobs = new Map<string, BulkJob>();

export function getBulkImportJob(jobId: string): BulkJob | undefined {
  return jobs.get(jobId);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const SUPPORTED_PROVIDERS = ["MTN", "AIRTEL", "ORANGE"];
const PHONE_REGEX = /^\+\d{7,15}$/;
const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

function validateRow(row: CsvRow, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const rowNum = index + 2; // +1 for 0-index, +1 for header row

  if (!row.amount || isNaN(Number(row.amount)) || Number(row.amount) <= 0) {
    errors.push({
      row: rowNum,
      field: "amount",
      message: "Must be a positive number",
    });
  }

  if (!row.phoneNumber || !PHONE_REGEX.test(row.phoneNumber.trim())) {
    errors.push({
      row: rowNum,
      field: "phoneNumber",
      message: "Must be a valid E.164 phone number (e.g. +237670000000)",
    });
  }

  if (
    !row.provider ||
    !SUPPORTED_PROVIDERS.includes(row.provider.trim().toUpperCase())
  ) {
    errors.push({
      row: rowNum,
      field: "provider",
      message: `Must be one of: ${SUPPORTED_PROVIDERS.join(", ")}`,
    });
  }

  if (
    !row.stellarAddress ||
    !STELLAR_ADDRESS_REGEX.test(row.stellarAddress.trim())
  ) {
    errors.push({
      row: rowNum,
      field: "stellarAddress",
      message:
        "Must be a valid Stellar public key (56 characters, starting with G)",
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

function parseCsv(buffer: Buffer): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    const rows: CsvRow[] = [];
    Readable.from(buffer.toString("utf-8"))
      .pipe(
        csvParser({
          mapHeaders: ({ header }) => header.trim(),
          mapValues: ({ value }) => value.trim(),
        }),
      )
      .on("data", (row: CsvRow) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Async job processor
// ---------------------------------------------------------------------------

async function processJob(jobId: string, rows: CsvRow[]): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "processing";

  try {
    const transactionModel = new TransactionModel();
    const mobileMoneyService = new MobileMoneyService();

    let stellarService: StellarService | null = null;
    try {
      stellarService = new StellarService();
    } catch {
      console.warn(
        "[BulkImport] StellarService unavailable — deposits will be skipped",
      );
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const transaction = await transactionModel.create({
          type: "deposit",
          amount: row.amount,
          phoneNumber: row.phoneNumber,
          provider: row.provider.toUpperCase(),
          stellarAddress: row.stellarAddress,
          status: TransactionStatus.Pending,
          tags: [],
        });

        // initiatePayment throws on failure — only attempt Stellar if it succeeds
        await mobileMoneyService.initiatePayment(
          row.provider,
          row.phoneNumber,
          row.amount,
        );

        if (stellarService) {
          await stellarService.sendPayment(row.stellarAddress, row.amount);
          await transactionModel.updateStatus(
            transaction.id,
            TransactionStatus.Completed,
          );
        } else {
          await transactionModel.updateStatus(
            transaction.id,
            TransactionStatus.Failed,
          );
          throw new Error("StellarService unavailable — deposit not completed");
        }

        job.succeeded++;
      } catch (error) {
        job.failed++;
        job.errors.push({
          row: i + 2, // +1 for 0-index, +1 for header row
          error: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        job.processed++;
      }
    }
  } catch (error) {
    console.error("[BulkImport] Fatal error in processJob:", error);
  } finally {
    job.status = "completed";
    job.completedAt = new Date();
  }
}

// ---------------------------------------------------------------------------
// Multer — memory storage, 10 MB limit, CSV only
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isCsv =
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.toLowerCase().endsWith(".csv");
    if (isCsv) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are accepted"));
    }
  },
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const bulkRoutes = Router();

/**
 * POST /api/transactions/bulk
 *
 * Upload a CSV file to import transactions in bulk.
 * Accepts multipart/form-data with field "file".
 * All rows are validated before processing begins.
 * Processing happens asynchronously — poll the returned statusUrl for progress.
 */
bulkRoutes.post(
  "/",
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded",
        message:
          'Send a CSV file using multipart/form-data with field name "file"',
      });
    }

    // Parse CSV
    let rows: CsvRow[];
    try {
      rows = await parseCsv(req.file.buffer);
    } catch (err) {
      return res.status(400).json({
        error: "Failed to parse CSV",
        message: err instanceof Error ? err.message : "Unknown parse error",
      });
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: "CSV file contains no data rows" });
    }

    // Validate all rows before processing
    const validationErrors: ValidationError[] = [];
    rows.forEach((row, index) => {
      validationErrors.push(...validateRow(row, index));
    });

    if (validationErrors.length > 0) {
      return res.status(422).json({
        error: "CSV validation failed — no transactions were processed",
        totalErrors: validationErrors.length,
        validationErrors,
      });
    }

    // Create job and kick off async processing
    const jobId = crypto.randomUUID();
    const job: BulkJob = {
      id: jobId,
      status: "pending",
      total: rows.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      createdAt: new Date(),
    };
    jobs.set(jobId, job);

    setImmediate(() => processJob(jobId, rows));

    return res.status(202).json({
      jobId,
      message: `Bulk import queued — ${rows.length} transaction(s) will be processed`,
      statusUrl: `/api/transactions/bulk/${jobId}`,
    });
  },
);

// Handle multer errors (file size, wrong type)
bulkRoutes.use(
  (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(413)
        .json({ error: "File too large — maximum size is 10 MB" });
    }
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  },
);

/**
 * GET /api/transactions/bulk/:jobId
 *
 * Poll the status of a bulk import job.
 *
 * Response fields:
 *   - status      : pending | processing | completed | failed
 *   - progress    : { total, processed, succeeded, failed }
 *   - errors      : per-row runtime errors encountered during processing
 *   - createdAt   : ISO timestamp
 *   - completedAt : ISO timestamp (only when status = "completed")
 */
bulkRoutes.get("/:jobId", (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  return res.json({
    jobId: job.id,
    status: job.status,
    progress: {
      total: job.total,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
    },
    errors: job.errors,
    createdAt: job.createdAt,
    ...(job.completedAt && { completedAt: job.completedAt }),
  });
});

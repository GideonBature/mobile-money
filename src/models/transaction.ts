import { pool } from "../config/database";
import { generateReferenceNumber } from "../utils/referenceGenerator";

export enum TransactionStatus {
  Pending = "pending",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}

const MAX_TAGS = 10;
// Tags must be lowercase alphanumeric words, hyphens allowed (e.g. "refund", "high-priority")
const TAG_REGEX = /^[a-z0-9-]+$/;

function validateTags(tags: string[]): void {
  if (tags.length > MAX_TAGS)
    throw new Error(`Maximum ${MAX_TAGS} tags allowed`);
  for (const tag of tags) {
    if (!TAG_REGEX.test(tag)) throw new Error(`Invalid tag format: "${tag}"`);
  }
}

export interface Transaction {
  id: string;
  referenceNumber: string;
  type: "deposit" | "withdraw";
  amount: string;
  phoneNumber: string;
  provider: string;
  stellarAddress: string;
  status: TransactionStatus;
  tags: string[];
  notes?: string;
  admin_notes?: string;
  retryCount?: number;
  createdAt: Date;
}

/** Map a pg row (snake_case) to the Transaction interface */
export function mapTransactionRow(
  row: Record<string, unknown> | undefined | null,
): Transaction | null {
  if (!row) return null;
  const created = row.created_at ?? row.createdAt;
  return {
    id: String(row.id),
    referenceNumber: String(row.reference_number ?? row.referenceNumber ?? ""),
    type: (row.type as Transaction["type"]) || "deposit",
    amount: String(row.amount ?? ""),
    phoneNumber: String(row.phone_number ?? row.phoneNumber ?? ""),
    provider: String(row.provider ?? ""),
    stellarAddress: String(row.stellar_address ?? row.stellarAddress ?? ""),
    status: row.status as TransactionStatus,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    notes:
      row.notes != null && row.notes !== ""
        ? String(row.notes)
        : undefined,
    admin_notes:
      row.admin_notes != null && row.admin_notes !== ""
        ? String(row.admin_notes)
        : undefined,
    retryCount: Number(row.retry_count ?? 0),
    createdAt:
      created instanceof Date ? created : new Date(String(created ?? "")),
  };
}

export class TransactionModel {
  async create(
    data: Omit<Transaction, "id" | "referenceNumber" | "createdAt">,
  ): Promise<Transaction> {
    const tags = data.tags ?? [];
    validateTags(tags);
    const referenceNumber = await generateReferenceNumber();

    const result = await pool.query(
      `INSERT INTO transactions (reference_number, type, amount, phone_number, provider, stellar_address, status, tags, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        referenceNumber,
        data.type,
        data.amount,
        data.phoneNumber,
        data.provider,
        data.stellarAddress,
        data.status,
        tags,
        data.notes ?? null,
      ],
    );
    return mapTransactionRow(result.rows[0])!;
  }

  async findById(id: string): Promise<Transaction | null> {
    const result = await pool.query(
      "SELECT * FROM transactions WHERE id = $1",
      [id],
    );
    return mapTransactionRow(result.rows[0]);
  }

  /** Paginated list, newest first. `limit` is capped at 100. */
  async list(limit = 50, offset = 0): Promise<Transaction[]> {
    const capped = Math.min(Math.max(limit, 1), 100);
    const off = Math.max(offset, 0);
    const result = await pool.query(
      "SELECT * FROM transactions ORDER BY created_at DESC LIMIT $1 OFFSET $2",
      [capped, off],
    );
    return result.rows
      .map((r) => mapTransactionRow(r))
      .filter((t): t is Transaction => t !== null);
  }

  async updateStatus(id: string, status: TransactionStatus): Promise<void> {
    await pool.query("UPDATE transactions SET status = $1 WHERE id = $2", [
      status,
      id,
    ]);
  }

  async findByReferenceNumber(
    referenceNumber: string,
  ): Promise<Transaction | null> {
    const result = await pool.query(
      "SELECT * FROM transactions WHERE reference_number = $1",
      [referenceNumber],
    );
    return mapTransactionRow(result.rows[0]);
  }

  /**
   * Find transactions that contain ALL of the given tags.
   * Uses the GIN index on the tags column for efficient lookup.
   * @param tags - Array of tags to filter by (e.g. ["refund", "verified"])
   */
  async findByTags(tags: string[]): Promise<Transaction[]> {
    validateTags(tags);
    const result = await pool.query(
      "SELECT * FROM transactions WHERE tags @> $1",
      [tags],
    );
    return result.rows
      .map((r) => mapTransactionRow(r))
      .filter((t): t is Transaction => t !== null);
  }

  /**
   * Add tags to a transaction. Ignores duplicates. Max 10 tags total.
   */
  async addTags(id: string, tags: string[]): Promise<Transaction | null> {
    validateTags(tags);
    const result = await pool.query(
      `UPDATE transactions
       SET tags = (
         SELECT ARRAY(SELECT DISTINCT unnest(tags || $1::TEXT[]))
         FROM transactions WHERE id = $2
       )
       WHERE id = $2
         AND cardinality(ARRAY(SELECT DISTINCT unnest(tags || $1::TEXT[]))) <= ${MAX_TAGS}
       RETURNING *`,
      [tags, id],
    );
    return mapTransactionRow(result.rows[0]);
  }

  /**
   * Remove tags from a transaction.
   */
  async removeTags(id: string, tags: string[]): Promise<Transaction | null> {
    const result = await pool.query(
      `UPDATE transactions
       SET tags = ARRAY(SELECT unnest(tags) EXCEPT SELECT unnest($1::TEXT[]))
       WHERE id = $2
       RETURNING *`,
      [tags, id],
    );
    return mapTransactionRow(result.rows[0]);
  }

  /**
   * Find completed transactions for a user since a given date.
   * Used for calculating daily transaction totals within a rolling 24-hour window.
   * @param userId - The user's ID
   * @param since - The start date for the time window
   * @returns Array of completed transactions ordered by created_at DESC
   */
  async findCompletedByUserSince(
    userId: string,
    since: Date,
  ): Promise<Transaction[]> {
    const result = await pool.query(
      `SELECT * FROM transactions 
       WHERE user_id = $1 
       AND status = $2 
       AND created_at >= $3
       ORDER BY created_at DESC`,
      [userId, TransactionStatus.Completed, since],
    );
    return result.rows
      .map((r) => mapTransactionRow(r))
      .filter((t): t is Transaction => t !== null);
  }

  /** Increments retry_count after a failed transient attempt (before the next try). */
  async incrementRetryCount(id: string): Promise<number> {
    const r = await pool.query(
      `UPDATE transactions
       SET retry_count = retry_count + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING retry_count`,
      [id],
    );
    return Number(r.rows[0]?.retry_count ?? 0);
  }

  async updateNotes(id: string, notes: string): Promise<Transaction | null> {
    if (notes.length > 1000)
      throw new Error("Notes cannot exceed 1000 characters");
    const result = await pool.query(
      "UPDATE transactions SET notes = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
      [notes, id],
    );
    return mapTransactionRow(result.rows[0]);
  }

  async updateAdminNotes(
    id: string,
    adminNotes: string,
  ): Promise<Transaction | null> {
    if (adminNotes.length > 1000)
      throw new Error("Admin notes cannot exceed 1000 characters");
    const result = await pool.query(
      "UPDATE transactions SET admin_notes = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
      [adminNotes, id],
    );
    return mapTransactionRow(result.rows[0]);
  }

  async searchByNotes(query: string): Promise<Transaction[]> {
    const result = await pool.query(
      `SELECT * FROM transactions 
       WHERE to_tsvector('english', COALESCE(notes, '') || ' ' || COALESCE(admin_notes, '')) @@ plainto_tsquery('english', $1)
       ORDER BY created_at DESC`,
      [query],
    );
    return result.rows
      .map((r) => mapTransactionRow(r))
      .filter((t): t is Transaction => t !== null);
  }
}

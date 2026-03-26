import { pool } from "../config/database";
import { generateReferenceNumber } from "../utils/referenceGenerator";

export enum TransactionStatus {
  Pending = "pending",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}

const MAX_TAGS = 10;
const TAG_REGEX = /^[a-z0-9-]+$/;

const TRANSACTION_SELECT_COLUMNS = `
  id,
  reference_number AS "referenceNumber",
  type,
  amount::text AS amount,
  phone_number AS "phoneNumber",
  provider,
  stellar_address AS "stellarAddress",
  status,
  COALESCE(tags, '{}') AS tags,
  notes,
  admin_notes AS "adminNotes",
  user_id AS "userId",
  idempotency_key AS "idempotencyKey",
  idempotency_expires_at AS "idempotencyExpiresAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

function validateTags(tags: string[]): void {
  if (tags.length > MAX_TAGS) {
    throw new Error(`Maximum ${MAX_TAGS} tags allowed`);
  }

  for (const tag of tags) {
    if (!TAG_REGEX.test(tag)) {
      throw new Error(`Invalid tag format: "${tag}"`);
    }
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
  webhook_delivery_status?: "pending" | "delivered" | "failed" | "skipped";
  webhook_last_attempt_at?: Date | null;
  webhook_delivered_at?: Date | null;
  webhook_last_error?: string | null;
  createdAt: Date;
  updatedAt?: Date | null;
}

export interface CreateTransactionInput {
  type: Transaction["type"];
  amount: string | number;
  phoneNumber: string;
  provider: string;
  stellarAddress: string;
  status: TransactionStatus;
  tags?: string[];
  notes?: string | null;
  userId?: string | null;
  idempotencyKey?: string | null;
  idempotencyExpiresAt?: Date | null;
}

export interface WebhookDeliveryUpdate {
  status: "pending" | "delivered" | "failed" | "skipped";
  lastAttemptAt?: Date | null;
  deliveredAt?: Date | null;
  lastError?: string | null;
}

export class TransactionModel {
  async create(data: CreateTransactionInput): Promise<Transaction> {
    const tags = data.tags ?? [];
    validateTags(tags);
    const referenceNumber = await generateReferenceNumber();

    const result = await pool.query<Transaction>(
      `INSERT INTO transactions (
        reference_number,
        type,
        amount,
        phone_number,
        provider,
        stellar_address,
        status,
        tags,
        notes,
        user_id,
        idempotency_key,
        idempotency_expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING ${TRANSACTION_SELECT_COLUMNS}`,
      [
        referenceNumber,
        data.type,
        String(data.amount),
        data.phoneNumber,
        data.provider,
        data.stellarAddress,
        data.status,
        tags,
        data.notes ?? null,
        data.userId ?? null,
        data.idempotencyKey ?? null,
        data.idempotencyExpiresAt ?? null,
      ],
    );

    return result.rows[0];
  }

  async findById(id: string): Promise<Transaction | null> {
    const result = await pool.query<Transaction>(
      `SELECT ${TRANSACTION_SELECT_COLUMNS}
       FROM transactions
       WHERE id = $1`,
      [id],
    );

    return result.rows[0] || null;
  }

  /** Paginated list, newest first. `limit` is capped at 100. */
  async list(limit = 50, offset = 0, startDate?: string, endDate?: string): Promise<Transaction[]> {
    const capped = Math.min(Math.max(limit, 1), 100);
    const off = Math.max(offset, 0);
    
    let query = "SELECT * FROM transactions WHERE 1=1";
    const params: any[] = [];
    let paramIndex = 1;

    if (startDate) {
      query += ` AND created_at >= $${paramIndex++}`;
      params.push(new Date(startDate).toISOString());
    }
    if (endDate) {
      query += ` AND created_at <= $${paramIndex++}`;
      params.push(new Date(endDate).toISOString());
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(capped, off);

    const result = await pool.query(query, params);
    return result.rows;
  }

  async count(startDate?: string, endDate?: string): Promise<number> {
    let query = "SELECT COUNT(*) FROM transactions WHERE 1=1";
    const params: any[] = [];
    let paramIndex = 1;

    if (startDate) {
      query += ` AND created_at >= $${paramIndex++}`;
      params.push(new Date(startDate).toISOString());
    }
    if (endDate) {
      query += ` AND created_at <= $${paramIndex++}`;
      params.push(new Date(endDate).toISOString());
    }

    const result = await pool.query(query, params);
    return parseInt(result.rows[0].count);
  }

  async updateStatus(id: string, status: TransactionStatus): Promise<void> {
    await pool.query(
      "UPDATE transactions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [status, id],
    );
  }

  async updateWebhookDelivery(
    id: string,
    delivery: WebhookDeliveryUpdate,
  ): Promise<void> {
    await pool.query(
      `UPDATE transactions
       SET webhook_delivery_status = $1,
           webhook_last_attempt_at = $2,
           webhook_delivered_at = $3,
           webhook_last_error = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [
        delivery.status,
        delivery.lastAttemptAt ?? null,
        delivery.deliveredAt ?? null,
        delivery.lastError ?? null,
        id,
      ],
    );
  }

  async findByReferenceNumber(
    referenceNumber: string,
  ): Promise<Transaction | null> {
    const result = await pool.query<Transaction>(
      `SELECT ${TRANSACTION_SELECT_COLUMNS}
       FROM transactions
       WHERE reference_number = $1`,
      [referenceNumber],
    );

    return result.rows[0] || null;
  }

  async findByTags(tags: string[]): Promise<Transaction[]> {
    validateTags(tags);

    const result = await pool.query<Transaction>(
      `SELECT ${TRANSACTION_SELECT_COLUMNS}
       FROM transactions
       WHERE tags @> $1
       ORDER BY created_at DESC`,
      [tags],
    );

    return result.rows;
  }

  async addTags(id: string, tags: string[]): Promise<Transaction | null> {
    validateTags(tags);

    const result = await pool.query<Transaction>(
      `UPDATE transactions
       SET tags = (
         SELECT ARRAY(SELECT DISTINCT unnest(tags || $1::TEXT[]))
         FROM transactions
         WHERE id = $2
       ),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
         AND cardinality(
           ARRAY(SELECT DISTINCT unnest(tags || $1::TEXT[]))
         ) <= ${MAX_TAGS}
       RETURNING ${TRANSACTION_SELECT_COLUMNS}`,
      [tags, id],
    );

    return result.rows[0] || null;
  }

  async removeTags(id: string, tags: string[]): Promise<Transaction | null> {
    const result = await pool.query<Transaction>(
      `UPDATE transactions
       SET tags = ARRAY(
         SELECT unnest(tags)
         EXCEPT
         SELECT unnest($1::TEXT[])
       ),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING ${TRANSACTION_SELECT_COLUMNS}`,
      [tags, id],
    );

    return result.rows[0] || null;
  }

  async findCompletedByUserSince(
    userId: string,
    since: Date,
  ): Promise<Transaction[]> {
    const result = await pool.query<Transaction>(
      `SELECT ${TRANSACTION_SELECT_COLUMNS}
       FROM transactions
       WHERE user_id = $1
         AND status = 'completed'
         AND created_at >= $2
       ORDER BY created_at DESC`,
      [userId, since],
    );

    return result.rows;
  }

  async updateNotes(id: string, notes: string): Promise<Transaction | null> {
    if (notes.length > 1000) {
      throw new Error("Notes cannot exceed 1000 characters");
    }

    const result = await pool.query<Transaction>(
      `UPDATE transactions
       SET notes = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING ${TRANSACTION_SELECT_COLUMNS}`,
      [notes, id],
    );

    return result.rows[0] || null;
  }

  async updateAdminNotes(
    id: string,
    adminNotes: string,
  ): Promise<Transaction | null> {
    if (adminNotes.length > 1000) {
      throw new Error("Admin notes cannot exceed 1000 characters");
    }

    const result = await pool.query<Transaction>(
      `UPDATE transactions
       SET admin_notes = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING ${TRANSACTION_SELECT_COLUMNS}`,
      [adminNotes, id],
    );

    return result.rows[0] || null;
  }

  async searchByNotes(query: string): Promise<Transaction[]> {
    const result = await pool.query<Transaction>(
      `SELECT ${TRANSACTION_SELECT_COLUMNS}
       FROM transactions
       WHERE to_tsvector(
         'english',
         COALESCE(notes, '') || ' ' || COALESCE(admin_notes, '')
       ) @@ plainto_tsquery('english', $1)
       ORDER BY created_at DESC`,
      [query],
    );

    return result.rows;
  }

  /**
   * Search transactions by phone number with partial matching support.
   * Uses LIKE with parameterised queries — safe against SQL injection.
   * Partial input (e.g. last 4 digits) is matched against the end of the number.
   */
  async searchByPhoneNumber(
    phoneNumber: string,
    limit = 50,
    offset = 0,
  ): Promise<{ transactions: Transaction[]; total: number }> {
    const capped = Math.min(Math.max(limit, 1), 100);
    const off = Math.max(offset, 0);

    // Partial match: if fewer than 7 digits, match the suffix; otherwise full LIKE
    const pattern =
      phoneNumber.replace(/^\+/, "").length < 7
        ? `%${phoneNumber}`
        : `%${phoneNumber}%`;

    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS total FROM transactions WHERE phone_number LIKE $1",
      [pattern],
    );
    const total: number = countResult.rows[0].total;

    const result = await pool.query(
      `SELECT * FROM transactions
       WHERE phone_number LIKE $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [pattern, capped, off],
    );

    return { transactions: result.rows, total };
  }
}

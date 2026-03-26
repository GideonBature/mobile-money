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

const MAX_METADATA_BYTES = 10240; // 10 KB

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
  COALESCE(metadata, '{}') AS metadata,
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

function validateMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata === null || metadata === undefined) {
    return {};
  }

  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Metadata must be a JSON object");
  }

  const json = JSON.stringify(metadata);
  if (Buffer.byteLength(json, "utf8") > MAX_METADATA_BYTES) {
    throw new Error(
      `Metadata exceeds maximum size of ${MAX_METADATA_BYTES / 1024} KB`,
    );
  }

  return metadata as Record<string, unknown>;
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
  metadata: Record<string, unknown>;
  userId?: string | null;
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
  metadata?: Record<string, unknown> | null;
}

export interface WebhookDeliveryUpdate {
  status: "pending" | "delivered" | "failed" | "skipped";
  lastAttemptAt?: Date | null;
  deliveredAt?: Date | null;
  lastError?: string | null;
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
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    userId:
      row.user_id != null || row.userId != null
        ? String(row.user_id ?? row.userId)
        : null,
    retryCount: Number(row.retry_count ?? 0),
    createdAt:
      created instanceof Date ? created : new Date(String(created ?? "")),
  };
}

export class TransactionModel {
  async create(data: CreateTransactionInput): Promise<Transaction> {
    const tags = data.tags ?? [];
    validateTags(tags);
    const metadata = validateMetadata(data.metadata);
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
        idempotency_expires_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
        JSON.stringify(metadata),
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
  async list(
    limit = 50,
    offset = 0,
    startDate?: string,
    endDate?: string,
  ): Promise<Transaction[]> {
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

  // ── Metadata (JSONB) ────────────────────────────────────────────────────

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
  ): Promise<Transaction | null> {
    const validated = validateMetadata(metadata);

    const result = await pool.query<Transaction>(
      `UPDATE transactions
       SET metadata = $1::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING ${TRANSACTION_SELECT_COLUMNS}`,
      [JSON.stringify(validated), id],
    );

    return result.rows[0] || null;
  }

  async patchMetadata(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<Transaction | null> {
    validateMetadata(patch);

    // Merge new keys into existing metadata (shallow merge)
    const result = await pool.query<Transaction>(
      `UPDATE transactions
       SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING ${TRANSACTION_SELECT_COLUMNS}`,
      [JSON.stringify(patch), id],
    );

    // Validate combined size
    const row = result.rows[0];
    if (row) {
      const combinedSize = Buffer.byteLength(
        JSON.stringify(row.metadata),
        "utf8",
      );
      if (combinedSize > MAX_METADATA_BYTES) {
        // Roll back by removing the patched keys
        const keys = Object.keys(patch);
        await pool.query(
          `UPDATE transactions
           SET metadata = metadata - $1::text[],
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [keys, id],
        );
        throw new Error(
          `Metadata exceeds maximum size of ${MAX_METADATA_BYTES / 1024} KB`,
        );
      }
    }

    return row || null;
  }

  async removeMetadataKeys(
    id: string,
    keys: string[],
  ): Promise<Transaction | null> {
    if (!keys.length) return this.findById(id);

    const result = await pool.query<Transaction>(
      `UPDATE transactions
       SET metadata = metadata - $1::text[],
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING ${TRANSACTION_SELECT_COLUMNS}`,
      [keys, id],
    );

    return result.rows[0] || null;
  }

  async findByMetadata(
    filter: Record<string, unknown>,
  ): Promise<Transaction[]> {
    const result = await pool.query<Transaction>(
      `SELECT ${TRANSACTION_SELECT_COLUMNS}
       FROM transactions
       WHERE metadata @> $1::jsonb
       ORDER BY created_at DESC`,
      [JSON.stringify(filter)],
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

    const result = await pool.query<Transaction>(
      `SELECT ${TRANSACTION_SELECT_COLUMNS}
       FROM transactions
       WHERE phone_number LIKE $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [pattern, capped, off],
    );

    return { transactions: result.rows, total };
  }

  async releaseExpiredIdempotencyKey(idempotencyKey: string): Promise<void> {
    await pool.query(
      `UPDATE transactions
       SET idempotency_key = NULL,
           idempotency_expires_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE idempotency_key = $1
         AND idempotency_expires_at IS NOT NULL
         AND idempotency_expires_at <= CURRENT_TIMESTAMP`,
      [idempotencyKey],
    );
  }

  async releaseAllExpiredIdempotencyKeys(): Promise<number> {
    const result = await pool.query<{ released: number }>(
      `WITH updated AS (
         UPDATE transactions
         SET idempotency_key = NULL,
             idempotency_expires_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE idempotency_key IS NOT NULL
           AND idempotency_expires_at IS NOT NULL
           AND idempotency_expires_at <= CURRENT_TIMESTAMP
         RETURNING 1
       )
       SELECT COUNT(*)::int AS released FROM updated`,
    );

    return result.rows[0]?.released || 0;
  }

  async findActiveByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<Transaction | null> {
    const result = await pool.query<Transaction>(
      `SELECT ${TRANSACTION_SELECT_COLUMNS}
       FROM transactions
       WHERE idempotency_key = $1
         AND (
           idempotency_expires_at IS NULL
           OR idempotency_expires_at > CURRENT_TIMESTAMP
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [idempotencyKey],
    );

    return result.rows[0] || null;
  }

  async countByStatuses(statuses: TransactionStatus[]): Promise<number> {
    const validStatuses =
      statuses.length > 0 ? statuses : Object.values(TransactionStatus);
    const result = await pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM transactions
       WHERE status = ANY($1::text[])`,
      [validStatuses],
    );

    return result.rows[0]?.total ?? 0;
  }

  async findByStatuses(
    statuses: TransactionStatus[],
    limit = 50,
    offset = 0,
  ): Promise<Transaction[]> {
    const capped = Math.min(Math.max(limit, 1), 1000);
    const off = Math.max(offset, 0);
    const validStatuses =
      statuses.length > 0 ? statuses : Object.values(TransactionStatus);

    const result = await pool.query<Transaction>(
      `SELECT ${TRANSACTION_SELECT_COLUMNS}
       FROM transactions
       WHERE status = ANY($1::text[])
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [validStatuses, capped, off],
    );

    return result.rows;
  }
}

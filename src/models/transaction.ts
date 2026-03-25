import { pool } from '../config/database';
import { generateReferenceNumber } from '../utils/referenceGenerator';

const MAX_TAGS = 10;
// Tags must be lowercase alphanumeric words, hyphens allowed (e.g. "refund", "high-priority")
const TAG_REGEX = /^[a-z0-9-]+$/;

function validateTags(tags: string[]): void {
  if (tags.length > MAX_TAGS) throw new Error(`Maximum ${MAX_TAGS} tags allowed`);
  for (const tag of tags) {
    if (!TAG_REGEX.test(tag)) throw new Error(`Invalid tag format: "${tag}"`);
  }
}

export interface Transaction {
  id: string;
  referenceNumber: string;
  type: 'deposit' | 'withdraw';
  amount: string;
  phoneNumber: string;
  provider: string;
  stellarAddress: string;
  status: 'pending' | 'completed' | 'failed';
  tags: string[];
  createdAt: Date;
}

export class TransactionModel {
  async create(data: Omit<Transaction, 'id' | 'referenceNumber' | 'createdAt'>): Promise<Transaction> {
    const tags = data.tags ?? [];
    validateTags(tags);
    const referenceNumber = await generateReferenceNumber();

    const result = await pool.query(
      `INSERT INTO transactions (reference_number, type, amount, phone_number, provider, stellar_address, status, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [referenceNumber, data.type, data.amount, data.phoneNumber, data.provider, data.stellarAddress, data.status, tags]
    );
    return result.rows[0];
  }

  async findById(id: string): Promise<Transaction | null> {
    const result = await pool.query('SELECT * FROM transactions WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await pool.query('UPDATE transactions SET status = $1 WHERE id = $2', [status, id]);
  }

  async findByReferenceNumber(referenceNumber: string): Promise<Transaction | null> {
    const result = await pool.query(
      'SELECT * FROM transactions WHERE reference_number = $1',
      [referenceNumber]
    );
    return result.rows[0] || null;
  }

  /**
   * Find transactions that contain ALL of the given tags.
   * Uses the GIN index on the tags column for efficient lookup.
   * @param tags - Array of tags to filter by (e.g. ["refund", "verified"])
   */
  async findByTags(tags: string[]): Promise<Transaction[]> {
    validateTags(tags);
    const result = await pool.query(
      'SELECT * FROM transactions WHERE tags @> $1',
      [tags]
    );
    return result.rows;
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
      [tags, id]
    );
    return result.rows[0] || null;
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
      [tags, id]
    );
    return result.rows[0] || null;
  }

  /**
   * Find completed transactions for a user since a given date.
   * Used for calculating daily transaction totals within a rolling 24-hour window.
   * @param userId - The user's ID
   * @param since - The start date for the time window
   * @returns Array of completed transactions ordered by created_at DESC
   */
  async findCompletedByUserSince(userId: string, since: Date): Promise<Transaction[]> {
    const result = await pool.query(
      `SELECT * FROM transactions 
       WHERE user_id = $1 
       AND status = 'completed' 
       AND created_at >= $2
       ORDER BY created_at DESC`,
      [userId, since]
    );
    return result.rows;
  }
}

import { pool } from '../config/database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DisputeStatus = 'open' | 'investigating' | 'resolved' | 'rejected';

export interface Dispute {
  id: string;
  transactionId: string;
  reason: string;
  status: DisputeStatus;
  assignedTo: string | null;
  resolution: string | null;
  reportedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DisputeNote {
  id: string;
  disputeId: string;
  author: string;
  note: string;
  createdAt: Date;
}

export interface DisputeWithNotes extends Dispute {
  notes: DisputeNote[];
}

export interface DisputeReportRow {
  status: DisputeStatus;
  count: string;
  avgResolutionHours: string | null;
}

export interface CreateDisputeInput {
  transactionId: string;
  reason: string;
  reportedBy?: string;
}

export interface UpdateDisputeInput {
  status: DisputeStatus;
  resolution?: string;
  assignedTo?: string;
}

export interface ReportFilter {
  from?: Date;
  to?: Date;
  assignedTo?: string;
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export class DisputeModel {
  /** Create a new dispute record. */
  async create(input: CreateDisputeInput): Promise<Dispute> {
    const result = await pool.query<Dispute>(
      `INSERT INTO disputes (transaction_id, reason, reported_by)
       VALUES ($1, $2, $3)
       RETURNING
         id,
         transaction_id  AS "transactionId",
         reason,
         status,
         assigned_to     AS "assignedTo",
         resolution,
         reported_by     AS "reportedBy",
         created_at      AS "createdAt",
         updated_at      AS "updatedAt"`,
      [input.transactionId, input.reason, input.reportedBy ?? null]
    );
    return result.rows[0];
  }

  /** Find a dispute by its ID (without notes). */
  async findById(disputeId: string): Promise<Dispute | null> {
    const result = await pool.query<Dispute>(
      `SELECT
         id,
         transaction_id  AS "transactionId",
         reason,
         status,
         assigned_to     AS "assignedTo",
         resolution,
         reported_by     AS "reportedBy",
         created_at      AS "createdAt",
         updated_at      AS "updatedAt"
       FROM disputes
       WHERE id = $1`,
      [disputeId]
    );
    return result.rows[0] ?? null;
  }

  /** Find a dispute with all its notes. */
  async findByIdWithNotes(disputeId: string): Promise<DisputeWithNotes | null> {
    const disputeResult = await pool.query<Dispute>(
      `SELECT
         id,
         transaction_id  AS "transactionId",
         reason,
         status,
         assigned_to     AS "assignedTo",
         resolution,
         reported_by     AS "reportedBy",
         created_at      AS "createdAt",
         updated_at      AS "updatedAt"
       FROM disputes
       WHERE id = $1`,
      [disputeId]
    );

    if (!disputeResult.rows[0]) return null;

    const notesResult = await pool.query<DisputeNote>(
      `SELECT
         id,
         dispute_id  AS "disputeId",
         author,
         note,
         created_at  AS "createdAt"
       FROM dispute_notes
       WHERE dispute_id = $1
       ORDER BY created_at ASC`,
      [disputeId]
    );

    return { ...disputeResult.rows[0], notes: notesResult.rows };
  }

  /** Find active (open/investigating) dispute for a transaction. */
  async findActiveByTransactionId(transactionId: string): Promise<Dispute | null> {
    const result = await pool.query<Dispute>(
      `SELECT
         id,
         transaction_id  AS "transactionId",
         reason,
         status,
         assigned_to     AS "assignedTo",
         resolution,
         reported_by     AS "reportedBy",
         created_at      AS "createdAt",
         updated_at      AS "updatedAt"
       FROM disputes
       WHERE transaction_id = $1
         AND status IN ('open', 'investigating')
       LIMIT 1`,
      [transactionId]
    );
    return result.rows[0] ?? null;
  }

  /** Update dispute status, resolution text, and/or assignee. */
  async update(disputeId: string, input: UpdateDisputeInput): Promise<Dispute> {
    const result = await pool.query<Dispute>(
      `UPDATE disputes
       SET
         status      = $2,
         resolution  = COALESCE($3, resolution),
         assigned_to = COALESCE($4, assigned_to)
       WHERE id = $1
       RETURNING
         id,
         transaction_id  AS "transactionId",
         reason,
         status,
         assigned_to     AS "assignedTo",
         resolution,
         reported_by     AS "reportedBy",
         created_at      AS "createdAt",
         updated_at      AS "updatedAt"`,
      [disputeId, input.status, input.resolution ?? null, input.assignedTo ?? null]
    );
    return result.rows[0];
  }

  /** Assign a dispute to a support agent. */
  async assign(disputeId: string, agentName: string): Promise<Dispute> {
    const result = await pool.query<Dispute>(
      `UPDATE disputes
       SET assigned_to = $2
       WHERE id = $1
       RETURNING
         id,
         transaction_id  AS "transactionId",
         reason,
         status,
         assigned_to     AS "assignedTo",
         resolution,
         reported_by     AS "reportedBy",
         created_at      AS "createdAt",
         updated_at      AS "updatedAt"`,
      [disputeId, agentName]
    );
    return result.rows[0];
  }

  /** Add a note/comment to a dispute. */
  async addNote(disputeId: string, author: string, note: string): Promise<DisputeNote> {
    const result = await pool.query<DisputeNote>(
      `INSERT INTO dispute_notes (dispute_id, author, note)
       VALUES ($1, $2, $3)
       RETURNING
         id,
         dispute_id  AS "disputeId",
         author,
         note,
         created_at  AS "createdAt"`,
      [disputeId, author, note]
    );
    return result.rows[0];
  }

  /** Aggregate report: counts and average resolution time, grouped by status. */
  async generateReport(filter: ReportFilter = {}): Promise<DisputeReportRow[]> {
    const conditions: string[] = [];
    const params: (Date | string)[] = [];
    let paramIdx = 1;

    if (filter.from) {
      conditions.push(`created_at >= $${paramIdx++}`);
      params.push(filter.from);
    }
    if (filter.to) {
      conditions.push(`created_at <= $${paramIdx++}`);
      params.push(filter.to);
    }
    if (filter.assignedTo) {
      conditions.push(`assigned_to = $${paramIdx++}`);
      params.push(filter.assignedTo);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query<DisputeReportRow>(
      `SELECT
         status,
         COUNT(*)::text                                              AS count,
         ROUND(
           AVG(
             CASE WHEN status IN ('resolved','rejected')
               THEN EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600
             END
           )::NUMERIC, 2
         )::text                                                     AS "avgResolutionHours"
       FROM disputes
       ${where}
       GROUP BY status
       ORDER BY status`,
      params
    );

    return result.rows;
  }
}

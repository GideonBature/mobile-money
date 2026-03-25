/**
 * DisputeService — Transaction Dispute Workflow
 *
 * Manages the full lifecycle of a transaction dispute:
 *
 *  Status transitions (allowed paths):
 *
 *    open ──→ investigating ──→ resolved
 *      │              │
 *      └──────────────┴──→ rejected
 *
 *  "resolved" and "rejected" are terminal states — no further transitions.
 *
 * Responsibilities:
 *   - Open disputes against completed or failed transactions
 *   - Enforce valid status transitions
 *   - Add timestamped notes / comments
 *   - Assign disputes to support agents
 *   - Send (logged) notifications on every status change
 *   - Generate aggregate reports filtered by date range or assignee
 */

import {
  DisputeModel,
  Dispute,
  DisputeNote,
  DisputeWithNotes,
  DisputeReportRow,
  DisputeStatus,
  ReportFilter,
} from "../models/dispute";
import { TransactionModel, TransactionStatus } from "../models/transaction";

// ---------------------------------------------------------------------------
// Allowed status transitions
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  open: ["investigating", "resolved", "rejected"],
  investigating: ["resolved", "rejected"],
  resolved: [],
  rejected: [],
};

const TERMINAL_STATUSES: DisputeStatus[] = ["resolved", "rejected"];

// ---------------------------------------------------------------------------
// Notification helper
// Replace the body of `sendNotification` with your email / SMS / webhook
// integration (e.g. SendGrid, Twilio, internal event bus) without changing
// any callers.
// ---------------------------------------------------------------------------

interface NotificationPayload {
  event: string;
  disputeId: string;
  transactionId: string;
  status: DisputeStatus;
  message: string;
  metadata?: Record<string, unknown>;
}

function sendNotification(payload: NotificationPayload): void {
  // TODO: replace with real delivery (email, SMS, webhook, etc.)
  console.log("[DisputeNotification]", JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DisputeService {
  private disputeModel = new DisputeModel();
  private transactionModel = new TransactionModel();

  /**
   * Open a new dispute for a transaction.
   *
   * Rules:
   * - Transaction must exist.
   * - No other active (open / investigating) dispute may exist for the same transaction.
   *
   * @param transactionId  UUID of the target transaction.
   * @param reason         Human-readable description of the issue.
   * @param reportedBy     Identifier of the person raising the dispute (optional).
   */
  async openDispute(
    transactionId: string,
    reason: string,
    reportedBy?: string,
  ): Promise<Dispute> {
    const transaction = await this.transactionModel.findById(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    if (
      transaction.status !== TransactionStatus.Completed &&
      transaction.status !== TransactionStatus.Failed
    ) {
      throw new Error(
        `Disputes are only allowed for completed or failed transactions (current status: ${transaction.status})`,
      );
    }

    const existing =
      await this.disputeModel.findActiveByTransactionId(transactionId);
    if (existing) {
      throw new Error(
        `An active dispute (${existing.id}) already exists for transaction ${transactionId}`,
      );
    }

    const dispute = await this.disputeModel.create({
      transactionId,
      reason,
      reportedBy,
    });

    sendNotification({
      event: "dispute.opened",
      disputeId: dispute.id,
      transactionId: dispute.transactionId,
      status: dispute.status,
      message: `Dispute opened for transaction ${transactionId}`,
      metadata: { reason, reportedBy },
    });

    return dispute;
  }

  /**
   * Retrieve a dispute by ID, including all notes.
   */
  async getDispute(disputeId: string): Promise<DisputeWithNotes> {
    const dispute = await this.disputeModel.findByIdWithNotes(disputeId);
    if (!dispute) {
      throw new Error(`Dispute ${disputeId} not found`);
    }
    return dispute;
  }

  /**
   * Transition a dispute to a new status.
   *
   * @param disputeId   UUID of the dispute.
   * @param newStatus   Target status.
   * @param resolution  Required text when resolving or rejecting.
   * @param assignedTo  Optionally (re-)assign to an agent during the transition.
   */
  async updateStatus(
    disputeId: string,
    newStatus: DisputeStatus,
    resolution?: string,
    assignedTo?: string,
  ): Promise<Dispute> {
    const dispute = await this.disputeModel.findById(disputeId);
    if (!dispute) {
      throw new Error(`Dispute ${disputeId} not found`);
    }

    const allowed = TRANSITIONS[dispute.status];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Cannot transition dispute from "${dispute.status}" to "${newStatus}". ` +
          (allowed.length
            ? `Allowed transitions: ${allowed.join(", ")}`
            : `"${dispute.status}" is a terminal state.`),
      );
    }

    if (TERMINAL_STATUSES.includes(newStatus) && !resolution) {
      throw new Error(
        `A resolution text is required when setting status to "${newStatus}"`,
      );
    }

    const updated = await this.disputeModel.update(disputeId, {
      status: newStatus,
      resolution,
      assignedTo,
    });

    sendNotification({
      event: `dispute.${newStatus}`,
      disputeId: updated.id,
      transactionId: updated.transactionId,
      status: updated.status,
      message: `Dispute ${disputeId} status changed to "${newStatus}"`,
      metadata: { previousStatus: dispute.status, resolution, assignedTo },
    });

    return updated;
  }

  /**
   * Assign a dispute to a support team member.
   * Automatically moves the dispute from "open" to "investigating" if it is
   * still in the initial state.
   *
   * @param disputeId  UUID of the dispute.
   * @param agentName  Name or identifier of the support agent.
   */
  async assignToAgent(disputeId: string, agentName: string): Promise<Dispute> {
    const dispute = await this.disputeModel.findById(disputeId);
    if (!dispute) {
      throw new Error(`Dispute ${disputeId} not found`);
    }

    if (TERMINAL_STATUSES.includes(dispute.status)) {
      throw new Error(`Cannot assign a ${dispute.status} dispute`);
    }

    let updated = await this.disputeModel.assign(disputeId, agentName);

    // Auto-advance open → investigating on first assignment
    if (updated.status === "open") {
      updated = await this.disputeModel.update(disputeId, {
        status: "investigating",
        assignedTo: agentName,
      });
    }

    sendNotification({
      event: "dispute.assigned",
      disputeId: updated.id,
      transactionId: updated.transactionId,
      status: updated.status,
      message: `Dispute ${disputeId} assigned to ${agentName}`,
      metadata: { agentName },
    });

    return updated;
  }

  /**
   * Add a note or comment to a dispute.
   *
   * @param disputeId  UUID of the dispute.
   * @param author     Name or identifier of the note author.
   * @param note       Note text.
   */
  async addNote(
    disputeId: string,
    author: string,
    note: string,
  ): Promise<DisputeNote> {
    const dispute = await this.disputeModel.findById(disputeId);
    if (!dispute) {
      throw new Error(`Dispute ${disputeId} not found`);
    }

    return this.disputeModel.addNote(disputeId, author, note);
  }

  /**
   * Generate an aggregate report of disputes.
   *
   * Returns counts grouped by status and average resolution time (in hours)
   * for terminal states (resolved / rejected).
   *
   * @param filter  Optional date range and/or assignee filter.
   */
  async generateReport(filter: ReportFilter = {}): Promise<{
    generatedAt: string;
    filter: ReportFilter;
    summary: DisputeReportRow[];
    totals: {
      total: number;
      open: number;
      investigating: number;
      resolved: number;
      rejected: number;
    };
  }> {
    const rows = await this.disputeModel.generateReport(filter);

    const totals = {
      total: 0,
      open: 0,
      investigating: 0,
      resolved: 0,
      rejected: 0,
    };
    for (const row of rows) {
      const count = parseInt(row.count, 10);
      totals.total += count;
      if (row.status in totals) {
        totals[row.status as keyof typeof totals] += count;
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      filter,
      summary: rows,
      totals,
    };
  }
}

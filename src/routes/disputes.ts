/**
 * Dispute Routes
 *
 * Endpoints:
 *
 *   POST   /api/transactions/:id/dispute
 *     Open a dispute for a transaction.
 *     Body: { reason: string, reportedBy?: string }
 *
 *   GET    /api/disputes/:disputeId
 *     Fetch dispute details including all notes.
 *
 *   PATCH  /api/disputes/:disputeId/status
 *     Transition dispute status.
 *     Body: { status: 'open'|'investigating'|'resolved'|'rejected', resolution?: string, assignedTo?: string }
 *
 *   POST   /api/disputes/:disputeId/assign
 *     Assign dispute to a support agent (auto-advances open → investigating).
 *     Body: { agentName: string }
 *
 *   POST   /api/disputes/:disputeId/notes
 *     Add a note/comment to a dispute.
 *     Body: { author: string, note: string }
 *
 *   GET    /api/disputes/report
 *     Aggregate dispute report.
 *     Query: from?, to?, assignedTo?
 */

import { Router, Request, Response } from 'express';
import { DisputeService } from '../services/dispute';
import { DisputeStatus } from '../models/dispute';

const VALID_STATUSES: DisputeStatus[] = ['open', 'investigating', 'resolved', 'rejected'];

const disputeService = new DisputeService();

// ---------------------------------------------------------------------------
// Transaction-scoped router  (mounted at /api/transactions)
// ---------------------------------------------------------------------------

export const transactionDisputeRoutes = Router({ mergeParams: true });

/**
 * POST /api/transactions/:id/dispute
 */
transactionDisputeRoutes.post('/:id/dispute', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason, reportedBy } = req.body;

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return res.status(400).json({ error: 'Field "reason" is required and must be a non-empty string' });
  }

  try {
    const dispute = await disputeService.openDispute(id, reason.trim(), reportedBy);
    return res.status(201).json(dispute);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open dispute';
    const status = message.includes('not found') ? 404
      : message.includes('already exists') ? 409
      : 500;
    return res.status(status).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Dispute management router  (mounted at /api/disputes)
// ---------------------------------------------------------------------------

export const disputeRoutes = Router();

/**
 * GET /api/disputes/report
 * Must be defined before /:disputeId so "report" is not treated as an ID.
 */
disputeRoutes.get('/report', async (req: Request, res: Response) => {
  const { from, to, assignedTo } = req.query;

  const filter: { from?: Date; to?: Date; assignedTo?: string } = {};

  if (from) {
    const d = new Date(from as string);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid "from" date' });
    filter.from = d;
  }
  if (to) {
    const d = new Date(to as string);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid "to" date' });
    filter.to = d;
  }
  if (assignedTo) filter.assignedTo = assignedTo as string;

  try {
    const report = await disputeService.generateReport(filter);
    return res.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate report';
    return res.status(500).json({ error: message });
  }
});

/**
 * GET /api/disputes/:disputeId
 */
disputeRoutes.get('/:disputeId', async (req: Request, res: Response) => {
  try {
    const dispute = await disputeService.getDispute(req.params.disputeId);
    return res.json(dispute);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch dispute';
    return res.status(message.includes('not found') ? 404 : 500).json({ error: message });
  }
});

/**
 * PATCH /api/disputes/:disputeId/status
 */
disputeRoutes.patch('/:disputeId/status', async (req: Request, res: Response) => {
  const { status, resolution, assignedTo } = req.body;

  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `Field "status" must be one of: ${VALID_STATUSES.join(', ')}`,
    });
  }

  try {
    const updated = await disputeService.updateStatus(
      req.params.disputeId,
      status as DisputeStatus,
      resolution,
      assignedTo
    );
    return res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update dispute status';
    const code = message.includes('not found') ? 404
      : message.includes('Cannot transition') || message.includes('resolution text') ? 422
      : 500;
    return res.status(code).json({ error: message });
  }
});

/**
 * POST /api/disputes/:disputeId/assign
 */
disputeRoutes.post('/:disputeId/assign', async (req: Request, res: Response) => {
  const { agentName } = req.body;

  if (!agentName || typeof agentName !== 'string' || agentName.trim().length === 0) {
    return res.status(400).json({ error: 'Field "agentName" is required' });
  }

  try {
    const updated = await disputeService.assignToAgent(req.params.disputeId, agentName.trim());
    return res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to assign dispute';
    const code = message.includes('not found') ? 404
      : message.includes('Cannot assign') ? 422
      : 500;
    return res.status(code).json({ error: message });
  }
});

/**
 * POST /api/disputes/:disputeId/notes
 */
disputeRoutes.post('/:disputeId/notes', async (req: Request, res: Response) => {
  const { author, note } = req.body;

  if (!author || typeof author !== 'string' || author.trim().length === 0) {
    return res.status(400).json({ error: 'Field "author" is required' });
  }
  if (!note || typeof note !== 'string' || note.trim().length === 0) {
    return res.status(400).json({ error: 'Field "note" is required' });
  }

  try {
    const created = await disputeService.addNote(
      req.params.disputeId,
      author.trim(),
      note.trim()
    );
    return res.status(201).json(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add note';
    return res.status(message.includes('not found') ? 404 : 500).json({ error: message });
  }
});

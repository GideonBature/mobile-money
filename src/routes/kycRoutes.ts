import { Router } from 'express';
import KYCController from '../controllers/kycController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Initialize KYC controller (will be injected with database connection)
let kycController: KYCController;

// Middleware to inject database connection
router.use((req, res, next) => {
  if (!kycController) {
    kycController = new KYCController(req.app.locals.db);
  }
  next();
});

// KYC Routes
/**
 * @route POST /api/kyc/applicants
 * @desc Create a new KYC applicant
 * @access Private
 */
router.post('/applicants', authenticateToken, (req, res) => kycController.createApplicant(req, res));

/**
 * @route GET /api/kyc/applicants/:applicantId
 * @desc Get applicant details
 * @access Private
 */
router.get('/applicants/:applicantId', authenticateToken, (req, res) => kycController.getApplicant(req, res));

/**
 * @route GET /api/kyc/applicants/:applicantId/status
 * @desc Get verification status for an applicant
 * @access Private
 */
router.get('/applicants/:applicantId/status', authenticateToken, (req, res) => kycController.getVerificationStatus(req, res));

/**
 * @route POST /api/kyc/documents
 * @desc Upload document for verification
 * @access Private
 */
router.post('/documents', authenticateToken, (req, res) => kycController.uploadDocument(req, res));

/**
 * @route POST /api/kyc/workflow-runs
 * @desc Create workflow run for comprehensive verification
 * @access Private
 */
router.post('/workflow-runs', authenticateToken, (req, res) => kycController.createWorkflowRun(req, res));

/**
 * @route POST /api/kyc/sdk-token
 * @desc Generate SDK token for client-side integration
 * @access Private
 */
router.post('/sdk-token', authenticateToken, (req, res) => kycController.generateSDKToken(req, res));

/**
 * @route GET /api/kyc/status
 * @desc Get user's KYC status and transaction limits
 * @access Private
 */
router.get('/status', authenticateToken, (req, res) => kycController.getUserKYCStatus(req, res));

/**
 * @route POST /api/kyc/webhooks
 * @desc Handle webhook events from KYC provider
 * @access Public (but secured with webhook signature)
 */
router.post('/webhooks', (req, res) => kycController.handleWebhook(req, res));

export default router;

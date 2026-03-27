import { Router } from "express";
import { Pool } from "pg";
import { KYCController } from "../controllers/kycController";
import { authenticateToken } from "../middleware/auth";
import { upload, uploadErrorMessages } from "../middleware/upload";
import { uploadToS3 } from "../services/s3Upload";
import { Request, Response } from "express";

function validateUploadFile(file: Express.Multer.File): {
  valid: boolean;
  error?: string;
} {
  const allowedMimeTypes = [
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
  ];
  const allowedExtensions = [".pdf", ".jpeg", ".jpg", ".png"];
  const maxSize = 5 * 1024 * 1024;
  const filename = String(file.originalname || "").toLowerCase();

  const hasAllowedMimeType = allowedMimeTypes.includes(file.mimetype);
  const hasAllowedExtension = allowedExtensions.some((ext) =>
    filename.endsWith(ext),
  );

  if (!hasAllowedMimeType && !hasAllowedExtension) {
    return {
      valid: false,
      error: uploadErrorMessages.INVALID_FILE_TYPE,
    };
  }

  if (file.size > maxSize) {
    return {
      valid: false,
      error: uploadErrorMessages.FILE_TOO_LARGE,
    };
  }

  return { valid: true };
}

export const createKYCRoutes = (db: Pool): Router => {
  const router = Router();
  const kycController = new KYCController(db);

  // All KYC routes require authentication
  router.use(authenticateToken);

  // Applicant management
  router.post("/applicants", kycController.createApplicant);
  router.get("/applicants/:applicantId", kycController.getApplicant);
  router.get(
    "/applicants/:applicantId/status",
    kycController.getVerificationStatus,
  );

  // Document upload (legacy - base64)
  router.post("/documents", kycController.uploadDocument);

  // File upload to S3
  router.post(
    "/documents/upload",
    upload.single("document"),
    async (req: Request, res: Response) => {
      try {
        const userId = req.jwtUser?.userId;
        if (!userId) {
          return res.status(401).json({ error: "User not authenticated" });
        }

        // Get required metadata from request body first
        const { applicant_id, document_type, document_side } = req.body;

        if (!applicant_id) {
          return res.status(400).json({
            error: "applicant_id is required",
          });
        }

        // Check if file was uploaded
        if (!req.file) {
          return res.status(400).json({
            error: uploadErrorMessages.NO_FILE_UPLOADED,
          });
        }

        // Validate file
        const validation = validateUploadFile(req.file);
        if (!validation.valid) {
          return res.status(400).json({
            error: validation.error,
          });
        }

        // Verify user owns this applicant
        const accessQuery = `
        SELECT 1 FROM kyc_applicants 
        WHERE user_id = $1 AND applicant_id = $2
        LIMIT 1
      `;
        const accessResult = await db.query(accessQuery, [
          userId,
          applicant_id,
        ]);

        if (accessResult.rows.length === 0) {
          return res.status(403).json({ error: "Access denied" });
        }

        // Upload to S3
        const uploadResult = await uploadToS3({
          userId,
          file: req.file,
          metadata: {
            applicantId: applicant_id,
            documentType: document_type || "unknown",
            documentSide: document_side || "front",
          },
        });

        if (!uploadResult.success) {
          return res.status(500).json({
            error: uploadErrorMessages.UPLOAD_FAILED,
            details: uploadResult.error,
          });
        }

        // Store document reference in database
        const insertQuery = `
        INSERT INTO kyc_documents (
          user_id, 
          applicant_id, 
          document_type, 
          document_side, 
          file_url, 
          s3_key, 
          original_filename,
          file_size,
          mime_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, file_url, created_at
      `;

        const documentResult = await db.query(insertQuery, [
          userId,
          applicant_id,
          document_type || "unknown",
          document_side || "front",
          uploadResult.fileUrl,
          uploadResult.key,
          req.file.originalname,
          req.file.size,
          req.file.mimetype,
        ]);

        res.status(201).json({
          success: true,
          data: {
            document_id: documentResult.rows[0].id,
            file_url: documentResult.rows[0].file_url,
            applicant_id,
            uploaded_at: documentResult.rows[0].created_at,
          },
        });
      } catch (error) {
        console.error("Document upload error:", error);

        // Handle multer errors
        if (error instanceof Error) {
          if (error.message.includes("File too large")) {
            return res.status(400).json({
              error: uploadErrorMessages.FILE_TOO_LARGE,
            });
          }
          if (error.message.includes("Invalid file type")) {
            return res.status(400).json({
              error: uploadErrorMessages.INVALID_FILE_TYPE,
            });
          }
        }

        res.status(500).json({
          error: "Failed to upload document",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  // Get user's uploaded documents
  router.get("/documents", async (req: Request, res: Response) => {
    try {
      const userId = req.jwtUser?.userId;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const query = `
        SELECT 
          id,
          applicant_id,
          document_type,
          document_side,
          file_url,
          original_filename,
          file_size,
          mime_type,
          created_at
        FROM kyc_documents
        WHERE user_id = $1
        ORDER BY created_at DESC
      `;

      const result = await db.query(query, [userId]);

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      console.error("Get documents error:", error);
      res.status(500).json({
        error: "Failed to retrieve documents",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Workflow management
  router.post("/workflow-runs", kycController.createWorkflowRun);

  // SDK token generation
  router.post("/sdk-token", kycController.generateSDKToken);

  // User KYC status
  router.get("/status", kycController.getUserKYCStatus);

  // Webhook endpoint (no auth required - verified by signature)
  router.post("/webhooks", kycController.handleWebhook);

  return router;
};

export default createKYCRoutes;

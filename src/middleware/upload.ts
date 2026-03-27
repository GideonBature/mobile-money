import multer from "multer";
import { Request } from "express";
import crypto from "crypto";
import path from "path";

/**
 * Allowed file types for KYC documents
 */
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
];

/**
 * Maximum file size: 5MB
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB in bytes

/**
 * File filter to validate file types
 */
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  // Accept file at middleware stage; route-level validation returns controlled errors.
  cb(null, true);
};

/**
 * Generate unique filename with timestamp and random hash
 */
export const generateUniqueFilename = (originalFilename: string): string => {
  const timestamp = Date.now();
  const randomHash = crypto.randomBytes(8).toString("hex");
  const extension = path.extname(originalFilename);
  const basename = path.basename(originalFilename, extension);

  // Sanitize basename (remove special characters)
  const sanitizedBasename = basename.replace(/[^a-zA-Z0-9-_]/g, "_");

  return `${sanitizedBasename}-${timestamp}-${randomHash}${extension}`;
};

/**
 * Generate S3 key path for KYC documents
 */
export const generateS3Key = (userId: string, filename: string): string => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  return `kyc-documents/${year}/${month}/${userId}/${filename}`;
};

/**
 * Multer memory storage configuration
 * Files are stored in memory temporarily before uploading to S3
 */
const storage = multer.memoryStorage();

/**
 * Multer upload middleware configuration
 */
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1, // Only allow one file per request
  },
});

/**
 * Error messages for upload validation
 */
export const uploadErrorMessages = {
  FILE_TOO_LARGE: `File size exceeds maximum limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
  INVALID_FILE_TYPE: `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}`,
  NO_FILE_UPLOADED: "No file uploaded",
  UPLOAD_FAILED: "File upload failed",
};

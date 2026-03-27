import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client, s3Config, getS3ObjectUrl } from "../config/s3";
import { generateUniqueFilename, generateS3Key } from "../middleware/upload";

export interface UploadResult {
  success: boolean;
  fileUrl?: string;
  key?: string;
  error?: string;
}

export interface UploadOptions {
  userId: string;
  file: Express.Multer.File;
  metadata?: Record<string, string>;
}

/**
 * Upload file to S3 bucket
 */
export const uploadToS3 = async (
  options: UploadOptions,
): Promise<UploadResult> => {
  try {
    const { userId, file, metadata = {} } = options;

    // Generate unique filename and S3 key
    const uniqueFilename = generateUniqueFilename(file.originalname);
    const key = generateS3Key(userId, uniqueFilename);

    const s3Client = getS3Client();

    // Prepare upload command
    const command = new PutObjectCommand({
      Bucket: s3Config.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: {
        originalName: file.originalname,
        uploadedBy: userId,
        uploadedAt: new Date().toISOString(),
        ...metadata,
      },
      // Set appropriate ACL (private by default)
      // ACL: 'private',
    });

    // Upload to S3
    await s3Client.send(command);

    // Generate public URL
    const fileUrl = getS3ObjectUrl(key);

    return {
      success: true,
      fileUrl,
      key,
    };
  } catch {
    console.error("S3 upload error");
    return {
      success: false,
      error: "Unknown upload error",
    };
  }
};

/**
 * Check if file exists in S3
 */
export const fileExistsInS3 = async (key: string): Promise<boolean> => {
  try {
    const s3Client = getS3Client();
    const command = new HeadObjectCommand({
      Bucket: s3Config.bucket,
      Key: key,
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Validate file before upload
 */
export const validateFile = (
  file: Express.Multer.File,
): { valid: boolean; error?: string } => {
  const allowedMimeTypes = [
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
  ];
  const allowedExtensions = [".pdf", ".jpeg", ".jpg", ".png"];
  const maxSize = 5 * 1024 * 1024; // 5MB

  const originalName = String(file.originalname || "").toLowerCase();
  const hasAllowedExtension = allowedExtensions.some((ext) =>
    originalName.endsWith(ext),
  );
  const hasAllowedMimeType = allowedMimeTypes.includes(file.mimetype);

  if (!hasAllowedMimeType && !hasAllowedExtension) {
    return {
      valid: false,
      error: `Invalid file type. Allowed types: ${allowedMimeTypes.join(", ")}`,
    };
  }

  if (file.size > maxSize) {
    return {
      valid: false,
      error: `File size exceeds maximum limit of ${maxSize / (1024 * 1024)}MB`,
    };
  }

  return { valid: true };
};

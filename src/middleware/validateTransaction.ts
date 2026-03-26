import { Request, Response, NextFunction } from "express";
import { z } from "zod";

const transactionSchema = z.object({
  amount: z.number().positive({ message: "Amount must be a positive number" }),
  phoneNumber: z
    .string()
    .regex(/^\+?\d{10,15}$/, { message: "Invalid phone number format" }),
  provider: z.enum(["mtn", "airtel", "orange"], {
    message: "Provider must be one of: mtn, airtel, orange",
  }),
  stellarAddress: z
    .string()
    .regex(/^G[A-Z2-7]{55}$/, { message: "Invalid Stellar address format" }),
  userId: z.string().nonempty({ message: "userId is required" }),
});

export const validateTransaction = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    transactionSchema.parse(req.body);
    next();
  } catch (err: unknown) {
    // Check if the error is actually a Zod validation error
    if (err instanceof z.ZodError) {
      console.log("Validation error:", err.issues);

      return res.status(400).json({
        error: "Validation failed",
        details: err.issues,
      });
    }

    // Fallback for non-Zod errors
    console.error("Unexpected validation error:", err);
    return res.status(500).json({
      error: "An internal server error occurred during validation",
    });
  }
};

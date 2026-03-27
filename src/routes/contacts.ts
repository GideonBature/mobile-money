import { Router, Request, Response } from "express";
import { z } from "zod";
import { ContactModel } from "../models/contact";
import { authenticateToken } from "../middleware/auth";
import { TimeoutPresets, haltOnTimedout } from "../middleware/timeout";

const PHONE_REGEX = /^\+\d{7,15}$/;
const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

const createContactSchema = z
  .object({
    destinationType: z.enum(["phone", "stellar"]),
    destinationValue: z.string().trim().min(1),
    nickname: z.string().trim().min(1).max(100),
  })
  .superRefine((value, ctx) => {
    if (
      value.destinationType === "phone" &&
      !PHONE_REGEX.test(value.destinationValue)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destinationValue"],
        message: "Must be a valid E.164 phone number (e.g. +237670000000)",
      });
    }

    if (
      value.destinationType === "stellar" &&
      !STELLAR_ADDRESS_REGEX.test(value.destinationValue)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destinationValue"],
        message:
          "Must be a valid Stellar public key (56 characters, starting with G)",
      });
    }
  });

const updateContactSchema = z
  .object({
    destinationType: z.enum(["phone", "stellar"]).optional(),
    destinationValue: z.string().trim().min(1).optional(),
    nickname: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.destinationType !== undefined &&
      value.destinationValue !== undefined
    ) {
      if (
        value.destinationType === "phone" &&
        !PHONE_REGEX.test(value.destinationValue)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["destinationValue"],
          message: "Must be a valid E.164 phone number (e.g. +237670000000)",
        });
      }

      if (
        value.destinationType === "stellar" &&
        !STELLAR_ADDRESS_REGEX.test(value.destinationValue)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["destinationValue"],
          message:
            "Must be a valid Stellar public key (56 characters, starting with G)",
        });
      }
    }

    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "At least one field must be provided",
      });
    }
  });

function getUserId(req: Request): string | null {
  return req.jwtUser?.userId ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  return "code" in error && error.code === "23505";
}

const contactModel = new ContactModel();
export const contactsRoutes = Router();

contactsRoutes.use(authenticateToken);

contactsRoutes.post(
  "/",
  TimeoutPresets.quick,
  haltOnTimedout,
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const parsed = createContactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation error",
        details: parsed.error.issues,
      });
    }

    try {
      const contact = await contactModel.create({
        userId,
        destinationType: parsed.data.destinationType,
        destinationValue: parsed.data.destinationValue,
        nickname: parsed.data.nickname,
      });

      return res.status(201).json(contact);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({
          error: "Contact already exists for this destination",
        });
      }

      console.error("Create contact error:", error);
      return res.status(500).json({ error: "Failed to create contact" });
    }
  },
);

contactsRoutes.get(
  "/",
  TimeoutPresets.quick,
  haltOnTimedout,
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    try {
      const contacts = await contactModel.listByUser(userId);
      return res.json(contacts);
    } catch (error) {
      console.error("List contacts error:", error);
      return res.status(500).json({ error: "Failed to fetch contacts" });
    }
  },
);

contactsRoutes.get(
  "/:id",
  TimeoutPresets.quick,
  haltOnTimedout,
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    try {
      const contact = await contactModel.findByIdForUser(req.params.id, userId);
      if (!contact) {
        return res.status(404).json({ error: "Contact not found" });
      }

      return res.json(contact);
    } catch (error) {
      console.error("Get contact error:", error);
      return res.status(500).json({ error: "Failed to fetch contact" });
    }
  },
);

contactsRoutes.patch(
  "/:id",
  TimeoutPresets.quick,
  haltOnTimedout,
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const parsed = updateContactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation error",
        details: parsed.error.issues,
      });
    }

    try {
      const existing = await contactModel.findByIdForUser(
        req.params.id,
        userId,
      );
      if (!existing) {
        return res.status(404).json({ error: "Contact not found" });
      }

      const nextDestinationType =
        parsed.data.destinationType ?? existing.destinationType;
      const nextDestinationValue =
        parsed.data.destinationValue ?? existing.destinationValue;

      if (
        nextDestinationType === "phone" &&
        !PHONE_REGEX.test(nextDestinationValue)
      ) {
        return res.status(400).json({
          error: "Validation error",
          details: [
            {
              path: ["destinationValue"],
              message:
                "Must be a valid E.164 phone number (e.g. +237670000000)",
            },
          ],
        });
      }

      if (
        nextDestinationType === "stellar" &&
        !STELLAR_ADDRESS_REGEX.test(nextDestinationValue)
      ) {
        return res.status(400).json({
          error: "Validation error",
          details: [
            {
              path: ["destinationValue"],
              message:
                "Must be a valid Stellar public key (56 characters, starting with G)",
            },
          ],
        });
      }

      const updated = await contactModel.updateByIdForUser(
        req.params.id,
        userId,
        {
          destinationType: parsed.data.destinationType,
          destinationValue: parsed.data.destinationValue,
          nickname: parsed.data.nickname,
        },
      );

      if (!updated) {
        return res.status(404).json({ error: "Contact not found" });
      }

      return res.json(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({
          error: "Contact already exists for this destination",
        });
      }

      console.error("Update contact error:", error);
      return res.status(500).json({ error: "Failed to update contact" });
    }
  },
);

contactsRoutes.delete(
  "/:id",
  TimeoutPresets.quick,
  haltOnTimedout,
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    try {
      const deleted = await contactModel.deleteByIdForUser(
        req.params.id,
        userId,
      );
      if (!deleted) {
        return res.status(404).json({ error: "Contact not found" });
      }

      return res.status(204).send();
    } catch (error) {
      console.error("Delete contact error:", error);
      return res.status(500).json({ error: "Failed to delete contact" });
    }
  },
);

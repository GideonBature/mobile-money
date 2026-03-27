import express from "express";
import request from "supertest";

const mockCreate = jest.fn();
const mockListByUser = jest.fn();
const mockFindByIdForUser = jest.fn();
const mockUpdateByIdForUser = jest.fn();
const mockDeleteByIdForUser = jest.fn();

jest.mock("../src/models/contact", () => ({
  ContactModel: jest.fn().mockImplementation(() => ({
    create: mockCreate,
    listByUser: mockListByUser,
    findByIdForUser: mockFindByIdForUser,
    updateByIdForUser: mockUpdateByIdForUser,
    deleteByIdForUser: mockDeleteByIdForUser,
  })),
}));

jest.mock("../src/middleware/auth", () => ({
  authenticateToken: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.jwtUser = {
      userId: (req.headers["x-user-id"] as string) || "user-1",
      email: "test@example.com",
    };
    next();
  },
}));

import { contactsRoutes } from "../src/routes/contacts";

describe("Contacts Routes", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/contacts", contactsRoutes);

  beforeEach(() => {
    mockCreate.mockReset();
    mockListByUser.mockReset();
    mockFindByIdForUser.mockReset();
    mockUpdateByIdForUser.mockReset();
    mockDeleteByIdForUser.mockReset();
  });

  it("creates a contact for authenticated user", async () => {
    mockCreate.mockResolvedValue({
      id: "contact-1",
      userId: "user-1",
      destinationType: "phone",
      destinationValue: "+237670000000",
      nickname: "Mom",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app).post("/api/contacts").send({
      destinationType: "phone",
      destinationValue: "+237670000000",
      nickname: "Mom",
    });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith({
      userId: "user-1",
      destinationType: "phone",
      destinationValue: "+237670000000",
      nickname: "Mom",
    });
  });

  it("validates destination format on create", async () => {
    const res = await request(app).post("/api/contacts").send({
      destinationType: "phone",
      destinationValue: "670000000",
      nickname: "Bad",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("lists contacts scoped to user", async () => {
    mockListByUser.mockResolvedValue([]);

    const res = await request(app)
      .get("/api/contacts")
      .set("x-user-id", "user-2");

    expect(res.status).toBe(200);
    expect(mockListByUser).toHaveBeenCalledWith("user-2");
  });

  it("returns 404 when updating another user's contact", async () => {
    mockFindByIdForUser.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/contacts/contact-1")
      .set("x-user-id", "user-2")
      .send({ nickname: "Updated" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Contact not found");
    expect(mockFindByIdForUser).toHaveBeenCalledWith("contact-1", "user-2");
  });

  it("deletes own contact", async () => {
    mockDeleteByIdForUser.mockResolvedValue(true);

    const res = await request(app)
      .delete("/api/contacts/contact-1")
      .set("x-user-id", "user-1");

    expect(res.status).toBe(204);
    expect(mockDeleteByIdForUser).toHaveBeenCalledWith("contact-1", "user-1");
  });
});

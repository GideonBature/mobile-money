import express from "express";
import request from "supertest";

const mockSearchByPhoneNumber = jest.fn();

jest.mock("../src/services/stellar/stellarService", () => ({
  StellarService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("../src/services/mobilemoney/mobileMoneyService", () => ({
  MobileMoneyService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("../src/services/kyc/kycService", () => ({
  KYCService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("../src/services/transactionLimit/transactionLimitService", () => ({
  TransactionLimitService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("../src/models/transaction", () => {
  const actual = jest.requireActual("../src/models/transaction");
  return {
    ...actual,
    TransactionModel: jest.fn().mockImplementation(() => ({
      searchByPhoneNumber: (...args: unknown[]) =>
        mockSearchByPhoneNumber(...args),
    })),
  };
});

jest.mock("../src/middleware/timeout", () => ({
  TimeoutPresets: {
    quick: (_req: unknown, _res: unknown, next: () => void) => next(),
    long: (_req: unknown, _res: unknown, next: () => void) => next(),
  },
  haltOnTimedout: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { transactionRoutes } from "../src/routes/transactions";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/transactions", transactionRoutes);
  return app;
}

describe("Phone Number Search – GET /api/transactions/search", () => {
  beforeEach(() => {
    mockSearchByPhoneNumber.mockReset();
    mockSearchByPhoneNumber.mockResolvedValue({
      transactions: [{ id: "txn-1", phoneNumber: "+237612345678" }],
      total: 1,
    });
  });

  it("should return 400 when phoneNumber param is missing", async () => {
    const res = await request(createApp()).get("/api/transactions/search");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("phoneNumber");
  });

  it("should return 400 for invalid phone number (letters)", async () => {
    const res = await request(createApp()).get(
      "/api/transactions/search?phoneNumber=abc123",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid phone number format");
  });

  it("should return 400 for empty phone number", async () => {
    const res = await request(createApp()).get(
      "/api/transactions/search?phoneNumber=",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("phoneNumber");
  });

  it("should return 400 for phone number with special characters", async () => {
    const res = await request(createApp()).get(
      "/api/transactions/search?phoneNumber=123-456-7890",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid phone number format");
  });

  it("should return 200 with pagination for a valid full phone number", async () => {
    const res = await request(createApp()).get(
      "/api/transactions/search?phoneNumber=%2B237612345678",
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toMatchObject({
      page: 1,
      limit: 50,
      total: 1,
      totalPages: 1,
    });
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("should return 200 for partial phone number (last 4 digits)", async () => {
    const res = await request(createApp()).get(
      "/api/transactions/search?phoneNumber=5678",
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSearchByPhoneNumber).toHaveBeenCalledWith("5678", 50, 0);
  });

  it("should accept a phone number with leading +", async () => {
    const res = await request(createApp()).get(
      "/api/transactions/search?phoneNumber=%2B2376",
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("should mask phone numbers in the response (only last 4 digits visible)", async () => {
    const res = await request(createApp()).get(
      "/api/transactions/search?phoneNumber=1234",
    );
    expect(res.status).toBe(200);
    for (const tx of res.body.data) {
      expect(tx.phoneNumber).toMatch(/^\*{4}\d{4}$/);
    }
  });

  it("should respect page and limit query params", async () => {
    const res = await request(createApp()).get(
      "/api/transactions/search?phoneNumber=1234&page=2&limit=5",
    );
    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(2);
    expect(res.body.pagination.limit).toBe(5);
    expect(mockSearchByPhoneNumber).toHaveBeenCalledWith("1234", 5, 5);
  });

  it("should default to page 1 and limit 50", async () => {
    const res = await request(createApp()).get(
      "/api/transactions/search?phoneNumber=1234",
    );
    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(50);
  });

  it("should cap limit at 100", async () => {
    const res = await request(createApp()).get(
      "/api/transactions/search?phoneNumber=1234&limit=999",
    );
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(100);
    expect(mockSearchByPhoneNumber).toHaveBeenCalledWith("1234", 100, 0);
  });
});

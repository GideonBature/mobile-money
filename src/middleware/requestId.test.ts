import { Request, Response, NextFunction } from "express";
import { requestId } from "./requestId";

describe("requestId middleware", () => {
  let mockReq: Request & { id?: string };
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {},
    } as Request & { id?: string };
    mockRes = {
      setHeader: jest.fn(),
    };
    mockNext = jest.fn();
  });

  it("should generate a new UUID when no X-Request-ID header is provided", () => {
    requestId(mockReq, mockRes as Response, mockNext);

    expect(mockReq.id).toBeDefined();
    expect(mockReq.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(mockNext).toHaveBeenCalled();
  });

  it("should use existing X-Request-ID header when provided", () => {
    const customRequestId = "custom-request-id-123";
    mockReq.headers = { "x-request-id": customRequestId } as Record<
      string,
      string
    >;

    requestId(mockReq, mockRes as Response, mockNext);

    expect(mockReq.id).toBe(customRequestId);
    expect(mockNext).toHaveBeenCalled();
  });

  it("should set X-Request-ID header on response", () => {
    requestId(mockReq, mockRes as Response, mockNext);

    expect(mockRes.setHeader).toHaveBeenCalledWith("X-Request-ID", mockReq.id);
  });

  it("should accept client-provided ID from header", () => {
    const clientId = "client-provided-id";
    mockReq.headers = { "x-request-id": clientId } as Record<string, string>;

    requestId(mockReq, mockRes as Response, mockNext);

    expect(mockReq.id).toBe(clientId);
    expect(mockRes.setHeader).toHaveBeenCalledWith("X-Request-ID", clientId);
  });
});

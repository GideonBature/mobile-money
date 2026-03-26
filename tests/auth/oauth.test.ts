import express from "express";
import request from "supertest";
import {
  createOAuthRouter,
  createOAuthTokenStore,
  verifyOAuthAccessToken,
} from "../../src/auth/oauth";
import { requireAuth, AuthRequest } from "../../src/middleware/auth";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use("/oauth", createOAuthRouter(createOAuthTokenStore()));
  app.get("/protected", requireAuth, (req, res) => {
    const authReq = req as AuthRequest;
    res.json({
      id: authReq.user?.id,
      role: authReq.user?.role,
      clientId: authReq.user?.clientId,
      scopes: authReq.user?.scopes,
    });
  });
  return app;
}

describe("OAuth2 routes", () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = "test-admin-key";
    process.env.OAUTH_CLIENT_ID = "test-client";
    process.env.OAUTH_CLIENT_SECRET = "test-secret";
    process.env.OAUTH_REDIRECT_URI = "http://localhost:3000/oauth/callback";
    process.env.OAUTH_JWT_SECRET = "test-oauth-jwt-secret";
    process.env.OAUTH_ISSUER = "test-issuer";
    process.env.OAUTH_AUDIENCE = "test-audience";
    process.env.OAUTH_DEFAULT_SCOPE = "reports:read";
    process.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS = "3600";
    process.env.OAUTH_REFRESH_TOKEN_TTL_SECONDS = "2592000";
    process.env.OAUTH_AUTH_CODE_TTL_SECONDS = "300";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("redirects with an authorization code and state", async () => {
    const app = createTestApp();

    const response = await request(app)
      .get("/oauth/authorize")
      .set("X-API-Key", "test-admin-key")
      .query({
        response_type: "code",
        client_id: "test-client",
        redirect_uri: "http://localhost:3000/oauth/callback",
        subject: "user-123",
        scope: "reports:read stats:read",
        state: "abc123",
      });

    expect(response.status).toBe(302);

    const location = new URL(response.headers.location);
    expect(location.origin + location.pathname).toBe(
      "http://localhost:3000/oauth/callback",
    );
    expect(location.searchParams.get("state")).toBe("abc123");
    expect(location.searchParams.get("code")).toBeTruthy();
  });

  it("exchanges an authorization code for JWT access and refresh tokens", async () => {
    const app = createTestApp();

    const authorizeResponse = await request(app)
      .get("/oauth/authorize")
      .set("X-API-Key", "test-admin-key")
      .query({
        response_type: "code",
        client_id: "test-client",
        redirect_uri: "http://localhost:3000/oauth/callback",
        subject: "user-123",
        scope: "reports:read",
      });

    const code = new URL(authorizeResponse.headers.location).searchParams.get(
      "code",
    );

    const tokenResponse = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: "test-client",
        client_secret: "test-secret",
        redirect_uri: "http://localhost:3000/oauth/callback",
        code,
      });

    expect(tokenResponse.status).toBe(200);
    expect(tokenResponse.body.token_type).toBe("Bearer");
    expect(tokenResponse.body.expires_in).toBe(3600);
    expect(tokenResponse.body.refresh_token).toBeTruthy();

    const claims = verifyOAuthAccessToken(tokenResponse.body.access_token);
    expect(claims.sub).toBe("user-123");
    expect(claims.client_id).toBe("test-client");
    expect(claims.scope).toBe("reports:read");
    expect(claims.token_use).toBe("access");
  });

  it("rotates refresh tokens and rejects reused refresh tokens", async () => {
    const app = createTestApp();

    const authorizeResponse = await request(app)
      .get("/oauth/authorize")
      .set("X-API-Key", "test-admin-key")
      .query({
        response_type: "code",
        client_id: "test-client",
        redirect_uri: "http://localhost:3000/oauth/callback",
        subject: "user-456",
      });

    const code = new URL(authorizeResponse.headers.location).searchParams.get(
      "code",
    );

    const tokenResponse = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: "test-client",
        client_secret: "test-secret",
        redirect_uri: "http://localhost:3000/oauth/callback",
        code,
      });

    const originalRefreshToken = tokenResponse.body.refresh_token;

    const refreshResponse = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "refresh_token",
        client_id: "test-client",
        client_secret: "test-secret",
        refresh_token: originalRefreshToken,
      });

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.refresh_token).toBeTruthy();
    expect(refreshResponse.body.refresh_token).not.toBe(originalRefreshToken);

    const replayResponse = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "refresh_token",
        client_id: "test-client",
        client_secret: "test-secret",
        refresh_token: originalRefreshToken,
      });

    expect(replayResponse.status).toBe(400);
    expect(replayResponse.body.error).toBe("invalid_grant");
  });

  it("accepts OAuth bearer tokens on protected routes", async () => {
    const app = createTestApp();

    const authorizeResponse = await request(app)
      .get("/oauth/authorize")
      .set("X-API-Key", "test-admin-key")
      .query({
        response_type: "code",
        client_id: "test-client",
        redirect_uri: "http://localhost:3000/oauth/callback",
        subject: "user-789",
        scope: "reports:read stats:read",
      });

    const code = new URL(authorizeResponse.headers.location).searchParams.get(
      "code",
    );

    const tokenResponse = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: "test-client",
        client_secret: "test-secret",
        redirect_uri: "http://localhost:3000/oauth/callback",
        code,
      });

    const protectedResponse = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${tokenResponse.body.access_token}`);

    expect(protectedResponse.status).toBe(200);
    expect(protectedResponse.body).toEqual({
      id: "user-789",
      role: "oauth-client",
      clientId: "test-client",
      scopes: ["reports:read", "stats:read"],
    });
  });
});

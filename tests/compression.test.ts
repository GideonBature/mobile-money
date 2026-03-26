import compression from "compression";
import express from "express";
import request from "supertest";

function createCompressionApp(compressionEnabled = true) {
  const app = express();

  if (compressionEnabled) {
    app.use(
      compression({
        threshold: 1024,
        level: 6,
        filter: (req, res) => {
          if (req.headers["x-no-compression"]) {
            return false;
          }
          return compression.filter(req, res);
        },
      }),
    );
  }

  app.get("/large", (_req, res) => {
    res.type("application/json");
    res.json({ data: "x".repeat(4000) });
  });

  app.get("/small", (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}

describe("Compression Middleware", () => {
  it("should compress large responses", async () => {
    const response = await request(createCompressionApp())
      .get("/large")
      .set("Accept-Encoding", "gzip")
      .expect(200);

    expect(response.headers["content-encoding"]).toBe("gzip");
  });

  it("should not compress small responses", async () => {
    const response = await request(createCompressionApp())
      .get("/small")
      .set("Accept-Encoding", "gzip")
      .expect(200);

    expect(response.headers["content-encoding"]).toBeUndefined();
  });

  it("should respect x-no-compression header", async () => {
    const response = await request(createCompressionApp())
      .get("/large")
      .set("Accept-Encoding", "gzip")
      .set("x-no-compression", "true")
      .expect(200);

    expect(response.headers["content-encoding"]).toBeUndefined();
  });

  it("should work with compression disabled", async () => {
    const response = await request(createCompressionApp(false))
      .get("/large")
      .set("Accept-Encoding", "gzip")
      .expect(200);

    expect(response.headers["content-encoding"]).toBeUndefined();
  });
});

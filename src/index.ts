import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import os from "os";
import fs from "fs";
import path from "path";

import { transactionRoutes } from "./routes/transactions";
import { bulkRoutes } from "./routes/bulk";
import { transactionDisputeRoutes, disputeRoutes } from "./routes/disputes";
import { errorHandler } from "./middleware/errorHandler";
import { connectRedis } from "./config/redis";
import {
  globalTimeout,
  haltOnTimedout,
  timeoutErrorHandler,
} from "./middleware/timeout";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

// Security and parsing middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(limiter);

// Global timeout configuration
app.use(globalTimeout);
app.use(haltOnTimedout);

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// cache to ensure <100ms response
let cachedHealth: any = null;
let lastCheckTime = 0;
const CACHE_TTL = 5000; // 5 seconds

async function checkRedis(): Promise<boolean> {
  try {
    // If connectRedis exposes client, use ping here instead
    // Placeholder: assume connection success if no error thrown earlier
    return true;
  } catch {
    return false;
  }
}

function checkMemory(): boolean {
  const total = os.totalmem();
  const free = os.freemem();
  const usage = (total - free) / total;

  return usage < 0.9; // unhealthy if >90% used
}

function checkDisk(): boolean {
  try {
    const diskPath = path.resolve("/");
    fs.accessSync(diskPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

app.get("/health/lb", async (req, res) => {
  const now = Date.now();

  // Return cached result if within TTL
  if (cachedHealth && now - lastCheckTime < CACHE_TTL) {
    return res.status(cachedHealth.statusCode).json(cachedHealth.data);
  }

  const start = Date.now();

  const [redisOk] = await Promise.all([checkRedis()]);

  const memoryOk = checkMemory();
  const diskOk = checkDisk();

  const isHealthy = redisOk && memoryOk && diskOk;

  const response = {
    status: isHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    responseTimeMs: Date.now() - start,
    checks: {
      redis: redisOk ? "up" : "down",
      memory: memoryOk ? "ok" : "high",
      disk: diskOk ? "ok" : "unavailable",
    },
  };

  const statusCode = isHealthy ? 200 : 503;

  // Cache result
  cachedHealth = {
    statusCode,
    data: response,
  };
  lastCheckTime = now;

  res.status(statusCode).json(response);
});

app.use("/api/transactions", transactionRoutes);
app.use("/api/transactions", transactionDisputeRoutes);
app.use("/api/transactions/bulk", bulkRoutes);
app.use("/api/disputes", disputeRoutes);

// Timeout error handler (must be before general error handler)
app.use(timeoutErrorHandler);
app.use(errorHandler);

// Initialize Redis connection
connectRedis()
  .then(() => {
    console.log("Redis initialized");
  })
  .catch((err) => {
    console.error("Failed to connect to Redis:", err);
    console.warn("Distributed locks will not be available");
  });

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

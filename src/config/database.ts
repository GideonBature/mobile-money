import { Pool, PoolConfig, QueryConfig, QueryResult, PoolClient } from "pg";

// Configuration for slow query logging
const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || "1000");
const ENABLE_SLOW_QUERY_LOGGING = process.env.ENABLE_SLOW_QUERY_LOGGING === "true" || 
  (process.env.NODE_ENV === "development" && process.env.ENABLE_SLOW_QUERY_LOGGING !== "false");

/**
 * Sanitizes a SQL query by removing sensitive data patterns
 */
function sanitizeQuery(query: string): string {
  return query
    // Remove potential sensitive values in WHERE clauses
    .replace(/(WHERE\s+[^=]+\s*=\s*)'[^']*'/gi, '$1***')
    .replace(/(WHERE\s+[^=]+\s*=\s*)\d+/gi, '$1***')
    // Remove sensitive data in INSERT/UPDATE values
    .replace(/(VALUES\s*\([^)]*)'[^']*'([^)]*\))/gi, '$1***$2')
    .replace(/(SET\s+[^=]+\s*=\s*)'[^']*'/gi, '$1***')
    .replace(/(SET\s+[^=]+\s*=\s*)\d+/gi, '$1***')
    // Remove email patterns
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '***@***.***')
    // Remove phone number patterns
    .replace(/\b\d{10,}\b/g, '***')
    // Remove API keys and tokens
    .replace(/\b[A-Za-z0-9]{20,}\b/g, '***');
}

/**
 * Sanitizes query parameters to remove sensitive data
 */
function sanitizeParams(params: any[]): any[] {
  if (!params || !Array.isArray(params)) return params;
  
  return params.map(param => {
    if (typeof param === 'string') {
      // Check for email patterns
      if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/.test(param)) {
        return '***@***.***';
      }
      // Check for phone numbers (10+ digits)
      if (/^\d{10,}$/.test(param)) {
        return '***';
      }
      // Check for potential API keys/tokens (20+ chars, alphanumeric)
      if (/^[A-Za-z0-9]{20,}$/.test(param)) {
        return '***';
      }
      // Check for potential sensitive data in quotes
      if (param.length > 50) {
        return '***';
      }
      return param;
    }
    if (typeof param === 'number' && param > 1000000) {
      return '***';
    }
    return param;
  });
}

/**
 * Logs slow queries with sanitized information
 */
function logSlowQuery(query: string, duration: number, params?: any[]): void {
  if (!ENABLE_SLOW_QUERY_LOGGING) return;
  
  const logEntry = {
    type: "slow_query",
    duration: Math.round(duration),
    threshold: SLOW_QUERY_THRESHOLD_MS,
    query: sanitizeQuery(query),
    params: params ? sanitizeParams(params) : undefined,
    timestamp: new Date().toISOString()
  };
  
  console.log(JSON.stringify(logEntry));
}

// Enhanced Pool with query timing
class SlowQueryPool extends Pool {
  async query<T = any>(queryConfig: QueryConfig | string, values?: any[]): Promise<QueryResult<T>> {
    const startTime = process.hrtime.bigint();
    const queryString = typeof queryConfig === 'string' ? queryConfig : queryConfig.text;
    const queryParams = typeof queryConfig === 'string' ? values : queryConfig.values;
    
    try {
      const result = await super.query<T>(queryConfig, values);
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1e6;
      
      if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
        logSlowQuery(queryString, durationMs, queryParams);
      }
      
      return result;
    } catch (error) {
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1e6;
      
      if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
        logSlowQuery(queryString, durationMs, queryParams);
      }
      
      throw error;
    }
  }
}

/**
 * Primary connection pool – handles all write operations
 * (INSERT, UPDATE, DELETE) and read operations when no replica is available.
 */
export const pool = new SlowQueryPool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Read replica connection pool – handles SELECT queries to take load off the
 * primary. If READ_REPLICA_URL is not configured, falls back to the primary.
 *
 * Multiple replica URLs can be provided as a comma-separated list in
 * READ_REPLICA_URL. The pool load-balances across all replicas via round-robin.
 */
const replicaUrls: string[] = process.env.READ_REPLICA_URL
  ? process.env.READ_REPLICA_URL.split(",").map((url) => url.trim())
  : [];

// Build an individual Pool for each replica URL
const replicaPools: Pool[] = replicaUrls.map(
  (url) =>
    new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    }),
);

// Track which replica to use next for round-robin load balancing
let replicaIndex = 0;

/**
 * Return the next replica pool in round-robin order.
 * Returns null if no replica pools are configured.
 */
function getNextReplicaPool(): Pool | null {
  if (replicaPools.length === 0) return null;
  const selected = replicaPools[replicaIndex % replicaPools.length];
  replicaIndex += 1;
  return selected;
}

/**
 * Execute a read-only SQL query against a replica pool if available.
 * If the replica is unreachable (pool error or connection failure) the query
 * automatically falls over to the primary pool so callers are unaffected.
 *
 * @param text   - The parameterised SQL query string
 * @param params - Optional query parameters
 */
export async function queryRead<T extends import("pg").QueryResultRow = any>(
  text: string,
  params?: unknown[],
): Promise<import("pg").QueryResult<T>> {
  const replicaPool = getNextReplicaPool();

  if (replicaPool) {
    let client: PoolClient | null = null;
    try {
      client = await replicaPool.connect();
      const result = await client.query<T>(text, params);
      return result;
    } catch (err) {
      // Log replica failure and fall back to primary
      console.warn("Read replica query failed, falling back to primary:", err);
    } finally {
      client?.release();
    }
  }

  // Fall back: use primary pool
  return pool.query<T>(text, params);
}

/**
 * Execute a write SQL query (INSERT / UPDATE / DELETE) against the primary pool.
 *
 * @param text   - The parameterised SQL query string
 * @param params - Optional query parameters
 */
export async function queryWrite<T extends import("pg").QueryResultRow = any>(
  text: string,
  params?: unknown[],
): Promise<import("pg").QueryResult<T>> {
  return pool.query<T>(text, params);
}

/**
 * Health check for all replica pools.
 * Returns an array of status objects – useful for monitoring endpoints.
 */
export async function checkReplicaHealth(): Promise<
  { url: string; healthy: boolean }[]
> {
  return Promise.all(
    replicaUrls.map(async (url, idx) => {
      let client: PoolClient | null = null;
      try {
        client = await replicaPools[idx].connect();
        await client.query("SELECT 1");
        return { url, healthy: true };
      } catch {
        return { url, healthy: false };
      } finally {
        client?.release();
      }
    }),
  );
}

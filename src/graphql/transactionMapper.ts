/**
 * Normalize transaction rows from pg (snake_case) to GraphQL-friendly shapes.
 */

export interface MappedTransaction {
  id: string;
  referenceNumber: string;
  type: string;
  amount: string;
  phoneNumber: string;
  provider: string;
  stellarAddress: string;
  status: string;
  tags: string[];
  retryCount?: number;
  createdAt: string;
}

export function mapTransactionRow(row: Record<string, unknown>): MappedTransaction {
  const r = row as {
    id?: unknown;
    reference_number?: string;
    referenceNumber?: string;
    type?: string;
    amount?: string | number;
    phone_number?: string;
    phoneNumber?: string;
    provider?: string;
    stellar_address?: string;
    stellarAddress?: string;
    status?: string;
    tags?: string[];
    created_at?: Date;
    createdAt?: Date;
    retry_count?: number;
    retryCount?: number;
  };
  const created = r.created_at ?? r.createdAt;
  return {
    id: String(r.id ?? ""),
    referenceNumber: String(r.reference_number ?? r.referenceNumber ?? ""),
    type: String(r.type ?? ""),
    amount: String(r.amount ?? ""),
    phoneNumber: String(r.phone_number ?? r.phoneNumber ?? ""),
    provider: String(r.provider ?? ""),
    stellarAddress: String(r.stellar_address ?? r.stellarAddress ?? ""),
    status: String(r.status ?? ""),
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    retryCount: Number(r.retry_count ?? r.retryCount ?? 0),
    createdAt:
      created instanceof Date ? created.toISOString() : String(created ?? ""),
  };
}

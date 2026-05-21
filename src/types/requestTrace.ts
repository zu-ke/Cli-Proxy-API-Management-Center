export type RequestTraceStatus = 'success' | 'failure' | 'retrying' | 'pending' | 'unknown';

export interface RequestTraceSummary {
  id: string;
  requestId: string;
  authId: string;
  credentialId: string;
  credentialIndex?: string;
  provider: string;
  status: RequestTraceStatus;
  statusCode?: number;
  durationMs: number | null;
  retryCredentialOrder: string[];
  requestSummary: string;
  responseSummary: string;
  failureReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RequestTraceAttempt {
  sequence: number;
  provider?: string;
  credential_id?: string;
  credentialId?: string;
  credential_index?: string;
  credentialIndex?: string;
  model?: string;
  upstream_model?: string;
  upstreamModel?: string;
  success?: boolean;
  status_code?: number;
  statusCode?: number;
  error?: string;
  retry_after_seconds?: number;
  retryAfterSeconds?: number;
  started_at?: string;
  startedAt?: string;
  finished_at?: string;
  finishedAt?: string;
  duration_ms?: number;
  durationMs?: number;
}

export interface RequestTraceDetail extends RequestTraceSummary {
  method?: string;
  path?: string;
  requestHeaders?: Record<string, unknown>;
  requestBody?: unknown;
  responseStatus?: number;
  responseHeaders?: Record<string, unknown>;
  responseBody?: unknown;
  attempts?: RequestTraceAttempt[];
  raw?: unknown;
}

export interface RequestTraceListParams {
  search?: string;
  status?: string;
  requestId?: string;
  credentialId?: string;
  authId?: string;
  provider?: string;
  model?: string;
  path?: string;
  limit?: number;
}

export interface RequestTraceListResponse {
  traces: RequestTraceSummary[];
  total?: number;
}

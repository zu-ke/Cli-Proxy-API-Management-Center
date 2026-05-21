import { apiClient } from './client';
import type {
  RequestTraceDetail,
  RequestTraceListParams,
  RequestTraceListResponse,
  RequestTraceStatus,
  RequestTraceSummary,
  RequestTraceAttempt,
} from '@/types/requestTrace';

const REQUEST_TRACES_ENDPOINT = '/v0/management/request-traces';
const REQUEST_TRACES_TIMEOUT_MS = 15 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readString = (record: Record<string, unknown>, keys: string[], fallback = ''): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return fallback;
};

const readNumber = (record: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

const readBoolean = (record: Record<string, unknown>, keys: string[]): boolean | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string' && value.trim()) {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
    }
  }
  return undefined;
};

const normalizeStatus = (record: Record<string, unknown>): RequestTraceStatus => {
  const status = String(record.status ?? '').trim().toLowerCase();
  if (status === 'success' || status === 'ok' || status === 'completed') return 'success';
  if (status === 'failure' || status === 'failed' || status === 'error') return 'failure';
  if (status === 'retrying' || status === 'retry') return 'retrying';
  if (status === 'pending' || status === 'running') return 'pending';
  const failed = readBoolean(record, ['failed']);
  if (failed === true) return 'failure';
  if (failed === false) {
    const statusCode = readNumber(record, ['status_code', 'statusCode']);
    if (typeof statusCode === 'number' && statusCode >= 200) {
      return statusCode >= 400 ? 'failure' : 'success';
    }
  }
  const statusCode = readNumber(record, ['status_code', 'statusCode']);
  if (typeof statusCode === 'number' && statusCode > 0) {
    return statusCode >= 400 ? 'failure' : 'success';
  }
  return 'unknown';
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
};

const readBodySnapshot = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  if ('body' in value) return value.body;
  return value;
};

const stringifyBodyPreview = (value: unknown): string => {
  const body = readBodySnapshot(value);
  if (typeof body === 'string') return body;
  if (body === undefined || body === null) return '';
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
};

const normalizeAttempts = (value: unknown): RequestTraceAttempt[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((item) => ({
    sequence: readNumber(item, ['sequence', 'index']) ?? 0,
    provider: readString(item, ['provider']),
    credential_id: readString(item, ['credential_id', 'credentialId', 'auth_id', 'authId']),
    credential_index: readString(item, ['credential_index', 'credentialIndex', 'auth_index', 'authIndex']),
    model: readString(item, ['model']),
    upstream_model: readString(item, ['upstream_model', 'upstreamModel']),
    success: readBoolean(item, ['success']),
    status_code: readNumber(item, ['status_code', 'statusCode']) ?? undefined,
    error: readString(item, ['error']),
    retry_after_seconds: readNumber(item, ['retry_after_seconds', 'retryAfterSeconds']) ?? undefined,
    started_at: readString(item, ['started_at', 'startedAt']),
    finished_at: readString(item, ['finished_at', 'finishedAt']),
    duration_ms: readNumber(item, ['duration_ms', 'durationMs']) ?? undefined,
  }));
};

const normalizeTraceSummary = (value: unknown): RequestTraceSummary | null => {
  if (!isRecord(value)) return null;

  const requestId = readString(value, ['request_id', 'requestId', 'id']);
  const id = readString(value, ['id', 'trace_id', 'traceId'], requestId);
  if (!id && !requestId) return null;

  const authId = readString(value, ['auth_id', 'authId', 'auth_index', 'authIndex']);
  const credentialIndex = readString(value, [
    'credential_index',
    'credentialIndex',
    'auth_index',
    'authIndex',
  ]);
  const credentialId = readString(value, [
    'credential_id',
    'credentialId',
    'auth_file',
    'authFile',
    'auth_file_name',
    'authFileName',
    'credential',
  ]);

  return {
    id: id || requestId,
    requestId: requestId || id,
    authId,
    credentialId: credentialId || authId,
    provider: readString(value, ['provider', 'type', 'channel'], '-'),
    status: normalizeStatus(value),
    statusCode: readNumber(value, ['status_code', 'statusCode']) ?? undefined,
    durationMs: readNumber(value, ['duration_ms', 'durationMs', 'elapsed_ms', 'elapsedMs']),
    retryCredentialOrder: normalizeStringArray(
      value.retry_order ??
        value.retryOrder ??
        value.retry_credential_order ??
        value.retryCredentialOrder ??
        value.retry_auth_order
    ),
    requestSummary:
      readString(value, ['request_preview', 'requestPreview', 'request_summary', 'requestSummary']) ||
      stringifyBodyPreview(value.request),
    responseSummary:
      readString(value, [
        'response_preview',
        'responsePreview',
        'response_summary',
        'responseSummary',
      ]) || stringifyBodyPreview(value.response),
    failureReason: readString(value, ['failure_reason', 'failureReason', 'error', 'error_message']),
    createdAt: readString(value, ['created_at', 'createdAt', 'time', 'timestamp']),
    updatedAt: readString(value, ['updated_at', 'updatedAt']),
    credentialIndex,
  };
};

const normalizeTraceDetail = (value: unknown): RequestTraceDetail => {
  const summary = normalizeTraceSummary(value);
  const record = isRecord(value) ? value : {};
  const fallback = summary ?? {
    id: '',
    requestId: '',
    authId: '',
    credentialId: '',
    provider: '-',
    status: 'unknown' as const,
    durationMs: null,
    retryCredentialOrder: [],
    requestSummary: '',
    responseSummary: '',
  };

  return {
    ...fallback,
    method: readString(record, ['method']),
    path: readString(record, ['path', 'url', 'endpoint']),
    requestHeaders: isRecord(record.request_headers)
      ? record.request_headers
      : isRecord(record.requestHeaders)
        ? record.requestHeaders
        : undefined,
    requestBody: record.request_body ?? record.requestBody ?? readBodySnapshot(record.request),
    responseStatus:
      readNumber(record, ['response_status', 'responseStatus', 'status_code', 'statusCode']) ??
      undefined,
    responseHeaders: isRecord(record.response_headers)
      ? record.response_headers
      : isRecord(record.responseHeaders)
        ? record.responseHeaders
        : undefined,
    responseBody: record.response_body ?? record.responseBody ?? readBodySnapshot(record.response),
    attempts: normalizeAttempts(record.attempts),
    raw: value,
  };
};

const normalizeListResponse = (payload: unknown): RequestTraceListResponse => {
  const source = isRecord(payload) ? payload.traces ?? payload.items ?? payload.data : payload;
  const traces = Array.isArray(source)
    ? source.map(normalizeTraceSummary).filter((trace): trace is RequestTraceSummary => Boolean(trace))
    : [];

  return {
    traces,
    total:
      isRecord(payload) && typeof payload.total === 'number'
        ? payload.total
        : traces.length,
  };
};

export const requestTracesApi = {
  async list(params: RequestTraceListParams = {}): Promise<RequestTraceListResponse> {
    const query: Record<string, string | number | boolean> = {};
    if (params.limit) query.limit = params.limit;
    if (params.requestId) query.request_id = params.requestId;
    if (params.credentialId || params.authId) {
      query.credential_id = params.credentialId || params.authId || '';
    }
    if (params.model) query.model = params.model;
    if (params.path) query.path = params.path;
    if (params.status === 'failure' || params.status === 'failed') query.failed = true;

    const payload = await apiClient.get(REQUEST_TRACES_ENDPOINT, {
      params: query,
      timeout: REQUEST_TRACES_TIMEOUT_MS,
    });
    return normalizeListResponse(payload);
  },

  async get(id: string): Promise<RequestTraceDetail> {
    const payload = await apiClient.get(`${REQUEST_TRACES_ENDPOINT}/${encodeURIComponent(id)}`, {
      timeout: REQUEST_TRACES_TIMEOUT_MS,
    });
    return normalizeTraceDetail(payload);
  },
};

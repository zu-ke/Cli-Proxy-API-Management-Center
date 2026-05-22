import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select, type SelectOption } from '@/components/ui/Select';
import {
  IconChartLine,
  IconCopy,
  IconRefreshCw,
  IconSearch,
  IconSlidersHorizontal,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useInterval } from '@/hooks/useInterval';
import { apiKeyUsageApi, authFilesApi, requestTracesApi } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import type {
  AuthFileItem,
  RequestTraceAttempt,
  RequestTraceDetail,
  RequestTraceStatus,
  RequestTraceSummary,
} from '@/types';
import { copyToClipboard } from '@/utils/clipboard';
import {
  normalizeRecentRequestUsageEntry,
  normalizeUsageTotal,
  statusBarDataFromRecentRequests,
  type ApiKeyUsageResponse,
  type RecentRequestUsageEntry,
  type StatusBlockState,
} from '@/utils/recentRequests';
import styles from './UsagePage.module.scss';

type UsageStatus = 'success' | 'failure' | 'mixed' | 'idle';
type SortKey = 'total' | 'failed' | 'successRate' | 'provider';
type UsageView = 'summary' | 'traces';

interface UsageRow {
  id: string;
  provider: string;
  source: 'api_key' | 'auth_file';
  baseUrl: string;
  apiKey: string;
  maskedApiKey: string;
  success: number;
  failed: number;
  total: number;
  successRate: number;
  status: UsageStatus;
  trendBlocks: StatusBlockState[];
  usage: RecentRequestUsageEntry;
}

const ALL_VALUE = '__all__';

const getErrorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
};

const parseCompositeKey = (compositeKey: string): { baseUrl: string; apiKey: string } => {
  const separatorIndex = compositeKey.indexOf('|');
  if (separatorIndex < 0) {
    return { baseUrl: compositeKey, apiKey: '' };
  }

  return {
    baseUrl: compositeKey.slice(0, separatorIndex),
    apiKey: compositeKey.slice(separatorIndex + 1),
  };
};

const maskApiKey = (apiKey: string): string => {
  const trimmed = apiKey.trim();
  if (!trimmed) return '-';
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}...${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
};

const resolveStatus = (success: number, failed: number): UsageStatus => {
  if (success + failed === 0) return 'idle';
  if (failed === 0) return 'success';
  if (success === 0) return 'failure';
  return 'mixed';
};

const normalizeProviderKey = (value: string): string => value.trim().toLowerCase();

const buildUsageRows = (payload: ApiKeyUsageResponse): UsageRow[] => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }

  return Object.entries(payload).flatMap(([providerName, entries]) => {
    const provider = normalizeProviderKey(providerName);
    if (!provider || !entries || typeof entries !== 'object' || Array.isArray(entries)) {
      return [];
    }

    return Object.entries(entries).map(([compositeKey, rawEntry]) => {
      const usage = normalizeRecentRequestUsageEntry(rawEntry);
      const { baseUrl, apiKey } = parseCompositeKey(compositeKey);
      const success = usage.success;
      const failed = usage.failed;
      const total = success + failed;
      const trend = statusBarDataFromRecentRequests(usage.recentRequests);

      return {
        id: `${provider}::${compositeKey}`,
        provider,
        source: 'api_key',
        baseUrl,
        apiKey,
        maskedApiKey: maskApiKey(apiKey),
        success,
        failed,
        total,
        successRate: total > 0 ? (success / total) * 100 : 100,
        status: resolveStatus(success, failed),
        trendBlocks: trend.blocks,
        usage,
      };
    });
  });
};

const buildAuthFileUsageRows = (files: AuthFileItem[]): UsageRow[] =>
  files.flatMap((file) => {
    const provider = normalizeProviderKey(String(file.provider ?? file.type ?? 'unknown'));
    if (!provider) return [];

    const usage = normalizeRecentRequestUsageEntry({
      success: file.success,
      failed: file.failed,
      recent_requests: file.recent_requests ?? file.recentRequests,
    });
    const success = normalizeUsageTotal(usage.success);
    const failed = normalizeUsageTotal(usage.failed);
    const total = success + failed;
    if (total === 0) return [];

    const account = String(file.account ?? file.email ?? file.name ?? '').trim();
    const accountType = String(file.account_type ?? 'auth file').trim();
    const credential = account || file.name;
    const trend = statusBarDataFromRecentRequests(usage.recentRequests);

    return [
      {
        id: `auth-file::${provider}::${file.name}`,
        provider,
        source: 'auth_file' as const,
        baseUrl: accountType || 'auth file',
        apiKey: credential,
        maskedApiKey: credential,
        success,
        failed,
        total,
        successRate: total > 0 ? (success / total) * 100 : 100,
        status: resolveStatus(success, failed),
        trendBlocks: trend.blocks,
        usage,
      },
    ];
  });

const formatNumber = (value: number): string => new Intl.NumberFormat().format(value);

const formatPercent = (value: number): string => `${value.toFixed(1)}%`;

const formatDuration = (value: number | null): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
};

const formatTraceTime = (value?: string): string => {
  if (!value) return '-';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readNumberValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const prettifyPayloadText = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return value;
  }
};

const stringifyRawPayload = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

interface TracePayloadSnapshot {
  rawText: string;
  displayText: string;
  size: number | null;
  truncated: boolean;
  hasContent: boolean;
}

const getTracePayloadSnapshot = (
  trace: RequestTraceDetail,
  key: 'request' | 'response'
): TracePayloadSnapshot => {
  const rawRecord = isRecord(trace.raw) ? trace.raw : {};
  const rawSnapshot = isRecord(rawRecord[key]) ? rawRecord[key] : undefined;
  const normalizedBody = key === 'request' ? trace.requestBody : trace.responseBody;
  const rawBody = rawSnapshot && 'body' in rawSnapshot ? rawSnapshot.body : rawRecord[key];
  const body = normalizedBody ?? rawBody;
  const hasContent = body !== undefined && body !== null && body !== '';
  const rawText = hasContent ? stringifyRawPayload(body) : '-';
  const explicitSize = rawSnapshot ? readNumberValue(rawSnapshot.size) : null;

  return {
    rawText,
    displayText: hasContent ? prettifyPayloadText(rawText) : '-',
    size: explicitSize ?? (hasContent ? rawText.length : 0),
    truncated: rawSnapshot?.truncated === true,
    hasContent,
  };
};

const formatPayloadSize = (value: number | null): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value < 1024) return `${formatNumber(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
};

const getAttemptCredential = (attempt: RequestTraceAttempt): string =>
  attempt.credentialId ||
  attempt.credential_id ||
  attempt.credentialIndex ||
  attempt.credential_index ||
  '-';

const getAttemptStatusCode = (attempt: RequestTraceAttempt): number | undefined =>
  attempt.statusCode ?? attempt.status_code;

const getAttemptDuration = (attempt: RequestTraceAttempt): number | null =>
  readNumberValue(attempt.durationMs ?? attempt.duration_ms);

const getAttemptRetryAfter = (attempt: RequestTraceAttempt): number | null =>
  readNumberValue(attempt.retryAfterSeconds ?? attempt.retry_after_seconds);

const getAttemptStatusKind = (attempt: RequestTraceAttempt): 'success' | 'failure' | 'pending' => {
  if (attempt.success === true) return 'success';
  if (attempt.success === false) return 'failure';
  const statusCode = getAttemptStatusCode(attempt);
  if (typeof statusCode === 'number' && statusCode > 0) {
    return statusCode >= 400 ? 'failure' : 'success';
  }
  return 'pending';
};

export function UsagePage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [view, setView] = useState<UsageView>(
    searchParams.get('view') === 'traces' ? 'traces' : 'summary'
  );
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [providerFilter, setProviderFilter] = useState(ALL_VALUE);
  const [statusFilter, setStatusFilter] = useState<UsageStatus | typeof ALL_VALUE>(ALL_VALUE);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('credential') ?? '');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [traces, setTraces] = useState<RequestTraceSummary[]>([]);
  const [tracesLoading, setTracesLoading] = useState(false);
  const [tracesError, setTracesError] = useState('');
  const [traceStatusFilter, setTraceStatusFilter] = useState<RequestTraceStatus | typeof ALL_VALUE>(
    searchParams.get('status') === 'failure' ? 'failure' : ALL_VALUE
  );
  const [traceProviderFilter, setTraceProviderFilter] = useState(ALL_VALUE);
  const [traceAutoRefresh, setTraceAutoRefresh] = useState(true);
  const [selectedTrace, setSelectedTrace] = useState<RequestTraceDetail | null>(null);
  const [traceDetailLoading, setTraceDetailLoading] = useState(false);

  const disableControls = connectionStatus !== 'connected';

  const loadUsage = useCallback(async () => {
    if (disableControls) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [apiKeyPayload, authFilePayload] = await Promise.all([
        apiKeyUsageApi.getUsage(),
        authFilesApi.list(),
      ]);
      setRows([
        ...buildUsageRows(apiKeyPayload),
        ...buildAuthFileUsageRows(authFilePayload.files ?? []),
      ]);
    } catch (err: unknown) {
      setError(
        getErrorMessage(err, t('notification.refresh_failed', { defaultValue: 'Refresh failed' }))
      );
    } finally {
      setLoading(false);
    }
  }, [disableControls, t]);

  const loadTraces = useCallback(async () => {
    if (disableControls) {
      setTracesLoading(false);
      return;
    }

    setTracesLoading(true);
    setTracesError('');
    try {
      const payload = await requestTracesApi.list({
        limit: 100,
        search: searchQuery.trim() || undefined,
        status: traceStatusFilter === ALL_VALUE ? undefined : traceStatusFilter,
        provider: traceProviderFilter === ALL_VALUE ? undefined : traceProviderFilter,
        credentialId: searchParams.get('credential') ?? undefined,
        authId: searchParams.get('credential') ?? undefined,
      });
      setTraces(payload.traces);
    } catch (err: unknown) {
      setTracesError(
        getErrorMessage(err, t('notification.refresh_failed', { defaultValue: 'Refresh failed' }))
      );
    } finally {
      setTracesLoading(false);
    }
  }, [disableControls, searchParams, searchQuery, t, traceProviderFilter, traceStatusFilter]);

  useHeaderRefresh(view === 'traces' ? loadTraces : loadUsage);

  useEffect(() => {
    if (view === 'traces') {
      void loadTraces();
      return;
    }
    void loadUsage();
  }, [loadTraces, loadUsage, view]);

  useInterval(
    () => {
      void loadTraces();
    },
    view === 'traces' && traceAutoRefresh && !disableControls ? 10_000 : null
  );

  const handleViewChange = useCallback(
    (nextView: UsageView) => {
      setView(nextView);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (nextView === 'traces') {
          next.set('view', 'traces');
        } else {
          next.delete('view');
          next.delete('status');
          next.delete('credential');
        }
        return next;
      });
    },
    [setSearchParams]
  );

  const providerOptions = useMemo<SelectOption[]>(() => {
    const providers = Array.from(new Set(rows.map((row) => row.provider))).sort((a, b) =>
      a.localeCompare(b)
    );

    return [
      {
        value: ALL_VALUE,
        label: t('usage.filters.all_providers', { defaultValue: 'All providers' }),
      },
      ...providers.map((provider) => ({ value: provider, label: provider })),
    ];
  }, [rows, t]);

  const statusOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: ALL_VALUE,
        label: t('usage.filters.all_statuses', { defaultValue: 'All statuses' }),
      },
      { value: 'success', label: t('usage.status.success', { defaultValue: 'Success' }) },
      { value: 'failure', label: t('usage.status.failure', { defaultValue: 'Failure' }) },
      { value: 'mixed', label: t('usage.status.mixed', { defaultValue: 'Mixed' }) },
      { value: 'idle', label: t('usage.status.idle', { defaultValue: 'Idle' }) },
    ],
    [t]
  );

  const sortOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'total', label: t('usage.sort.total', { defaultValue: 'Total volume' }) },
      { value: 'failed', label: t('usage.sort.failed', { defaultValue: 'Failed count' }) },
      {
        value: 'successRate',
        label: t('usage.sort.success_rate', { defaultValue: 'Success rate' }),
      },
      { value: 'provider', label: t('usage.sort.provider', { defaultValue: 'Provider' }) },
    ],
    [t]
  );

  const filteredRows = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase();

    const nextRows = rows.filter((row) => {
      if (providerFilter !== ALL_VALUE && row.provider !== providerFilter) return false;
      if (statusFilter !== ALL_VALUE && row.status !== statusFilter) return false;
      if (onlyFailed && row.failed === 0) return false;
      if (!query) return true;

      return (
        row.baseUrl.toLowerCase().includes(query) ||
        row.apiKey.toLowerCase().includes(query) ||
        row.maskedApiKey.toLowerCase().includes(query)
      );
    });

    return [...nextRows].sort((a, b) => {
      if (sortKey === 'provider') {
        return a.provider.localeCompare(b.provider) || b.total - a.total;
      }
      if (sortKey === 'successRate') {
        return a.successRate - b.successRate || b.total - a.total;
      }
      return b[sortKey] - a[sortKey] || a.provider.localeCompare(b.provider);
    });
  }, [deferredSearchQuery, onlyFailed, providerFilter, rows, sortKey, statusFilter]);

  const traceProviderOptions = useMemo<SelectOption[]>(() => {
    const providers = Array.from(new Set(traces.map((trace) => trace.provider))).sort((a, b) =>
      a.localeCompare(b)
    );
    return [
      {
        value: ALL_VALUE,
        label: t('usage.filters.all_providers', { defaultValue: 'All providers' }),
      },
      ...providers.map((provider) => ({ value: provider, label: provider })),
    ];
  }, [t, traces]);

  const traceStatusOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: ALL_VALUE,
        label: t('usage.filters.all_statuses', { defaultValue: 'All statuses' }),
      },
      { value: 'success', label: t('usage.status.success', { defaultValue: 'Success' }) },
      { value: 'failure', label: t('usage.status.failure', { defaultValue: 'Failure' }) },
      { value: 'retrying', label: t('usage.status.retrying', { defaultValue: 'Retrying' }) },
      { value: 'pending', label: t('usage.status.pending', { defaultValue: 'Pending' }) },
      { value: 'unknown', label: t('usage.status.unknown', { defaultValue: 'Unknown' }) },
    ],
    [t]
  );

  const filteredTraces = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase();
    return traces.filter((trace) => {
      if (traceStatusFilter !== ALL_VALUE && trace.status !== traceStatusFilter) return false;
      if (traceProviderFilter !== ALL_VALUE && trace.provider !== traceProviderFilter) return false;
      if (!query) return true;
      return [
        trace.requestId,
        trace.credentialId,
        trace.authId,
        trace.provider,
        trace.requestSummary,
        trace.responseSummary,
        trace.failureReason,
        ...trace.retryCredentialOrder,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [deferredSearchQuery, traceProviderFilter, traceStatusFilter, traces]);

  const openTraceDetail = useCallback(
    async (trace: RequestTraceSummary) => {
      setTraceDetailLoading(true);
      setSelectedTrace({ ...trace, raw: trace });
      try {
        setSelectedTrace(await requestTracesApi.get(trace.id));
      } catch (err: unknown) {
        setSelectedTrace({
          ...trace,
          responseSummary: getErrorMessage(
            err,
            t('usage.trace_detail_failed', { defaultValue: 'Failed to load trace detail' })
          ),
          raw: trace,
        });
      } finally {
        setTraceDetailLoading(false);
      }
    },
    [t]
  );

  const traceRequestPayload = useMemo(
    () => (selectedTrace ? getTracePayloadSnapshot(selectedTrace, 'request') : null),
    [selectedTrace]
  );
  const traceResponsePayload = useMemo(
    () => (selectedTrace ? getTracePayloadSnapshot(selectedTrace, 'response') : null),
    [selectedTrace]
  );

  const copyTracePayload = useCallback(
    async (payload: TracePayloadSnapshot | null) => {
      if (!payload?.hasContent) return;
      const copied = await copyToClipboard(payload.rawText);
      showNotification(
        copied
          ? t('usage.trace_copy_success', { defaultValue: 'Copied to clipboard' })
          : t('usage.trace_copy_failed', { defaultValue: 'Copy failed' }),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const summary = useMemo(
    () =>
      rows.reduce(
        (total, row) => ({
          keys: total.keys + 1,
          success: total.success + row.success,
          failed: total.failed + row.failed,
        }),
        { keys: 0, success: 0, failed: 0 }
      ),
    [rows]
  );

  const summaryTotal = summary.success + summary.failed;
  const summaryRate = summaryTotal > 0 ? (summary.success / summaryTotal) * 100 : 100;
  const hasRows = rows.length > 0;
  const isFilteredEmpty = hasRows && filteredRows.length === 0;

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            {t('usage.title', { defaultValue: 'Usage records' })}
          </h1>
          <p className={styles.description}>
            {t('usage.description', {
              defaultValue: 'Provider API key request totals and recent bucket health.',
            })}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void (view === 'traces' ? loadTraces() : loadUsage())}
          loading={view === 'traces' ? tracesLoading : loading}
          disabled={disableControls}
          className={styles.refreshButton}
        >
          <span className={styles.buttonContent}>
            <IconRefreshCw size={15} />
            {t('common.refresh', { defaultValue: 'Refresh' })}
          </span>
        </Button>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.viewTabs}>
        <Button
          variant={view === 'summary' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => handleViewChange('summary')}
        >
          {t('usage.views.summary', { defaultValue: 'Usage summary' })}
        </Button>
        <Button
          variant={view === 'traces' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => handleViewChange('traces')}
        >
          {t('usage.views.traces', { defaultValue: 'Request traces' })}
        </Button>
      </div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryItem}>
          <span>{t('usage.summary.keys', { defaultValue: 'Keys' })}</span>
          <strong>{formatNumber(summary.keys)}</strong>
        </div>
        <div className={styles.summaryItem}>
          <span>{t('usage.summary.total', { defaultValue: 'Total' })}</span>
          <strong>{formatNumber(summaryTotal)}</strong>
        </div>
        <div className={styles.summaryItem}>
          <span>{t('usage.summary.failed', { defaultValue: 'Failed' })}</span>
          <strong>{formatNumber(summary.failed)}</strong>
        </div>
        <div className={styles.summaryItem}>
          <span>{t('usage.summary.success_rate', { defaultValue: 'Success rate' })}</span>
          <strong>{formatPercent(summaryRate)}</strong>
        </div>
      </div>

      <Card className={styles.usageCard}>
        {view === 'summary' ? (
          <>
            <div className={styles.filters}>
              <div className={styles.searchWrap}>
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t('usage.search_placeholder', {
                    defaultValue: 'Search scope or credential',
                  })}
                  className={styles.searchInput}
                  rightElement={<IconSearch size={16} className={styles.searchIcon} />}
                />
              </div>

              <div className={styles.selectWrap}>
                <span className={styles.filterLabel}>
                  {t('usage.filters.provider', { defaultValue: 'Provider' })}
                </span>
                <Select
                  value={providerFilter}
                  options={providerOptions}
                  onChange={setProviderFilter}
                  ariaLabel={t('usage.filters.provider', { defaultValue: 'Provider' })}
                />
              </div>

              <div className={styles.selectWrap}>
                <span className={styles.filterLabel}>
                  {t('usage.filters.status', { defaultValue: 'Status' })}
                </span>
                <Select
                  value={statusFilter}
                  options={statusOptions}
                  onChange={(value) => setStatusFilter(value as UsageStatus | typeof ALL_VALUE)}
                  ariaLabel={t('usage.filters.status', { defaultValue: 'Status' })}
                />
              </div>

              <div className={styles.selectWrap}>
                <span className={styles.filterLabel}>
                  {t('usage.filters.sort', { defaultValue: 'Sort' })}
                </span>
                <Select
                  value={sortKey}
                  options={sortOptions}
                  onChange={(value) => setSortKey(value as SortKey)}
                  ariaLabel={t('usage.filters.sort', { defaultValue: 'Sort' })}
                />
              </div>

              <label className={styles.failedOnly}>
                <input
                  type="checkbox"
                  checked={onlyFailed}
                  onChange={(event) => setOnlyFailed(event.target.checked)}
                />
                <span>{t('usage.filters.only_failed', { defaultValue: 'Only failed' })}</span>
              </label>
            </div>

            <div className={styles.tableHeader}>
              <span className={styles.tableTitle}>
                <IconSlidersHorizontal size={16} />
                {t('usage.results', {
                  count: filteredRows.length,
                  total: rows.length,
                  defaultValue: '{{count}} / {{total}} records',
                })}
              </span>
              <span className={styles.tableHint}>
                <IconChartLine size={15} />
                {t('usage.trend_hint', { defaultValue: '20 recent buckets' })}
              </span>
            </div>

            {loading && !hasRows ? (
              <div className={styles.loadingState}>
                {t('common.loading', { defaultValue: 'Loading...' })}
              </div>
            ) : !hasRows ? (
              <EmptyState
                title={t('usage.empty_title', { defaultValue: 'No usage records' })}
                description={t('usage.empty_desc', {
                  defaultValue: 'Usage statistics will appear after credentials receive traffic.',
                })}
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void loadUsage()}
                    disabled={disableControls}
                  >
                    {t('common.refresh', { defaultValue: 'Refresh' })}
                  </Button>
                }
              />
            ) : isFilteredEmpty ? (
              <EmptyState
                title={t('usage.filtered_empty_title', { defaultValue: 'No matching records' })}
                description={t('usage.filtered_empty_desc', {
                  defaultValue: 'Adjust provider, status, failure, or search filters.',
                })}
              />
            ) : (
              <div
                className={styles.table}
                role="table"
                aria-label={t('usage.title', { defaultValue: 'Usage records' })}
              >
                <div className={styles.headRow} role="row">
                  <span role="columnheader">
                    {t('usage.columns.provider', { defaultValue: 'Provider' })}
                  </span>
                  <span role="columnheader">
                    {t('usage.columns.scope', { defaultValue: 'Scope' })}
                  </span>
                  <span role="columnheader">
                    {t('usage.columns.credential', { defaultValue: 'Credential' })}
                  </span>
                  <span role="columnheader">
                    {t('usage.columns.success', { defaultValue: 'Success' })}
                  </span>
                  <span role="columnheader">
                    {t('usage.columns.failed', { defaultValue: 'Failed' })}
                  </span>
                  <span role="columnheader">
                    {t('usage.columns.total', { defaultValue: 'Total' })}
                  </span>
                  <span role="columnheader">
                    {t('usage.columns.success_rate', { defaultValue: 'Rate' })}
                  </span>
                  <span role="columnheader">
                    {t('usage.columns.trend', { defaultValue: 'Trend' })}
                  </span>
                </div>

                {filteredRows.map((row) => (
                  <div className={styles.dataRow} role="row" key={row.id}>
                    <div className={styles.providerCell} role="cell">
                      <span
                        className={[styles.statusDot, styles[row.status]].join(' ')}
                        aria-hidden="true"
                      />
                      <span className={styles.providerName}>{row.provider}</span>
                      <span className={styles.sourceBadge}>
                        {row.source === 'auth_file'
                          ? t('usage.source.auth_file', { defaultValue: 'Auth' })
                          : t('usage.source.api_key', { defaultValue: 'Key' })}
                      </span>
                      <span className={[styles.statusBadge, styles[row.status]].join(' ')}>
                        {t(`usage.status.${row.status}`, {
                          defaultValue: row.status,
                        })}
                      </span>
                    </div>
                    <div className={styles.urlCell} role="cell" title={row.baseUrl || '-'}>
                      {row.baseUrl || '-'}
                    </div>
                    <div className={styles.keyCell} role="cell" title={row.maskedApiKey}>
                      {row.maskedApiKey}
                    </div>
                    <div
                      className={styles.numberCell}
                      role="cell"
                      data-label={t('usage.columns.success', { defaultValue: 'Success' })}
                    >
                      {formatNumber(row.success)}
                    </div>
                    <div
                      className={styles.numberCell}
                      role="cell"
                      data-label={t('usage.columns.failed', { defaultValue: 'Failed' })}
                    >
                      {formatNumber(row.failed)}
                    </div>
                    <div
                      className={styles.numberCell}
                      role="cell"
                      data-label={t('usage.columns.total', { defaultValue: 'Total' })}
                    >
                      {formatNumber(row.total)}
                    </div>
                    <div
                      className={styles.rateCell}
                      role="cell"
                      data-label={t('usage.columns.success_rate', { defaultValue: 'Rate' })}
                    >
                      <span>{formatPercent(row.successRate)}</span>
                      <span className={styles.rateTrack} aria-hidden="true">
                        <span
                          style={{ width: `${Math.min(100, Math.max(0, row.successRate))}%` }}
                        />
                      </span>
                    </div>
                    <div className={styles.trendCell} role="cell">
                      {row.trendBlocks.map((block, index) => (
                        <span
                          key={`${row.id}-${index}`}
                          className={[styles.trendBlock, styles[block]].join(' ')}
                          title={t('usage.trend_block_title', {
                            index: index + 1,
                            state: block,
                            defaultValue: 'Bucket {{index}}: {{state}}',
                          })}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {tracesError && <div className={styles.errorBox}>{tracesError}</div>}
            <div className={styles.filters}>
              <div className={styles.searchWrap}>
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t('usage.trace_search_placeholder', {
                    defaultValue: 'Search request, credential, reason, or summary',
                  })}
                  className={styles.searchInput}
                  rightElement={<IconSearch size={16} className={styles.searchIcon} />}
                />
              </div>
              <div className={styles.selectWrap}>
                <span className={styles.filterLabel}>
                  {t('usage.filters.provider', { defaultValue: 'Provider' })}
                </span>
                <Select
                  value={traceProviderFilter}
                  options={traceProviderOptions}
                  onChange={setTraceProviderFilter}
                  ariaLabel={t('usage.filters.provider', { defaultValue: 'Provider' })}
                />
              </div>
              <div className={styles.selectWrap}>
                <span className={styles.filterLabel}>
                  {t('usage.filters.status', { defaultValue: 'Status' })}
                </span>
                <Select
                  value={traceStatusFilter}
                  options={traceStatusOptions}
                  onChange={(value) =>
                    setTraceStatusFilter(value as RequestTraceStatus | typeof ALL_VALUE)
                  }
                  ariaLabel={t('usage.filters.status', { defaultValue: 'Status' })}
                />
              </div>
              <label className={styles.failedOnly}>
                <input
                  type="checkbox"
                  checked={traceAutoRefresh}
                  onChange={(event) => setTraceAutoRefresh(event.target.checked)}
                />
                <span>{t('usage.trace_auto_refresh', { defaultValue: 'Poll refresh' })}</span>
              </label>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadTraces()}
                loading={tracesLoading}
                disabled={disableControls}
              >
                <span className={styles.buttonContent}>
                  <IconRefreshCw size={15} />
                  {t('common.refresh', { defaultValue: 'Refresh' })}
                </span>
              </Button>
            </div>

            <div className={styles.tableHeader}>
              <span className={styles.tableTitle}>
                <IconSlidersHorizontal size={16} />
                {t('usage.trace_results', {
                  count: filteredTraces.length,
                  total: traces.length,
                  defaultValue: '{{count}} / {{total}} traces',
                })}
              </span>
            </div>

            {tracesLoading && traces.length === 0 ? (
              <div className={styles.loadingState}>
                {t('common.loading', { defaultValue: 'Loading...' })}
              </div>
            ) : filteredTraces.length === 0 ? (
              <EmptyState
                title={t('usage.trace_empty_title', { defaultValue: 'No request traces' })}
                description={t('usage.trace_empty_desc', {
                  defaultValue: 'Request trace records will appear after traffic is captured.',
                })}
              />
            ) : (
              <div
                className={`${styles.table} ${styles.traceTable}`}
                role="table"
                aria-label={t('usage.views.traces', { defaultValue: 'Request traces' })}
              >
                <div className={`${styles.headRow} ${styles.traceHeadRow}`} role="row">
                  <span role="columnheader">request_id</span>
                  <span role="columnheader">
                    {t('usage.columns.credential', { defaultValue: 'Credential' })}
                  </span>
                  <span role="columnheader">
                    {t('usage.trace_retry_order', { defaultValue: 'Retry order' })}
                  </span>
                  <span role="columnheader">
                    {t('usage.filters.status', { defaultValue: 'Status' })}
                  </span>
                  <span role="columnheader">
                    {t('usage.trace_duration', { defaultValue: 'Duration' })}
                  </span>
                  <span role="columnheader">
                    {t('usage.trace_request_summary', { defaultValue: 'Request' })}
                  </span>
                  <span role="columnheader">
                    {t('usage.trace_response_summary', { defaultValue: 'Response' })}
                  </span>
                  <span role="columnheader" />
                </div>
                {filteredTraces.map((trace) => (
                  <div
                    className={`${styles.dataRow} ${styles.traceDataRow}`}
                    role="row"
                    key={trace.id}
                  >
                    <div className={styles.keyCell} role="cell" title={trace.requestId}>
                      {trace.requestId || '-'}
                    </div>
                    <div
                      className={styles.keyCell}
                      role="cell"
                      title={trace.credentialId || trace.authId}
                    >
                      {trace.credentialId || trace.authId || '-'}
                    </div>
                    <div
                      className={styles.urlCell}
                      role="cell"
                      title={trace.retryCredentialOrder.join(' -> ')}
                    >
                      {trace.retryCredentialOrder.length
                        ? trace.retryCredentialOrder.join(' -> ')
                        : '-'}
                    </div>
                    <div className={styles.providerCell} role="cell">
                      <span className={[styles.statusDot, styles[trace.status]].join(' ')} />
                      <span className={[styles.statusBadge, styles[trace.status]].join(' ')}>
                        {t(`usage.status.${trace.status}`, { defaultValue: trace.status })}
                      </span>
                    </div>
                    <div className={styles.numberCell} role="cell">
                      {formatDuration(trace.durationMs)}
                    </div>
                    <div className={styles.urlCell} role="cell" title={trace.requestSummary}>
                      {trace.requestSummary || '-'}
                    </div>
                    <div
                      className={styles.urlCell}
                      role="cell"
                      title={trace.failureReason || trace.responseSummary}
                    >
                      {trace.failureReason || trace.responseSummary || '-'}
                    </div>
                    <div className={styles.providerCell} role="cell">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void openTraceDetail(trace)}
                      >
                        {t('common.view', { defaultValue: 'View' })}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      <Modal
        open={Boolean(selectedTrace)}
        title={
          selectedTrace?.requestId ||
          t('usage.trace_detail_title', { defaultValue: 'Trace detail' })
        }
        onClose={() => setSelectedTrace(null)}
        width={1040}
      >
        {selectedTrace && traceRequestPayload && traceResponsePayload && (
          <div className={styles.traceDetail}>
            {traceDetailLoading && (
              <div className={styles.loadingState}>
                {t('common.loading', { defaultValue: 'Loading...' })}
              </div>
            )}
            <div className={styles.traceOverviewGrid}>
              <div className={styles.traceOverviewItem}>
                <span>request_id</span>
                <strong>{selectedTrace.requestId || '-'}</strong>
              </div>
              <div className={styles.traceOverviewItem}>
                <span>{t('usage.columns.provider', { defaultValue: 'Provider' })}</span>
                <strong>{selectedTrace.provider || '-'}</strong>
              </div>
              <div className={styles.traceOverviewItem}>
                <span>{t('usage.columns.credential', { defaultValue: 'Credential' })}</span>
                <strong>{selectedTrace.credentialId || selectedTrace.authId || '-'}</strong>
              </div>
              <div className={styles.traceOverviewItem}>
                <span>{t('usage.filters.status', { defaultValue: 'Status' })}</span>
                <strong>
                  <span className={`${styles.statusBadge} ${styles[selectedTrace.status] ?? ''}`}>
                    {t(`usage.status.${selectedTrace.status}`, {
                      defaultValue: selectedTrace.status,
                    })}
                  </span>
                </strong>
              </div>
              <div className={styles.traceOverviewItem}>
                <span>{t('usage.trace_status_code', { defaultValue: 'Status code' })}</span>
                <strong>{selectedTrace.responseStatus ?? selectedTrace.statusCode ?? '-'}</strong>
              </div>
              <div className={styles.traceOverviewItem}>
                <span>{t('usage.trace_duration', { defaultValue: 'Duration' })}</span>
                <strong>{formatDuration(selectedTrace.durationMs)}</strong>
              </div>
              <div className={styles.traceOverviewItem}>
                <span>{t('usage.trace_time', { defaultValue: 'Time' })}</span>
                <strong>{formatTraceTime(selectedTrace.createdAt)}</strong>
              </div>
              <div className={styles.traceOverviewItem}>
                <span>{t('usage.trace_endpoint', { defaultValue: 'Endpoint' })}</span>
                <strong>
                  {[selectedTrace.method, selectedTrace.path].filter(Boolean).join(' ') ||
                    selectedTrace.requestSummary ||
                    '-'}
                </strong>
              </div>
            </div>

            <section className={styles.traceSection}>
              <div className={styles.traceSectionHeader}>
                <div>
                  <span className={styles.traceSectionEyebrow}>attempts</span>
                  <h3>{t('usage.trace_attempts', { defaultValue: 'Retry attempts' })}</h3>
                </div>
                {selectedTrace.retryCredentialOrder.length > 0 && (
                  <div className={styles.traceRetryOrder}>
                    {selectedTrace.retryCredentialOrder.map((credential, index) => (
                      <span key={`${credential}-${index}`}>{credential}</span>
                    ))}
                  </div>
                )}
              </div>
              {selectedTrace.attempts && selectedTrace.attempts.length > 0 ? (
                <div className={styles.traceAttemptList}>
                  {selectedTrace.attempts.map((attempt, index) => {
                    const statusKind = getAttemptStatusKind(attempt);
                    const retryAfter = getAttemptRetryAfter(attempt);

                    return (
                      <div
                        className={styles.traceAttemptRow}
                        key={`${attempt.sequence}-${getAttemptCredential(attempt)}-${index}`}
                      >
                        <div className={styles.traceAttemptSeq}>
                          #{attempt.sequence || index + 1}
                        </div>
                        <div className={styles.traceAttemptMain}>
                          <strong>{getAttemptCredential(attempt)}</strong>
                          <span>
                            {attempt.provider || selectedTrace.provider || '-'}
                            {attempt.model ? ` / ${attempt.model}` : ''}
                            {attempt.upstreamModel || attempt.upstream_model
                              ? ` -> ${attempt.upstreamModel || attempt.upstream_model}`
                              : ''}
                          </span>
                        </div>
                        <div className={styles.traceAttemptMeta}>
                          <span
                            className={`${styles.traceAttemptStatus} ${
                              statusKind === 'success'
                                ? styles.traceAttemptStatusSuccess
                                : statusKind === 'failure'
                                  ? styles.traceAttemptStatusFailure
                                  : styles.traceAttemptStatusPending
                            }`}
                          >
                            {t(`usage.status.${statusKind}`, { defaultValue: statusKind })}
                          </span>
                          <span>{getAttemptStatusCode(attempt) ?? '-'}</span>
                          <span>{formatDuration(getAttemptDuration(attempt))}</span>
                        </div>
                        {(attempt.error || retryAfter !== null) && (
                          <div className={styles.traceAttemptError}>
                            {attempt.error || '-'}
                            {retryAfter !== null && (
                              <span>
                                {t('usage.trace_retry_after', {
                                  defaultValue: 'Retry after {{seconds}}s',
                                  seconds: retryAfter,
                                })}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.traceDetailEmpty}>
                  {t('usage.trace_attempts_empty', {
                    defaultValue: 'No retry attempt details were recorded.',
                  })}
                </div>
              )}
            </section>

            <div className={styles.tracePayloadGrid}>
              <section className={styles.tracePayloadBlock}>
                <div className={styles.tracePayloadHeader}>
                  <div>
                    <span className={styles.traceSectionEyebrow}>request</span>
                    <h3>{t('usage.trace_raw_request', { defaultValue: 'Raw request' })}</h3>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!traceRequestPayload.hasContent}
                    onClick={() => void copyTracePayload(traceRequestPayload)}
                    className={styles.tracePayloadButton}
                  >
                    <span className={styles.buttonContent}>
                      <IconCopy size={14} />
                      {t('usage.trace_copy_request', { defaultValue: 'Copy raw request' })}
                    </span>
                  </Button>
                </div>
                <div className={styles.tracePayloadMeta}>
                  <span>
                    {t('usage.trace_size', { defaultValue: 'Size' })}:{' '}
                    {formatPayloadSize(traceRequestPayload.size)}
                  </span>
                  {traceRequestPayload.truncated && (
                    <span>{t('usage.trace_truncated', { defaultValue: 'Truncated' })}</span>
                  )}
                </div>
                <pre className={styles.tracePayloadCode}>{traceRequestPayload.displayText}</pre>
              </section>

              <section className={styles.tracePayloadBlock}>
                <div className={styles.tracePayloadHeader}>
                  <div>
                    <span className={styles.traceSectionEyebrow}>response</span>
                    <h3>{t('usage.trace_raw_response', { defaultValue: 'Raw response' })}</h3>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!traceResponsePayload.hasContent}
                    onClick={() => void copyTracePayload(traceResponsePayload)}
                    className={styles.tracePayloadButton}
                  >
                    <span className={styles.buttonContent}>
                      <IconCopy size={14} />
                      {t('usage.trace_copy_response', { defaultValue: 'Copy raw response' })}
                    </span>
                  </Button>
                </div>
                <div className={styles.tracePayloadMeta}>
                  <span>
                    {t('usage.trace_size', { defaultValue: 'Size' })}:{' '}
                    {formatPayloadSize(traceResponsePayload.size)}
                  </span>
                  {traceResponsePayload.truncated && (
                    <span>{t('usage.trace_truncated', { defaultValue: 'Truncated' })}</span>
                  )}
                </div>
                <pre className={styles.tracePayloadCode}>{traceResponsePayload.displayText}</pre>
              </section>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

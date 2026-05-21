import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select, type SelectOption } from '@/components/ui/Select';
import {
  IconChartLine,
  IconRefreshCw,
  IconSearch,
  IconSlidersHorizontal,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiKeyUsageApi } from '@/services/api';
import { useAuthStore } from '@/stores';
import {
  normalizeRecentRequestUsageEntry,
  statusBarDataFromRecentRequests,
  type ApiKeyUsageResponse,
  type RecentRequestUsageEntry,
  type StatusBlockState,
} from '@/utils/recentRequests';
import styles from './UsagePage.module.scss';

type UsageStatus = 'success' | 'failure' | 'mixed' | 'idle';
type SortKey = 'total' | 'failed' | 'successRate' | 'provider';

interface UsageRow {
  id: string;
  provider: string;
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

const formatNumber = (value: number): string => new Intl.NumberFormat().format(value);

const formatPercent = (value: number): string => `${value.toFixed(1)}%`;

export function UsagePage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [providerFilter, setProviderFilter] = useState(ALL_VALUE);
  const [statusFilter, setStatusFilter] = useState<UsageStatus | typeof ALL_VALUE>(ALL_VALUE);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('total');

  const disableControls = connectionStatus !== 'connected';

  const loadUsage = useCallback(async () => {
    if (disableControls) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const payload = await apiKeyUsageApi.getUsage();
      setRows(buildUsageRows(payload));
    } catch (err: unknown) {
      setError(
        getErrorMessage(err, t('notification.refresh_failed', { defaultValue: 'Refresh failed' }))
      );
    } finally {
      setLoading(false);
    }
  }, [disableControls, t]);

  useHeaderRefresh(loadUsage);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

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
          onClick={() => void loadUsage()}
          loading={loading}
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
        <div className={styles.filters}>
          <div className={styles.searchWrap}>
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('usage.search_placeholder', {
                defaultValue: 'Search base_url or API key',
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
              defaultValue: 'Usage statistics will appear after API keys receive traffic.',
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
                {t('usage.columns.base_url', { defaultValue: 'base_url' })}
              </span>
              <span role="columnheader">
                {t('usage.columns.api_key', { defaultValue: 'API key' })}
              </span>
              <span role="columnheader">
                {t('usage.columns.success', { defaultValue: 'Success' })}
              </span>
              <span role="columnheader">
                {t('usage.columns.failed', { defaultValue: 'Failed' })}
              </span>
              <span role="columnheader">{t('usage.columns.total', { defaultValue: 'Total' })}</span>
              <span role="columnheader">
                {t('usage.columns.success_rate', { defaultValue: 'Rate' })}
              </span>
              <span role="columnheader">{t('usage.columns.trend', { defaultValue: 'Trend' })}</span>
            </div>

            {filteredRows.map((row) => (
              <div className={styles.dataRow} role="row" key={row.id}>
                <div className={styles.providerCell} role="cell">
                  <span
                    className={[styles.statusDot, styles[row.status]].join(' ')}
                    aria-hidden="true"
                  />
                  <span className={styles.providerName}>{row.provider}</span>
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
                    <span style={{ width: `${Math.min(100, Math.max(0, row.successRate))}%` }} />
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
      </Card>
    </div>
  );
}

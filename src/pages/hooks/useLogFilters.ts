import { useEffect, useMemo } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import type { HttpMethod, LogLevel, ParsedLogLine, StatusGroup } from './logTypes';
import { resolveStatusGroup } from './logTypes';

const PATH_FILTER_LIMIT = 12;

interface UseLogFiltersOptions {
  parsedLines: ParsedLogLine[];
}

interface UseLogFiltersReturn {
  methodFilters: HttpMethod[];
  statusFilters: StatusGroup[];
  pathFilters: string[];
  levelFilters: LogLevel[];
  requestIdFilter: string;
  ipFilter: string;
  sourceFilter: string;
  onlyErrors: boolean;
  methodFilterSet: Set<HttpMethod>;
  statusFilterSet: Set<StatusGroup>;
  pathFilterSet: Set<string>;
  levelFilterSet: Set<LogLevel>;
  hasStructuredFilters: boolean;
  methodCounts: Partial<Record<HttpMethod, number>>;
  statusCounts: Partial<Record<StatusGroup, number>>;
  levelCounts: Partial<Record<LogLevel, number>>;
  pathOptions: Array<{ path: string; count: number }>;
  sourceOptions: Array<{ source: string; count: number }>;
  toggleMethodFilter: (method: HttpMethod) => void;
  toggleStatusFilter: (group: StatusGroup) => void;
  togglePathFilter: (path: string) => void;
  toggleLevelFilter: (level: LogLevel) => void;
  setRequestIdFilter: (value: string) => void;
  setIpFilter: (value: string) => void;
  setSourceFilter: (value: string) => void;
  setOnlyErrors: (value: boolean) => void;
  clearStructuredFilters: () => void;
}

export function useLogFilters(options: UseLogFiltersOptions): UseLogFiltersReturn {
  const { parsedLines } = options;

  const [methodFilters, setMethodFilters] = useLocalStorage<HttpMethod[]>(
    'logsPage.methodFilters',
    []
  );
  const [statusFilters, setStatusFilters] = useLocalStorage<StatusGroup[]>(
    'logsPage.statusFilters',
    []
  );
  const [pathFilters, setPathFilters] = useLocalStorage<string[]>('logsPage.pathFilters', []);
  const [levelFilters, setLevelFilters] = useLocalStorage<LogLevel[]>(
    'logsPage.levelFilters',
    []
  );
  const [requestIdFilter, setRequestIdFilter] = useLocalStorage('logsPage.requestIdFilter', '');
  const [ipFilter, setIpFilter] = useLocalStorage('logsPage.ipFilter', '');
  const [sourceFilter, setSourceFilter] = useLocalStorage('logsPage.sourceFilter', '');
  const [onlyErrors, setOnlyErrors] = useLocalStorage('logsPage.onlyErrors', false);

  const methodFilterSet = useMemo(() => new Set(methodFilters), [methodFilters]);
  const statusFilterSet = useMemo(() => new Set(statusFilters), [statusFilters]);
  const pathFilterSet = useMemo(() => new Set(pathFilters), [pathFilters]);
  const levelFilterSet = useMemo(() => new Set(levelFilters), [levelFilters]);
  const hasStructuredFilters =
    methodFilters.length > 0 ||
    statusFilters.length > 0 ||
    pathFilters.length > 0 ||
    levelFilters.length > 0 ||
    requestIdFilter.trim().length > 0 ||
    ipFilter.trim().length > 0 ||
    sourceFilter.trim().length > 0 ||
    onlyErrors;

  const methodCounts = useMemo(() => {
    const counts: Partial<Record<HttpMethod, number>> = {};
    parsedLines.forEach((line) => {
      if (!line.method) return;
      counts[line.method] = (counts[line.method] ?? 0) + 1;
    });
    return counts;
  }, [parsedLines]);

  const statusCounts = useMemo(() => {
    const counts: Partial<Record<StatusGroup, number>> = {};
    parsedLines.forEach((line) => {
      const statusGroup = resolveStatusGroup(line.statusCode);
      if (!statusGroup) return;
      counts[statusGroup] = (counts[statusGroup] ?? 0) + 1;
    });
    return counts;
  }, [parsedLines]);

  const levelCounts = useMemo(() => {
    const counts: Partial<Record<LogLevel, number>> = {};
    parsedLines.forEach((line) => {
      if (!line.level) return;
      counts[line.level] = (counts[line.level] ?? 0) + 1;
    });
    return counts;
  }, [parsedLines]);

  const pathOptions = useMemo(() => {
    const counts = new Map<string, number>();
    parsedLines.forEach((line) => {
      if (!line.path) return;
      counts.set(line.path, (counts.get(line.path) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, PATH_FILTER_LIMIT)
      .map(([path, count]) => ({ path, count }));
  }, [parsedLines]);

  const sourceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    parsedLines.forEach((line) => {
      if (!line.source) return;
      counts.set(line.source, (counts.get(line.source) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, PATH_FILTER_LIMIT)
      .map(([source, count]) => ({ source, count }));
  }, [parsedLines]);

  useEffect(() => {
    if (parsedLines.length === 0) return;

    const validPathSet = new Set(pathOptions.map((item) => item.path));
    setPathFilters((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((path) => validPathSet.has(path));
      return next.length === prev.length ? prev : next;
    });
  }, [parsedLines.length, pathOptions, setPathFilters]);

  const toggleMethodFilter = (method: HttpMethod) => {
    setMethodFilters((prev) =>
      prev.includes(method) ? prev.filter((item) => item !== method) : [...prev, method]
    );
  };

  const toggleStatusFilter = (group: StatusGroup) => {
    setStatusFilters((prev) =>
      prev.includes(group) ? prev.filter((item) => item !== group) : [...prev, group]
    );
  };

  const togglePathFilter = (path: string) => {
    setPathFilters((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]
    );
  };

  const toggleLevelFilter = (level: LogLevel) => {
    setLevelFilters((prev) =>
      prev.includes(level) ? prev.filter((item) => item !== level) : [...prev, level]
    );
  };

  const clearStructuredFilters = () => {
    setMethodFilters([]);
    setStatusFilters([]);
    setPathFilters([]);
    setLevelFilters([]);
    setRequestIdFilter('');
    setIpFilter('');
    setSourceFilter('');
    setOnlyErrors(false);
  };

  return {
    methodFilters,
    statusFilters,
    pathFilters,
    levelFilters,
    requestIdFilter,
    ipFilter,
    sourceFilter,
    onlyErrors,
    methodFilterSet,
    statusFilterSet,
    pathFilterSet,
    levelFilterSet,
    hasStructuredFilters,
    methodCounts,
    statusCounts,
    levelCounts,
    pathOptions,
    sourceOptions,
    toggleMethodFilter,
    toggleStatusFilter,
    togglePathFilter,
    toggleLevelFilter,
    setRequestIdFilter,
    setIpFilter,
    setSourceFilter,
    setOnlyErrors,
    clearStructuredFilters,
  };
}

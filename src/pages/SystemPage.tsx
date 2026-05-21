import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconGithub, IconBookOpen, IconExternalLink, IconCode } from '@/components/ui/icons';
import {
  useAuthStore,
  useConfigStore,
  useNotificationStore,
  useModelsStore,
  useThemeStore,
} from '@/stores';
import { configApi, versionApi } from '@/services/api';
import { apiKeysApi } from '@/services/api/apiKeys';
import type { RawConfigSection } from '@/types/config';
import { classifyModels } from '@/utils/models';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import iconGemini from '@/assets/icons/gemini.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconGlm from '@/assets/icons/glm.svg';
import iconGrok from '@/assets/icons/grok.svg';
import iconGrokDark from '@/assets/icons/grok-dark.svg';
import iconDeepseek from '@/assets/icons/deepseek.svg';
import iconMinimax from '@/assets/icons/minimax.svg';
import styles from './SystemPage.module.scss';

const MODEL_CATEGORY_ICONS: Record<string, string | { light: string; dark: string }> = {
  gpt: { light: iconOpenaiLight, dark: iconOpenaiDark },
  claude: iconClaude,
  gemini: iconGemini,
  qwen: iconQwen,
  kimi: { light: iconKimiLight, dark: iconKimiDark },
  glm: iconGlm,
  grok: { light: iconGrok, dark: iconGrokDark },
  deepseek: iconDeepseek,
  minimax: iconMinimax,
};

const parseVersionSegments = (version?: string | null) => {
  if (!version) return null;
  const cleaned = version.trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const parts = cleaned
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);
  return parts.length ? parts : null;
};

const compareVersions = (latest?: string | null, current?: string | null) => {
  const latestParts = parseVersionSegments(latest);
  const currentParts = parseVersionSegments(current);
  if (!latestParts || !currentParts) return null;
  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return 1;
    if (l < c) return -1;
  }
  return 0;
};

type OperationKey = 'config-cache' | 'model-cache' | 'version-check' | 'clear-login';

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

export function SystemPage() {
  const { t, i18n } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const auth = useAuthStore();
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const [modelStatus, setModelStatus] = useState<{
    type: 'success' | 'warning' | 'error' | 'muted';
    message: string;
  }>();
  const [requestLogModalOpen, setRequestLogModalOpen] = useState(false);
  const [requestLogDraft, setRequestLogDraft] = useState(false);
  const [requestLogTouched, setRequestLogTouched] = useState(false);
  const [requestLogSaving, setRequestLogSaving] = useState(false);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [savingSettings, setSavingSettings] = useState<Partial<Record<RawConfigSection, boolean>>>(
    {}
  );
  const [runningOperations, setRunningOperations] = useState<
    Partial<Record<OperationKey, boolean>>
  >({});
  const [requestRetryInput, setRequestRetryInput] = useState('');
  const [logsMaxSizeInput, setLogsMaxSizeInput] = useState('');

  const apiKeysCache = useRef<string[]>([]);
  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const otherLabel = useMemo(
    () => (i18n.language?.toLowerCase().startsWith('zh') ? '其他' : 'Other'),
    [i18n.language]
  );
  const groupedModels = useMemo(() => classifyModels(models, { otherLabel }), [models, otherLabel]);
  const requestLogEnabled = config?.requestLog ?? false;
  const requestLogDirty = requestLogDraft !== requestLogEnabled;
  const canEditRequestLog = auth.connectionStatus === 'connected' && Boolean(config);
  const canEditSettings = auth.connectionStatus === 'connected' && Boolean(config);

  const appVersion = __APP_VERSION__ || t('system_info.version_unknown');
  const apiVersion = auth.serverVersion || t('system_info.version_unknown');
  const buildTime = auth.serverBuildDate
    ? new Date(auth.serverBuildDate).toLocaleString(i18n.language)
    : t('system_info.version_unknown');

  const getIconForCategory = (categoryId: string): string | null => {
    const iconEntry = MODEL_CATEGORY_ICONS[categoryId];
    if (!iconEntry) return null;
    if (typeof iconEntry === 'string') return iconEntry;
    return resolvedTheme === 'dark' ? iconEntry.dark : iconEntry.light;
  };

  const routingOptions = useMemo(
    () => [
      {
        value: 'round-robin',
        label: t('basic_settings.routing_strategy_round_robin', {
          defaultValue: 'round-robin (cycle)',
        }),
      },
      {
        value: 'fill-first',
        label: t('basic_settings.routing_strategy_fill_first', {
          defaultValue: 'fill-first (prioritize)',
        }),
      },
    ],
    [t]
  );

  const normalizeApiKeyList = (input: unknown): string[] => {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const keys: string[] = [];

    input.forEach((item) => {
      const record =
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null;
      const value =
        typeof item === 'string'
          ? item
          : record
            ? (record['api-key'] ?? record['apiKey'] ?? record.key ?? record.Key)
            : '';
      const trimmed = String(value ?? '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      keys.push(trimmed);
    });

    return keys;
  };

  const resolveApiKeysForModels = useCallback(async () => {
    if (apiKeysCache.current.length) {
      return apiKeysCache.current;
    }

    const configKeys = normalizeApiKeyList(config?.apiKeys);
    if (configKeys.length) {
      apiKeysCache.current = configKeys;
      return configKeys;
    }

    try {
      const list = await apiKeysApi.list();
      const normalized = normalizeApiKeyList(list);
      if (normalized.length) {
        apiKeysCache.current = normalized;
      }
      return normalized;
    } catch (err) {
      console.warn('Auto loading API keys for models failed:', err);
      return [];
    }
  }, [config?.apiKeys]);

  const fetchModels = async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
    if (auth.connectionStatus !== 'connected') {
      setModelStatus({
        type: 'warning',
        message: t('notification.connection_required'),
      });
      return false;
    }

    if (!auth.apiBase) {
      showNotification(t('notification.connection_required'), 'warning');
      return false;
    }

    if (forceRefresh) {
      apiKeysCache.current = [];
    }

    setModelStatus({ type: 'muted', message: t('system_info.models_loading') });
    try {
      const apiKeys = await resolveApiKeysForModels();
      const primaryKey = apiKeys[0];
      const list = await fetchModelsFromStore(auth.apiBase, primaryKey, forceRefresh);
      const hasModels = list.length > 0;
      setModelStatus({
        type: hasModels ? 'success' : 'warning',
        message: hasModels
          ? t('system_info.models_count', { count: list.length })
          : t('system_info.models_empty'),
      });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      const suffix = message ? `: ${message}` : '';
      const text = `${t('system_info.models_error')}${suffix}`;
      setModelStatus({ type: 'error', message: text });
      return false;
    }
  };

  const setSettingSaving = (section: RawConfigSection, value: boolean) => {
    setSavingSettings((prev) => ({ ...prev, [section]: value }));
  };

  const setOperationRunning = (operation: OperationKey, value: boolean) => {
    setRunningOperations((prev) => ({ ...prev, [operation]: value }));
  };

  const saveConfigValue = useCallback(
    async (
      section: RawConfigSection,
      value: boolean | number | string,
      previousValue: unknown,
      request: () => Promise<unknown>,
      successMessage: string
    ) => {
      if (!canEditSettings) {
        showNotification(t('notification.connection_required'), 'warning');
        return;
      }

      setSettingSaving(section, true);
      updateConfigValue(section, value);

      try {
        await request();
        clearCache(section);
        await fetchConfig(section, true);
        showNotification(successMessage, 'success');
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        updateConfigValue(section, previousValue);
        showNotification(
          `${t('notification.update_failed')}${message ? `: ${message}` : ''}`,
          'error'
        );
      } finally {
        setSettingSaving(section, false);
      }
    },
    [canEditSettings, clearCache, fetchConfig, showNotification, t, updateConfigValue]
  );

  const handleBooleanSettingChange = (
    section: RawConfigSection,
    value: boolean,
    previousValue: boolean | undefined,
    request: (enabled: boolean) => Promise<unknown>,
    successMessage: string
  ) => {
    void saveConfigValue(section, value, previousValue, () => request(value), successMessage);
  };

  const handleRequestRetrySave = () => {
    const retryCount = Number(requestRetryInput);
    if (!Number.isInteger(retryCount) || retryCount < 0) {
      showNotification(
        t('system_info.invalid_non_negative_integer', {
          defaultValue: 'Please enter a non-negative integer.',
        }),
        'warning'
      );
      return;
    }

    void saveConfigValue(
      'request-retry',
      retryCount,
      config?.requestRetry,
      () => configApi.updateRequestRetry(retryCount),
      t('system_info.request_retry_updated', { defaultValue: 'Request retry updated' })
    );
  };

  const handleLogsMaxSizeSave = () => {
    const sizeMb = Number(logsMaxSizeInput);
    if (!Number.isInteger(sizeMb) || sizeMb < 0) {
      showNotification(
        t('system_info.invalid_non_negative_integer', {
          defaultValue: 'Please enter a non-negative integer.',
        }),
        'warning'
      );
      return;
    }

    void saveConfigValue(
      'logs-max-total-size-mb',
      sizeMb,
      config?.logsMaxTotalSizeMb,
      () => configApi.updateLogsMaxTotalSizeMb(sizeMb),
      t('system_info.logs_max_size_updated', { defaultValue: 'Log size limit updated' })
    );
  };

  const handleRoutingStrategyChange = (value: string) => {
    void saveConfigValue(
      'routing/strategy',
      value,
      config?.routingStrategy,
      () => configApi.updateRoutingStrategy(value),
      t('basic_settings.routing_strategy_updated', {
        defaultValue: 'Routing strategy updated',
      })
    );
  };

  const handleRefreshConfigCache = async () => {
    if (auth.connectionStatus !== 'connected') {
      showNotification(t('notification.connection_required'), 'warning');
      return;
    }

    setOperationRunning('config-cache', true);
    try {
      clearCache();
      await fetchConfig(undefined, true);
      showNotification(
        t('system_info.config_cache_refreshed', { defaultValue: 'Configuration cache refreshed' }),
        'success'
      );
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      showNotification(
        `${t('system_info.config_cache_refresh_failed', {
          defaultValue: 'Failed to refresh configuration cache',
        })}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setOperationRunning('config-cache', false);
    }
  };

  const handleRefreshModelCache = async () => {
    setOperationRunning('model-cache', true);
    try {
      const refreshed = await fetchModels({ forceRefresh: true });
      if (refreshed) {
        showNotification(
          t('system_info.model_cache_refreshed', { defaultValue: 'Model cache refreshed' }),
          'success'
        );
      }
    } finally {
      setOperationRunning('model-cache', false);
    }
  };

  const handleClearLoginStorage = () => {
    showConfirmation({
      title: t('system_info.clear_login_title', { defaultValue: 'Clear Login Storage' }),
      message: t('system_info.clear_login_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: () => {
        setOperationRunning('clear-login', true);
        auth.logout();
        try {
          if (typeof localStorage !== 'undefined') {
            const keysToRemove = [
              STORAGE_KEY_AUTH,
              'isLoggedIn',
              'apiBase',
              'apiUrl',
              'managementKey',
            ];
            keysToRemove.forEach((key) => localStorage.removeItem(key));
          }
          showNotification(t('notification.login_storage_cleared'), 'success');
        } finally {
          setOperationRunning('clear-login', false);
        }
      },
    });
  };

  const openRequestLogModal = useCallback(() => {
    setRequestLogTouched(false);
    setRequestLogDraft(requestLogEnabled);
    setRequestLogModalOpen(true);
  }, [requestLogEnabled]);

  const handleInfoVersionTap = useCallback(() => {
    versionTapCount.current += 1;
    if (versionTapTimer.current) {
      clearTimeout(versionTapTimer.current);
    }

    if (versionTapCount.current >= 7) {
      versionTapCount.current = 0;
      versionTapTimer.current = null;
      openRequestLogModal();
      return;
    }

    versionTapTimer.current = setTimeout(() => {
      versionTapCount.current = 0;
      versionTapTimer.current = null;
    }, 1500);
  }, [openRequestLogModal]);

  const handleRequestLogClose = useCallback(() => {
    setRequestLogModalOpen(false);
    setRequestLogTouched(false);
  }, []);

  const handleRequestLogSave = async () => {
    if (!canEditRequestLog) return;
    if (!requestLogDirty) {
      setRequestLogModalOpen(false);
      return;
    }

    const previous = requestLogEnabled;
    setRequestLogSaving(true);
    updateConfigValue('request-log', requestLogDraft);

    try {
      await configApi.updateRequestLog(requestLogDraft);
      clearCache('request-log');
      await fetchConfig('request-log', true);
      showNotification(t('notification.request_log_updated'), 'success');
      setRequestLogModalOpen(false);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      updateConfigValue('request-log', previous);
      showNotification(
        `${t('notification.update_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setRequestLogSaving(false);
    }
  };

  const handleVersionCheck = useCallback(async () => {
    setCheckingVersion(true);
    setOperationRunning('version-check', true);
    try {
      const data = await versionApi.checkLatest();
      const latestRaw = data?.['latest-version'] ?? data?.latest_version ?? data?.latest ?? '';
      const latest = typeof latestRaw === 'string' ? latestRaw : String(latestRaw ?? '');
      const comparison = compareVersions(latest, auth.serverVersion);

      if (!latest) {
        showNotification(t('system_info.version_check_error'), 'error');
        return;
      }

      if (comparison === null) {
        showNotification(t('system_info.version_current_missing'), 'warning');
        return;
      }

      if (comparison > 0) {
        showNotification(t('system_info.version_update_available', { version: latest }), 'warning');
      } else {
        showNotification(t('system_info.version_is_latest'), 'success');
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const suffix = message ? `: ${message}` : '';
      showNotification(`${t('system_info.version_check_error')}${suffix}`, 'error');
    } finally {
      setCheckingVersion(false);
      setOperationRunning('version-check', false);
    }
  }, [auth.serverVersion, showNotification, t]);

  useEffect(() => {
    fetchConfig().catch(() => {
      // ignore
    });
  }, [fetchConfig]);

  useEffect(() => {
    if (requestLogModalOpen && !requestLogTouched) {
      setRequestLogDraft(requestLogEnabled);
    }
  }, [requestLogModalOpen, requestLogTouched, requestLogEnabled]);

  useEffect(() => {
    setRequestRetryInput(String(config?.requestRetry ?? 0));
  }, [config?.requestRetry]);

  useEffect(() => {
    setLogsMaxSizeInput(String(config?.logsMaxTotalSizeMb ?? 0));
  }, [config?.logsMaxTotalSizeMb]);

  useEffect(() => {
    return () => {
      if (versionTapTimer.current) {
        clearTimeout(versionTapTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.connectionStatus, auth.apiBase]);

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('system_info.title')}</h1>
      <div className={styles.content}>
        <Card className={styles.aboutCard}>
          <div className={styles.aboutHeader}>
            <img src={INLINE_LOGO_JPEG} alt="CPAMC" className={styles.aboutLogo} />
            <div className={styles.aboutTitle}>{t('system_info.about_title')}</div>
          </div>

          <div className={styles.aboutInfoGrid}>
            <button
              type="button"
              className={`${styles.infoTile} ${styles.tapTile}`}
              onClick={handleInfoVersionTap}
            >
              <div className={styles.tileHeader}>
                <div className={styles.tileLabel}>{t('footer.version')}</div>
              </div>
              <div className={styles.tileValue}>{appVersion}</div>
            </button>

            <div className={styles.infoTile}>
              <div className={styles.tileHeader}>
                <div className={styles.tileLabel}>{t('footer.api_version')}</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={styles.tileAction}
                  onClick={() => void handleVersionCheck()}
                  loading={checkingVersion}
                  title={t('system_info.version_check_button')}
                  aria-label={t('system_info.version_check_button')}
                >
                  {t('system_info.version_check_button')}
                </Button>
              </div>
              <div className={styles.tileValue}>{apiVersion}</div>
            </div>

            <div className={styles.infoTile}>
              <div className={styles.tileLabel}>{t('footer.build_date')}</div>
              <div className={styles.tileValue}>{buildTime}</div>
            </div>

            <div className={styles.infoTile}>
              <div className={styles.tileLabel}>{t('connection.status')}</div>
              <div className={styles.tileValue}>{t(`common.${auth.connectionStatus}_status`)}</div>
              <div className={styles.tileSub}>{auth.apiBase || '-'}</div>
            </div>
          </div>
        </Card>

        <Card title={t('system_info.quick_settings_title', { defaultValue: 'Quick Settings' })}>
          <p className={styles.sectionDescription}>
            {t('system_info.quick_settings_desc', {
              defaultValue: 'Control common runtime switches and routing behavior.',
            })}
          </p>
          <div className={styles.settingsGrid}>
            <div className={styles.settingRow}>
              <div className={styles.settingMeta}>
                <div className={styles.settingTitle}>
                  {t('basic_settings.debug_mode', { defaultValue: 'Debug Mode' })}
                </div>
                <div className={styles.settingDesc}>
                  {t('system_info.debug_desc', {
                    defaultValue: 'Enable verbose diagnostics for troubleshooting.',
                  })}
                </div>
              </div>
              <ToggleSwitch
                checked={config?.debug ?? false}
                disabled={!canEditSettings || savingSettings.debug}
                ariaLabel={t('basic_settings.debug_mode', { defaultValue: 'Debug Mode' })}
                onChange={(value) =>
                  handleBooleanSettingChange(
                    'debug',
                    value,
                    config?.debug,
                    configApi.updateDebug,
                    t('system_info.debug_updated', { defaultValue: 'Debug mode updated' })
                  )
                }
              />
            </div>

            <div className={styles.settingRow}>
              <div className={styles.settingMeta}>
                <div className={styles.settingTitle}>
                  {t('basic_settings.request_log_title', { defaultValue: 'Request Log' })}
                </div>
                <div className={styles.settingDesc}>
                  {t('system_info.request_log_desc', {
                    defaultValue: 'Capture request details for diagnostics.',
                  })}
                </div>
              </div>
              <ToggleSwitch
                checked={config?.requestLog ?? false}
                disabled={!canEditSettings || savingSettings['request-log']}
                ariaLabel={t('basic_settings.request_log_title', { defaultValue: 'Request Log' })}
                onChange={(value) =>
                  handleBooleanSettingChange(
                    'request-log',
                    value,
                    config?.requestLog,
                    configApi.updateRequestLog,
                    t('notification.request_log_updated', { defaultValue: 'Request log updated' })
                  )
                }
              />
            </div>

            <div className={styles.settingRow}>
              <div className={styles.settingMeta}>
                <div className={styles.settingTitle}>
                  {t('basic_settings.logging_to_file', { defaultValue: 'Logging to File' })}
                </div>
                <div className={styles.settingDesc}>
                  {t('system_info.logging_to_file_desc', {
                    defaultValue: 'Persist runtime logs to server files.',
                  })}
                </div>
              </div>
              <ToggleSwitch
                checked={config?.loggingToFile ?? false}
                disabled={!canEditSettings || savingSettings['logging-to-file']}
                ariaLabel={t('basic_settings.logging_to_file', {
                  defaultValue: 'Logging to File',
                })}
                onChange={(value) =>
                  handleBooleanSettingChange(
                    'logging-to-file',
                    value,
                    config?.loggingToFile,
                    configApi.updateLoggingToFile,
                    t('system_info.logging_to_file_updated', {
                      defaultValue: 'Logging to file updated',
                    })
                  )
                }
              />
            </div>

            <div className={styles.settingRow}>
              <div className={styles.settingMeta}>
                <div className={styles.settingTitle}>
                  {t('basic_settings.ws_auth', { defaultValue: 'WebSocket Auth' })}
                </div>
                <div className={styles.settingDesc}>
                  {t('system_info.ws_auth_desc', {
                    defaultValue: 'Require authentication for WebSocket connections.',
                  })}
                </div>
              </div>
              <ToggleSwitch
                checked={config?.wsAuth ?? false}
                disabled={!canEditSettings || savingSettings['ws-auth']}
                ariaLabel={t('basic_settings.ws_auth', { defaultValue: 'WebSocket Auth' })}
                onChange={(value) =>
                  handleBooleanSettingChange(
                    'ws-auth',
                    value,
                    config?.wsAuth,
                    configApi.updateWsAuth,
                    t('system_info.ws_auth_updated', { defaultValue: 'WebSocket auth updated' })
                  )
                }
              />
            </div>

            <div className={styles.settingRow}>
              <div className={styles.settingMeta}>
                <div className={styles.settingTitle}>
                  {t('basic_settings.force_model_prefix', {
                    defaultValue: 'Force Model Prefix',
                  })}
                </div>
                <div className={styles.settingDesc}>
                  {t('system_info.force_model_prefix_desc', {
                    defaultValue: 'Require provider prefixes in model names.',
                  })}
                </div>
              </div>
              <ToggleSwitch
                checked={config?.forceModelPrefix ?? false}
                disabled={!canEditSettings || savingSettings['force-model-prefix']}
                ariaLabel={t('basic_settings.force_model_prefix', {
                  defaultValue: 'Force Model Prefix',
                })}
                onChange={(value) =>
                  handleBooleanSettingChange(
                    'force-model-prefix',
                    value,
                    config?.forceModelPrefix,
                    configApi.updateForceModelPrefix,
                    t('system_info.force_model_prefix_updated', {
                      defaultValue: 'Force model prefix updated',
                    })
                  )
                }
              />
            </div>

            <div className={styles.settingRow}>
              <div className={styles.settingMeta}>
                <div className={styles.settingTitle}>
                  {t('basic_settings.routing_strategy', { defaultValue: 'Routing Strategy' })}
                </div>
                <div className={styles.settingDesc}>
                  {t('basic_settings.routing_strategy_hint', {
                    defaultValue: 'Select credential selection strategy.',
                  })}
                </div>
              </div>
              <div className={styles.settingControl}>
                <Select
                  value={config?.routingStrategy || 'round-robin'}
                  options={routingOptions}
                  onChange={handleRoutingStrategyChange}
                  disabled={!canEditSettings || savingSettings['routing/strategy']}
                  ariaLabel={t('basic_settings.routing_strategy', {
                    defaultValue: 'Routing Strategy',
                  })}
                />
              </div>
            </div>

            <div className={styles.settingRow}>
              <div className={styles.settingMeta}>
                <div className={styles.settingTitle}>
                  {t('basic_settings.request_retry', { defaultValue: 'Request Retry' })}
                </div>
                <div className={styles.settingDesc}>
                  {t('system_info.request_retry_desc', {
                    defaultValue: 'Retry count for failed upstream requests.',
                  })}
                </div>
              </div>
              <div className={styles.inlineEditor}>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={requestRetryInput}
                  disabled={!canEditSettings || savingSettings['request-retry']}
                  onChange={(event) => setRequestRetryInput(event.target.value)}
                  aria-label={t('basic_settings.request_retry', { defaultValue: 'Request Retry' })}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleRequestRetrySave}
                  loading={savingSettings['request-retry']}
                  disabled={!canEditSettings}
                >
                  {t('common.save')}
                </Button>
              </div>
            </div>

            <div className={styles.settingRow}>
              <div className={styles.settingMeta}>
                <div className={styles.settingTitle}>
                  {t('basic_settings.logs_max_total_size_mb', {
                    defaultValue: 'Max Log Size (MB)',
                  })}
                </div>
                <div className={styles.settingDesc}>
                  {t('system_info.logs_max_size_desc', {
                    defaultValue: 'Maximum total size retained for server log files.',
                  })}
                </div>
              </div>
              <div className={styles.inlineEditor}>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={logsMaxSizeInput}
                  disabled={!canEditSettings || savingSettings['logs-max-total-size-mb']}
                  onChange={(event) => setLogsMaxSizeInput(event.target.value)}
                  aria-label={t('basic_settings.logs_max_total_size_mb', {
                    defaultValue: 'Max Log Size (MB)',
                  })}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleLogsMaxSizeSave}
                  loading={savingSettings['logs-max-total-size-mb']}
                  disabled={!canEditSettings}
                >
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </div>
          {!canEditSettings && (
            <div className={styles.settingsHint}>{t('notification.connection_required')}</div>
          )}
        </Card>

        <Card title={t('system_info.operations_title', { defaultValue: 'Operations' })}>
          <p className={styles.sectionDescription}>
            {t('system_info.operations_desc', {
              defaultValue: 'Refresh server-side state and local session data.',
            })}
          </p>
          <div className={styles.operationGrid}>
            <Button
              variant="secondary"
              onClick={() => void handleRefreshConfigCache()}
              loading={runningOperations['config-cache']}
              disabled={auth.connectionStatus !== 'connected'}
            >
              {t('system_info.refresh_config_cache', {
                defaultValue: 'Refresh Configuration Cache',
              })}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleRefreshModelCache()}
              loading={runningOperations['model-cache'] || modelsLoading}
              disabled={auth.connectionStatus !== 'connected'}
            >
              {t('system_info.refresh_model_cache', { defaultValue: 'Refresh Model Cache' })}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleVersionCheck()}
              loading={runningOperations['version-check'] || checkingVersion}
            >
              {t('system_info.version_check_button', { defaultValue: 'Check Version' })}
            </Button>
            <Button
              variant="danger"
              onClick={handleClearLoginStorage}
              loading={runningOperations['clear-login']}
            >
              {t('system_info.clear_login_button')}
            </Button>
          </div>
        </Card>

        <Card title={t('system_info.quick_links_title')}>
          <p className={styles.sectionDescription}>{t('system_info.quick_links_desc')}</p>
          <div className={styles.quickLinks}>
            <a
              href="https://github.com/router-for-me/CLIProxyAPI"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkCard}
            >
              <div className={`${styles.linkIcon} ${styles.github}`}>
                <IconGithub size={22} />
              </div>
              <div className={styles.linkContent}>
                <div className={styles.linkTitle}>
                  {t('system_info.link_main_repo')}
                  <IconExternalLink size={14} />
                </div>
                <div className={styles.linkDesc}>{t('system_info.link_main_repo_desc')}</div>
              </div>
            </a>

            <a
              href="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkCard}
            >
              <div className={`${styles.linkIcon} ${styles.github}`}>
                <IconCode size={22} />
              </div>
              <div className={styles.linkContent}>
                <div className={styles.linkTitle}>
                  {t('system_info.link_webui_repo')}
                  <IconExternalLink size={14} />
                </div>
                <div className={styles.linkDesc}>{t('system_info.link_webui_repo_desc')}</div>
              </div>
            </a>

            <a
              href="https://help.router-for.me/"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkCard}
            >
              <div className={`${styles.linkIcon} ${styles.docs}`}>
                <IconBookOpen size={22} />
              </div>
              <div className={styles.linkContent}>
                <div className={styles.linkTitle}>
                  {t('system_info.link_docs')}
                  <IconExternalLink size={14} />
                </div>
                <div className={styles.linkDesc}>{t('system_info.link_docs_desc')}</div>
              </div>
            </a>
          </div>
        </Card>

        <Card
          title={t('system_info.models_title')}
          extra={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fetchModels({ forceRefresh: true })}
              loading={modelsLoading}
            >
              {t('common.refresh')}
            </Button>
          }
        >
          <p className={styles.sectionDescription}>{t('system_info.models_desc')}</p>
          {modelStatus && (
            <div className={`status-badge ${modelStatus.type}`}>{modelStatus.message}</div>
          )}
          {modelsError && <div className="error-box">{modelsError}</div>}
          {modelsLoading ? (
            <div className="hint">{t('common.loading')}</div>
          ) : models.length === 0 ? (
            <div className="hint">{t('system_info.models_empty')}</div>
          ) : (
            <div className="item-list">
              {groupedModels.map((group) => {
                const iconSrc = getIconForCategory(group.id);
                return (
                  <div key={group.id} className="item-row">
                    <div className="item-meta">
                      <div className={styles.groupTitle}>
                        {iconSrc && <img src={iconSrc} alt="" className={styles.groupIcon} />}
                        <span className="item-title">{group.label}</span>
                      </div>
                      <div className="item-subtitle">
                        {t('system_info.models_count', { count: group.items.length })}
                      </div>
                    </div>
                    <div className={styles.modelTags}>
                      {group.items.map((model) => (
                        <span
                          key={`${model.name}-${model.alias ?? 'default'}`}
                          className={styles.modelTag}
                          title={model.description || ''}
                        >
                          <span className={styles.modelName}>{model.name}</span>
                          {model.alias && <span className={styles.modelAlias}>{model.alias}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title={t('system_info.clear_login_title')}>
          <p className={styles.sectionDescription}>{t('system_info.clear_login_desc')}</p>
          <div className={styles.clearLoginActions}>
            <Button variant="danger" onClick={handleClearLoginStorage}>
              {t('system_info.clear_login_button')}
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        open={requestLogModalOpen}
        onClose={handleRequestLogClose}
        title={t('basic_settings.request_log_title')}
        footer={
          <>
            <Button variant="secondary" onClick={handleRequestLogClose} disabled={requestLogSaving}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleRequestLogSave}
              loading={requestLogSaving}
              disabled={!canEditRequestLog || !requestLogDirty}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="request-log-modal">
          <div className="status-badge warning">{t('basic_settings.request_log_warning')}</div>
          <ToggleSwitch
            label={t('basic_settings.request_log_enable')}
            labelPosition="left"
            checked={requestLogDraft}
            disabled={!canEditRequestLog || requestLogSaving}
            onChange={(value) => {
              setRequestLogDraft(value);
              setRequestLogTouched(true);
            }}
          />
        </div>
      </Modal>
    </div>
  );
}

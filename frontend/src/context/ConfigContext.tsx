import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { settingsAPI } from '../services/api';
import type { AppConfig, RiskThresholds } from '../types';
import { DEFAULT_RISK_THRESHOLDS } from '../lib/buildingStatus';
import { useAuth } from './AuthContext';

interface ConfigContextValue {
  config: AppConfig;
  isLoading: boolean;
}

const FALLBACK_CONFIG: AppConfig = { risk_thresholds: DEFAULT_RISK_THRESHOLDS };

const ConfigContext = createContext<ConfigContextValue | undefined>(undefined);

/**
 * Loads system-wide config from the backend once after the user is
 * authenticated, and exposes it to the rest of the app. Always returns a
 * usable config (in-code defaults) when loading or on error — consumers
 * never need to handle a "missing config" state.
 */
export function ConfigProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();

  const { data, isLoading } = useQuery<AppConfig>({
    queryKey: ['config'],
    queryFn: () => settingsAPI.get(),
    enabled: isAuthenticated,
    staleTime: 60_000,
    retry: 1,
  });

  const value: ConfigContextValue = {
    config: data ?? FALLBACK_CONFIG,
    isLoading,
  };

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}

/** Convenience hook for the most-read sub-config. */
export function useRiskThresholds(): RiskThresholds {
  return useConfig().config.risk_thresholds;
}

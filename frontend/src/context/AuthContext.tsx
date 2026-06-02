import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL, TOKEN_KEYS } from '../services/api';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: 'manager' | 'worker' | 'viewer' | 'tenant';
  status: string;
  building_id?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAuth = useCallback(() => {
    localStorage.removeItem(TOKEN_KEYS.ACCESS);
    localStorage.removeItem(TOKEN_KEYS.REFRESH);
    setUser(null);
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    // Refresh 5 minutes before expiry (tokens expire in 30 min → refresh at 25 min)
    refreshTimerRef.current = setTimeout(async () => {
      const refreshToken = localStorage.getItem(TOKEN_KEYS.REFRESH);
      if (!refreshToken) {
        clearAuth();
        return;
      }
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (res.ok) {
          const data = await res.json();
          localStorage.setItem(TOKEN_KEYS.ACCESS, data.access_token);
          // Store the new refresh token (sliding window resets the 30-day clock)
          if (data.refresh_token) {
            localStorage.setItem(TOKEN_KEYS.REFRESH, data.refresh_token);
          }
          scheduleRefresh();
        } else {
          clearAuth();
          window.location.href = '/login';
        }
      } catch {
        clearAuth();
        window.location.href = '/login';
      }
    }, 25 * 60 * 1000);
  }, [clearAuth]);

  // On mount: validate existing token and restore session.
  // If the access token is expired (>30 min since last visit), silently refresh
  // using the stored refresh token before giving up and redirecting to /login.
  useEffect(() => {
    const initAuth = async () => {
      const abort = () => { clearAuth(); setIsLoading(false); };

      const token = localStorage.getItem(TOKEN_KEYS.ACCESS);
      if (!token) {
        setIsLoading(false);
        return;
      }

      // First attempt: call /me with the stored access token
      let meRes = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // If access token expired, try a silent refresh before giving up
      if (meRes.status === 401) {
        const refreshToken = localStorage.getItem(TOKEN_KEYS.REFRESH);
        if (refreshToken) {
          try {
            const refreshRes = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: refreshToken }),
            });
            if (refreshRes.ok) {
              const refreshData = await refreshRes.json();
              localStorage.setItem(TOKEN_KEYS.ACCESS, refreshData.access_token);
              if (refreshData.refresh_token) {
                localStorage.setItem(TOKEN_KEYS.REFRESH, refreshData.refresh_token);
              }
              // Retry /me with the fresh access token
              meRes = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
                headers: { Authorization: `Bearer ${refreshData.access_token}` },
              });
            } else {
              return abort();
            }
          } catch {
            return abort();
          }
        } else {
          return abort();
        }
      }

      if (meRes.ok) {
        const userData: AuthUser = await meRes.json();
        setUser(userData);
        scheduleRefresh();
      } else {
        clearAuth();
      }
      setIsLoading(false);
    };

    initAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const formData = new URLSearchParams();
    formData.append('username', email);
    formData.append('password', password);

    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'שם משתמש או סיסמה שגויים');
    }

    const data = await res.json();
    localStorage.setItem(TOKEN_KEYS.ACCESS, data.access_token);
    localStorage.setItem(TOKEN_KEYS.REFRESH, data.refresh_token);
    setUser(data.user);
    scheduleRefresh();
  }, [scheduleRefresh]);

  const logout = useCallback(() => {
    clearAuth();
    window.location.href = '/login';
  }, [clearAuth]);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

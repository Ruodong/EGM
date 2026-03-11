'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { authHeaders, setAuthToken, getAuthToken } from '@/lib/auth-token';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  hasPermission: (resource: string, scope?: string) => boolean;
  hasRole: (...roles: string[]) => boolean;
  refresh: () => Promise<void>;
  switchRole: (role: string) => Promise<void>;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';
const KEYCLOAK_URL = process.env.NEXT_PUBLIC_KEYCLOAK_URL || '';
const KEYCLOAK_REALM = process.env.NEXT_PUBLIC_KEYCLOAK_REALM || 'myapp';
const KEYCLOAK_CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || '';

function buildKeycloakAuthUrl(): string {
  const redirectUri = encodeURIComponent(window.location.origin + '/');
  return (
    `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth` +
    `?client_id=${KEYCLOAK_CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${redirectUri}` +
    `&scope=openid`
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async (roleOverride?: string) => {
    try {
      setLoading(true);
      setError(null);
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders() };
      const devRole = roleOverride ?? (typeof window !== 'undefined' ? localStorage.getItem('egm_dev_role') : null);
      if (devRole) {
        headers['X-Dev-Role'] = devRole;
      }
      const res = await fetch(`${API_BASE}/auth/me`, { headers });
      if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
      const data: AuthUser = await res.json();
      setUser(data);
    } catch (err) {
      console.error('Failed to fetch auth user:', err);
      setError(err instanceof Error ? err.message : 'Auth error');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const switchRole = useCallback(async (role: string) => {
    localStorage.setItem('egm_dev_role', role);
    await fetchUser(role);
  }, [fetchUser]);

  // Handle OIDC callback — exchange authorization code for token
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
      // Clear the code from URL
      window.history.replaceState({}, '', window.location.pathname);

      // Exchange code for token via backend
      fetch(`${API_BASE}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          redirectUri: window.location.origin + '/',
        }),
      })
        .then((res) => {
          if (!res.ok) throw new Error('Token exchange failed');
          return res.json();
        })
        .then((data) => {
          setAuthToken(data.accessToken);
          fetchUser();
        })
        .catch((err) => {
          console.error('Token exchange failed:', err);
          setError('Login failed');
          setLoading(false);
        });
    } else {
      // No code — check if we have a stored token
      const token = getAuthToken();
      if (token) {
        fetchUser();
      } else if (KEYCLOAK_URL) {
        // No token and Keycloak is configured — redirect to login
        window.location.href = buildKeycloakAuthUrl();
      } else {
        // Dev mode — AUTH_DISABLED=true on backend, no token needed
        fetchUser();
      }
    }
  }, [fetchUser]);

  const login = useCallback(() => {
    if (KEYCLOAK_URL) {
      window.location.href = buildKeycloakAuthUrl();
    }
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    if (KEYCLOAK_URL) {
      const redirectUri = encodeURIComponent(window.location.origin + '/');
      window.location.href =
        `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/logout` +
        `?post_logout_redirect_uri=${redirectUri}` +
        `&client_id=${KEYCLOAK_CLIENT_ID}`;
    }
  }, []);

  const hasPermission = useCallback(
    (resource: string, scope: string = 'read'): boolean => {
      if (!user) return false;
      const perms = user.permissions;
      if (perms.includes('*:*')) return true;
      if (perms.includes(`${resource}:${scope}`)) return true;
      if (perms.includes(`${resource}:*`)) return true;
      return false;
    },
    [user]
  );

  const hasRole = useCallback(
    (...roles: string[]): boolean => {
      if (!user) return false;
      return roles.includes(user.role);
    },
    [user]
  );

  return (
    <AuthContext.Provider value={{ user, loading, error, hasPermission, hasRole, refresh: fetchUser, switchRole, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

export function usePermission(resource: string, scope: string = 'read'): boolean {
  const { hasPermission } = useAuth();
  return hasPermission(resource, scope);
}

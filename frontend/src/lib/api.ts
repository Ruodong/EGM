import { authHeaders } from '@/lib/auth-token';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

function devRoleHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const devUser = localStorage.getItem('egm_dev_user');
  if (devUser) return { 'X-Dev-User': devUser };
  const role = localStorage.getItem('egm_dev_role');
  return role ? { 'X-Dev-Role': role } : {};
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...devRoleHeader(),
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export function buildQueryString(params: Record<string, any>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, String(value));
    }
  });
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  get: <T>(endpoint: string, params?: Record<string, any>) =>
    fetchApi<T>(`${endpoint}${params ? buildQueryString(params) : ''}`),
  post: <T>(endpoint: string, data: any) =>
    fetchApi<T>(endpoint, { method: 'POST', body: JSON.stringify(data) }),
  put: <T>(endpoint: string, data: any) =>
    fetchApi<T>(endpoint, { method: 'PUT', body: JSON.stringify(data) }),
  delete: <T>(endpoint: string) =>
    fetchApi<T>(endpoint, { method: 'DELETE' }),
  /** Upload a file via multipart/form-data (browser sets Content-Type boundary). */
  upload: async <T>(endpoint: string, formData: FormData): Promise<T> => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { ...authHeaders(), ...devRoleHeader() },
      body: formData,
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
};

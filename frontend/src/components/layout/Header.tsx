'use client';

import { ChevronDown, Loader2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-500',
  governance_lead: 'bg-purple-500',
  domain_reviewer: 'bg-amber-500',
  requestor: 'bg-blue-500',
  viewer: 'bg-gray-400',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  governance_lead: 'Gov Lead',
  domain_reviewer: 'Reviewer',
  requestor: 'Requestor',
  viewer: 'Viewer',
};

export function Header() {
  const { user, switchUser } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch real users from user_role table
  const { data: usersData, isLoading: usersLoading } = useQuery<{ data: { itcode: string; name: string; role: string }[] }>({
    queryKey: ['dev-user-list'],
    queryFn: () => api.get('/dev/users'),
    staleTime: 30_000,
    enabled: open, // only fetch when dropdown is opened
  });

  const roleUsers = usersData?.data ?? [];

  const currentRoleColor = ROLE_COLORS[user?.role ?? ''] ?? 'bg-gray-400';
  const currentRoleLabel = ROLE_LABELS[user?.role ?? ''] ?? user?.role ?? '';

  const handleSwitch = async (itcode: string) => {
    setOpen(false);
    await switchUser(itcode);
    queryClient.invalidateQueries();
  };

  return (
    <header className="h-14 border-b border-border-light bg-white flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 200 200" className="w-7 h-7" aria-label="Lenovo">
          <rect width="200" height="200" rx="40" fill="#E1002A" />
          <text
            x="100"
            y="138"
            textAnchor="middle"
            fontFamily="Arial, Helvetica, sans-serif"
            fontWeight="bold"
            fontSize="110"
            fill="#FFFFFF"
            letterSpacing="-4"
          >
            Le
          </text>
        </svg>
        <span className="text-lg font-semibold text-text-primary">
          Enterprise Governance Management
        </span>
      </div>
      <div className="flex items-center gap-4 text-sm" ref={ref}>
        {user && (
          <div className="relative">
            <button
              onClick={() => setOpen(!open)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border-light hover:bg-gray-50 transition-colors"
            >
              <span className={`w-2 h-2 rounded-full ${currentRoleColor}`} />
              <span className="text-text-primary font-medium">{user.name}</span>
              <span className="text-text-secondary">({currentRoleLabel})</span>
              <ChevronDown className={`w-4 h-4 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-lg border border-border-light shadow-lg py-1 z-50">
                <div className="px-3 py-2 text-xs text-text-secondary border-b border-border-light">
                  Switch User
                </div>
                {usersLoading ? (
                  <div className="flex items-center justify-center py-4 text-text-secondary">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    <span className="text-xs">Loading users…</span>
                  </div>
                ) : roleUsers.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-text-secondary text-center">
                    No users found in User Authorization
                  </div>
                ) : (
                  roleUsers.map((u) => {
                    const color = ROLE_COLORS[u.role] ?? 'bg-gray-400';
                    const label = ROLE_LABELS[u.role] ?? u.role;
                    const isActive = user.id === u.itcode;
                    return (
                      <button
                        key={u.itcode}
                        onClick={() => handleSwitch(u.itcode)}
                        className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors ${
                          isActive ? 'bg-gray-50' : ''
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
                        <span className={`text-sm flex-1 ${isActive ? 'font-medium' : ''}`}>
                          {u.name}
                        </span>
                        <span className="text-xs text-text-secondary">{label}</span>
                        {isActive && (
                          <span className="text-xs text-egm-teal ml-1">Active</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

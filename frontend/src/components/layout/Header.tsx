'use client';

import { Shield, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useQueryClient } from '@tanstack/react-query';

const DEV_ROLES = [
  { value: 'admin', label: 'Admin', color: 'bg-red-500' },
  { value: 'requestor', label: 'Requestor', color: 'bg-blue-500' },
  { value: 'domain_reviewer', label: 'Reviewer', color: 'bg-amber-500' },
] as const;

export function Header() {
  const { user, switchRole } = useAuth();
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

  const currentRole = DEV_ROLES.find((r) => r.value === user?.role) || DEV_ROLES[0];

  const handleSwitch = async (role: string) => {
    setOpen(false);
    await switchRole(role);
    queryClient.invalidateQueries();
  };

  return (
    <header className="h-14 border-b border-border-light bg-white flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <Shield className="w-6 h-6 text-egm-teal" />
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
              <span className={`w-2 h-2 rounded-full ${currentRole.color}`} />
              <span className="text-text-primary font-medium">{user.name}</span>
              <span className="text-text-secondary">({currentRole.label})</span>
              <ChevronDown className={`w-4 h-4 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-lg border border-border-light shadow-lg py-1 z-50">
                <div className="px-3 py-2 text-xs text-text-secondary border-b border-border-light">
                  Switch Role
                </div>
                {DEV_ROLES.map((role) => (
                  <button
                    key={role.value}
                    onClick={() => handleSwitch(role.value)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors ${
                      user.role === role.value ? 'bg-gray-50 font-medium' : ''
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${role.color}`} />
                    <span className="text-sm">{role.label}</span>
                    {user.role === role.value && (
                      <span className="ml-auto text-xs text-egm-teal">Active</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

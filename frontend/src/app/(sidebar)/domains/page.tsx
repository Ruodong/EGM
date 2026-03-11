'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import clsx from 'clsx';

interface Domain {
  id: string;
  domainCode: string;
  domainName: string;
  description: string | null;
  integrationType: string;
  externalBaseUrl: string | null;
  icon: string | null;
  isActive: boolean;
  sortOrder: number;
}

export default function DomainsPage() {
  const { data, isLoading } = useQuery<{ data: Domain[] }>({
    queryKey: ['domains'],
    queryFn: () => api.get('/domains'),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Domain Registry</h1>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {isLoading ? (
          <p className="text-text-secondary col-span-2">Loading...</p>
        ) : (
          data?.data?.map((d) => (
            <div key={d.id} className="bg-white rounded-lg border border-border-light p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-egm-teal/10 flex items-center justify-center">
                    <span className="text-sm font-bold text-egm-teal">{d.domainCode}</span>
                  </div>
                  <div>
                    <h3 className="font-medium">{d.domainName}</h3>
                    <span className="text-xs text-text-secondary">{d.domainCode}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {d.integrationType === 'external' && (
                    <span className="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700">External</span>
                  )}
                  <span className={clsx('px-2 py-0.5 rounded text-xs', d.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                    {d.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              {d.description && <p className="text-sm text-text-secondary mt-2">{d.description}</p>}
              {d.externalBaseUrl && (
                <p className="text-xs text-text-secondary mt-1">System URL: {d.externalBaseUrl}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

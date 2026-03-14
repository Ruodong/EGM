'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Select, Button } from 'antd';

interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  performedBy: string | null;
  performedAt: string | null;
}

interface PaginatedResponse {
  data: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const ENTITY_TYPES = [
  'governance_request',
  'intake_template',
  'intake_response',
  'domain_review',
  'dispatch_rule',
  'domain_registry',
  'info_supplement_request',
];

export default function AuditLogPage() {
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ['audit-log', entityType, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (entityType) params.set('entity_type', entityType);
      params.set('page', String(page));
      params.set('page_size', '20');
      return api.get(`/audit-log?${params.toString()}`);
    },
  });

  const entries = data?.data || [];
  const totalPages = data?.totalPages || 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Audit Log</h1>
          <p className="text-sm text-text-secondary mt-1">View system activity and change history</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <Select
          style={{ minWidth: 200 }}
          value={entityType || undefined}
          onChange={(value) => { setEntityType(value || ''); setPage(1); }}
          allowClear
          placeholder="All Entity Types"
          options={ENTITY_TYPES.map((t) => ({ label: t, value: t }))}
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-text-secondary">Loading...</p>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-lg border border-border-light p-8 text-center text-text-secondary">
          No audit log entries found.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-border-light overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-gray border-b border-border-light">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Timestamp</th>
                  <th className="text-left px-4 py-2 font-medium">Entity Type</th>
                  <th className="text-left px-4 py-2 font-medium">Entity ID</th>
                  <th className="text-left px-4 py-2 font-medium">Action</th>
                  <th className="text-left px-4 py-2 font-medium">Performed By</th>
                  <th className="text-left px-4 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <>
                    <tr key={e.id} className="border-b border-border-light hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                      <td className="px-4 py-2 text-text-secondary">
                        {e.performedAt ? new Date(e.performedAt).toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-2">
                        <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700">{e.entityType}</span>
                      </td>
                      <td className="px-4 py-2 text-xs">{e.entityId ? e.entityId.substring(0, 8) + '...' : '-'}</td>
                      <td className="px-4 py-2">
                        <span className="px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-700">{e.action}</span>
                      </td>
                      <td className="px-4 py-2">{e.performedBy || '-'}</td>
                      <td className="px-4 py-2 text-primary-blue text-xs">
                        {(e.oldValue || e.newValue) ? (expanded === e.id ? 'Hide' : 'Show') : '-'}
                      </td>
                    </tr>
                    {expanded === e.id && (e.oldValue || e.newValue) && (
                      <tr key={`${e.id}-detail`} className="border-b border-border-light">
                        <td colSpan={6} className="px-4 py-3 bg-gray-50">
                          <div className="grid grid-cols-2 gap-4">
                            {e.oldValue && (
                              <div>
                                <h4 className="text-xs font-semibold text-text-secondary mb-1">Old Value</h4>
                                <pre className="text-xs bg-white p-2 rounded border overflow-auto max-h-40">
                                  {JSON.stringify(e.oldValue, null, 2)}
                                </pre>
                              </div>
                            )}
                            {e.newValue && (
                              <div>
                                <h4 className="text-xs font-semibold text-text-secondary mb-1">New Value</h4>
                                <pre className="text-xs bg-white p-2 rounded border overflow-auto max-h-40">
                                  {JSON.stringify(e.newValue, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-text-secondary">
                Page {page} of {totalPages} ({data?.total || 0} entries)
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  size="small"
                >
                  Previous
                </Button>
                <Button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  size="small"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

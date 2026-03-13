'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { statusColors } from '@/lib/constants';
import Link from 'next/link';
import { useState, useCallback } from 'react';
import clsx from 'clsx';
import DataTable, { type Column } from '@/components/shared/DataTable';
import FilterBar, { useFilterState, type FilterBarConfig } from '@/components/shared/FilterBar';

interface GovRequest {
  id: string;
  requestId: string;
  egqId: string | null;
  title: string;
  govProjectType: string | null;
  projectName: string | null;
  status: string;
  requestor: string;
  requestorName: string;
  overallVerdict: string | null;
  createAt: string;
}

interface PaginatedResponse {
  data: GovRequest[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const FILTER_CONFIG: FilterBarConfig = {
  searchPlaceholder: 'Search by Request ID or Title...',
  statusOptions: ['', 'Draft', 'Submitted', 'In Review', 'Info Requested', 'Completed'],
};

export default function RequestsPage() {
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState('create_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  const { filterValues, uiState } = useFilterState(() => setPage(1));

  const handleSort = useCallback((field: string, order: 'ASC' | 'DESC') => {
    setSortField(field);
    setSortOrder(order);
    setPage(1);
  }, []);

  const { data, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ['governance-requests', page, filterValues, sortField, sortOrder],
    queryFn: () =>
      api.get('/governance-requests', {
        page,
        pageSize: 20,
        sortField,
        sortOrder,
        ...(filterValues.status && { status: filterValues.status }),
        ...(filterValues.search && { search: filterValues.search }),
        ...(filterValues.requestor && { requestor: filterValues.requestor }),
        ...(filterValues.dateFrom && { dateFrom: filterValues.dateFrom }),
        ...(filterValues.dateTo && { dateTo: filterValues.dateTo }),
      }),
  });

  // ── Column definitions (reusable pattern) ───────────────────────

  const columns: Column<GovRequest>[] = [
    {
      key: 'request_id',
      label: 'Request ID',
      sortable: true,
      render: (r) => (
        <Link href={`/governance/${r.requestId}`} className="text-primary-blue hover:underline">
          {r.requestId}
        </Link>
      ),
      exportValue: (r) => r.requestId,
    },
    {
      key: 'title',
      label: 'EGQ ID',
      sortable: true,
      render: (r) => <>{r.egqId || r.title || '-'}</>,
      exportValue: (r) => r.egqId || r.title || '',
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (r) => (
        <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[r.status] || 'bg-gray-400')}>
          {r.status}
        </span>
      ),
      exportValue: (r) => r.status,
    },
    {
      key: 'requestor',
      label: 'Requestor',
      sortable: true,
      render: (r) => <>{r.requestorName || r.requestor}</>,
      exportValue: (r) => r.requestorName || r.requestor,
    },
    {
      key: 'overallVerdict',
      label: 'Verdict',
      render: (r) => <>{r.overallVerdict || '-'}</>,
      exportValue: (r) => r.overallVerdict || '',
    },
    {
      key: 'create_at',
      label: 'Created',
      sortable: true,
      render: (r) => (
        <span className="text-text-secondary">
          {r.createAt ? new Date(r.createAt).toLocaleDateString() : '-'}
        </span>
      ),
      exportValue: (r) => (r.createAt ? new Date(r.createAt).toLocaleDateString() : ''),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Governance Requests</h1>
        <Link href="/governance/create" className="btn-teal text-sm">
          + New Request
        </Link>
      </div>

      <FilterBar config={FILTER_CONFIG} uiState={uiState} />

      {/* Data table */}
      <DataTable<GovRequest>
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        rowKey={(r) => r.id}
        sortField={sortField}
        sortOrder={sortOrder}
        onSort={handleSort}
        exportFilename="governance-requests"
        pagination={
          data && data.totalPages > 1
            ? {
                page,
                totalPages: data.totalPages,
                total: data.total,
                onPageChange: setPage,
              }
            : undefined
        }
      />
    </div>
  );
}

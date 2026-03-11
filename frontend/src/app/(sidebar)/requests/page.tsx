'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { statusColors } from '@/lib/constants';
import Link from 'next/link';
import { useState, useRef, useCallback } from 'react';
import clsx from 'clsx';
import DataTable, { type Column } from '@/components/shared/DataTable';

interface GovRequest {
  id: string;
  requestId: string;
  title: string;
  status: string;
  priority: string;
  requestor: string;
  requestorName: string;
  organization: string;
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

const STATUS_OPTIONS = ['', 'Draft', 'Submitted', 'In Review', 'Info Requested', 'Completed'];

export default function RequestsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortField, setSortField] = useState('create_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300);
  }, []);

  const handleDateFromChange = (value: string) => {
    setDateFrom(value);
    setPage(1);
  };

  const handleDateToChange = (value: string) => {
    setDateTo(value);
    setPage(1);
  };

  const handleSort = useCallback((field: string, order: 'ASC' | 'DESC') => {
    setSortField(field);
    setSortOrder(order);
    setPage(1);
  }, []);

  const { data, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ['governance-requests', page, statusFilter, debouncedSearch, dateFrom, dateTo, sortField, sortOrder],
    queryFn: () =>
      api.get('/governance-requests', {
        page,
        pageSize: 20,
        sortField,
        sortOrder,
        ...(statusFilter && { status: statusFilter }),
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo }),
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
      label: 'Title',
      sortable: true,
      render: (r) => <>{r.title}</>,
      exportValue: (r) => r.title,
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
      key: 'priority',
      label: 'Priority',
      sortable: true,
      render: (r) => <>{r.priority}</>,
      exportValue: (r) => r.priority,
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

      {/* Filter bar: search + status dropdown + date range */}
      <div className="mb-4 flex items-center gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by Request ID or Title..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="input-field w-full"
          />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-text-secondary whitespace-nowrap">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="input-field"
            data-testid="status-filter"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s || 'All'}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-text-secondary whitespace-nowrap">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => handleDateFromChange(e.target.value)}
            className="input-field"
          />
          <label className="text-text-secondary whitespace-nowrap">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => handleDateToChange(e.target.value)}
            className="input-field"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}
              className="text-sm text-red-500 hover:text-red-700 whitespace-nowrap"
            >
              Clear
            </button>
          )}
        </div>
      </div>

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

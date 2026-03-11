'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { statusColors } from '@/lib/constants';
import Link from 'next/link';
import { useState, useRef, useCallback, useMemo } from 'react';
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
const DATE_PRESETS = [
  { label: 'All Time', value: '' },
  { label: '1 Day', value: '1d' },
  { label: '7 Days', value: '7d' },
  { label: '1 Month', value: '1m' },
  { label: '3 Months', value: '3m' },
  { label: 'Custom', value: 'custom' },
];

export default function RequestsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [datePreset, setDatePreset] = useState('');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [sortField, setSortField] = useState('create_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Compute effective dateFrom/dateTo from preset or custom
  const { dateFrom, dateTo } = useMemo(() => {
    if (datePreset === 'custom') return { dateFrom: customDateFrom, dateTo: customDateTo };
    if (!datePreset) return { dateFrom: '', dateTo: '' };
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    let from: Date;
    switch (datePreset) {
      case '1d': from = new Date(now.getTime() - 1 * 86400000); break;
      case '7d': from = new Date(now.getTime() - 7 * 86400000); break;
      case '1m': from = new Date(now); from.setMonth(from.getMonth() - 1); break;
      case '3m': from = new Date(now); from.setMonth(from.getMonth() - 3); break;
      default: return { dateFrom: '', dateTo: '' };
    }
    return { dateFrom: from.toISOString().slice(0, 10), dateTo: to };
  }, [datePreset, customDateFrom, customDateTo]);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300);
  }, []);

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
          <label className="text-text-secondary whitespace-nowrap">Period</label>
          <select
            value={datePreset}
            onChange={(e) => { setDatePreset(e.target.value); setPage(1); }}
            className="input-field"
            data-testid="date-filter"
          >
            {DATE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          {datePreset === 'custom' && (
            <>
              <input
                type="date"
                value={customDateFrom}
                onChange={(e) => { setCustomDateFrom(e.target.value); setPage(1); }}
                className="input-field"
                data-testid="custom-date-from"
              />
              <span className="text-text-secondary">–</span>
              <input
                type="date"
                value={customDateTo}
                onChange={(e) => { setCustomDateTo(e.target.value); setPage(1); }}
                className="input-field"
                data-testid="custom-date-to"
              />
            </>
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

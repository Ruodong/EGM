'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { statusColors } from '@/lib/constants';
import Link from 'next/link';
import { useState, useRef, useCallback } from 'react';
import clsx from 'clsx';

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

export default function RequestsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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

  const { data, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ['governance-requests', page, statusFilter, debouncedSearch, dateFrom, dateTo],
    queryFn: () =>
      api.get('/governance-requests', {
        page,
        pageSize: 20,
        ...(statusFilter && { status: statusFilter }),
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo }),
      }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Governance Requests</h1>
        <Link href="/governance/create" className="btn-teal text-sm">
          + New Request
        </Link>
      </div>

      {/* Filter bar: search + date range */}
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

      {/* Status filter tabs */}
      <div className="mb-4 flex gap-2">
        {['', 'Draft', 'Submitted', 'In Review', 'Info Requested', 'Completed'].map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className={clsx(
              'px-3 py-1 rounded text-sm border',
              statusFilter === s ? 'bg-primary-blue text-white border-primary-blue' : 'border-border-light hover:border-primary-blue'
            )}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-border-light">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-light bg-bg-gray">
              <th className="text-left p-3 font-medium">Request ID</th>
              <th className="text-left p-3 font-medium">Title</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-left p-3 font-medium">Priority</th>
              <th className="text-left p-3 font-medium">Requestor</th>
              <th className="text-left p-3 font-medium">Verdict</th>
              <th className="text-left p-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="p-4 text-center text-text-secondary">Loading...</td></tr>
            ) : data?.data.length === 0 ? (
              <tr><td colSpan={7} className="p-4 text-center text-text-secondary">No data available</td></tr>
            ) : (
              data?.data.map((r) => (
                <tr key={r.id} className="border-b border-border-light hover:bg-gray-50">
                  <td className="p-3">
                    <Link href={`/governance/${r.requestId}`} className="text-primary-blue hover:underline">
                      {r.requestId}
                    </Link>
                  </td>
                  <td className="p-3">{r.title}</td>
                  <td className="p-3">
                    <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[r.status] || 'bg-gray-400')}>
                      {r.status}
                    </span>
                  </td>
                  <td className="p-3">{r.priority}</td>
                  <td className="p-3">{r.requestorName || r.requestor}</td>
                  <td className="p-3">{r.overallVerdict || '-'}</td>
                  <td className="p-3 text-text-secondary">{r.createAt ? new Date(r.createAt).toLocaleDateString() : '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t border-border-light">
            <span className="text-sm text-text-secondary">Total {data.total} items</span>
            <div className="flex gap-1">
              {Array.from({ length: data.totalPages }, (_, i) => (
                <button
                  key={i + 1}
                  onClick={() => setPage(i + 1)}
                  className={clsx(
                    'px-3 py-1 rounded text-sm',
                    page === i + 1 ? 'bg-primary-blue text-white' : 'hover:bg-gray-100'
                  )}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

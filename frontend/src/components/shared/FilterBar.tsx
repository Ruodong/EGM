'use client';

import { useState, useRef, useCallback, useMemo, type ReactNode } from 'react';

/* ─── Date presets (shared across all list pages) ──────────────── */
const DATE_PRESETS = [
  { label: 'All Time', value: '' },
  { label: '1 Day', value: '1d' },
  { label: '7 Days', value: '7d' },
  { label: '1 Month', value: '1m' },
  { label: '3 Months', value: '3m' },
  { label: 'Custom', value: 'custom' },
];

/* ─── Types ────────────────────────────────────────────────────── */
export interface FilterValues {
  search: string;
  status: string;
  requestor: string;
  dateFrom: string;
  dateTo: string;
}

export interface FilterBarConfig {
  /** Placeholder for the search input */
  searchPlaceholder?: string;
  /** Status dropdown options. First entry should be '' for "All". */
  statusOptions: string[];
}

/* ─── Hook: manages all filter state + debounce ────────────────── */
export function useFilterState(onPageReset: () => void) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [requestor, setRequestor] = useState('');
  const [debouncedRequestor, setDebouncedRequestor] = useState('');
  const [datePreset, setDatePreset] = useState('');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const searchRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requestorRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      onPageReset();
    }, 300);
  }, [onPageReset]);

  const handleRequestorChange = useCallback((value: string) => {
    setRequestor(value);
    if (requestorRef.current) clearTimeout(requestorRef.current);
    requestorRef.current = setTimeout(() => {
      setDebouncedRequestor(value);
      onPageReset();
    }, 300);
  }, [onPageReset]);

  const handleStatusChange = useCallback((value: string) => {
    setStatus(value);
    onPageReset();
  }, [onPageReset]);

  const handleDatePresetChange = useCallback((value: string) => {
    setDatePreset(value);
    onPageReset();
  }, [onPageReset]);

  const handleCustomDateFromChange = useCallback((value: string) => {
    setCustomDateFrom(value);
    onPageReset();
  }, [onPageReset]);

  const handleCustomDateToChange = useCallback((value: string) => {
    setCustomDateTo(value);
    onPageReset();
  }, [onPageReset]);

  // Compute effective date range
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

  const filterValues: FilterValues = {
    search: debouncedSearch,
    status,
    requestor: debouncedRequestor,
    dateFrom,
    dateTo,
  };

  const uiState = {
    search, status, requestor, datePreset, customDateFrom, customDateTo,
    handleSearchChange, handleStatusChange, handleRequestorChange,
    handleDatePresetChange, handleCustomDateFromChange, handleCustomDateToChange,
  };

  return { filterValues, uiState };
}

/* ─── Component ────────────────────────────────────────────────── */
export default function FilterBar({
  config,
  uiState,
  children,
}: {
  config: FilterBarConfig;
  uiState: ReturnType<typeof useFilterState>['uiState'];
  /** Slot for page-specific extra filters (rendered after Period) */
  children?: ReactNode;
}) {
  const { searchPlaceholder = 'Search by ID or Name...', statusOptions } = config;

  return (
    <div className="mb-4 flex items-center gap-4 flex-wrap">
      {/* Search */}
      <div className="flex-1 min-w-[200px]">
        <input
          type="text"
          placeholder={searchPlaceholder}
          value={uiState.search}
          onChange={(e) => uiState.handleSearchChange(e.target.value)}
          className="input-field w-full"
          data-testid="search-input"
        />
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 text-sm">
        <label className="text-text-secondary whitespace-nowrap">Status</label>
        <select
          value={uiState.status}
          onChange={(e) => uiState.handleStatusChange(e.target.value)}
          className="input-field"
          data-testid="status-filter"
        >
          {statusOptions.map((s) => (
            <option key={s} value={s}>{s || 'All'}</option>
          ))}
        </select>
      </div>

      {/* Requestor */}
      <div className="flex items-center gap-2 text-sm">
        <label className="text-text-secondary whitespace-nowrap">Requestor</label>
        <input
          type="text"
          placeholder="Name or ID..."
          value={uiState.requestor}
          onChange={(e) => uiState.handleRequestorChange(e.target.value)}
          className="input-field w-36"
          data-testid="requestor-filter"
        />
      </div>

      {/* Period */}
      <div className="flex items-center gap-2 text-sm">
        <label className="text-text-secondary whitespace-nowrap">Period</label>
        <select
          value={uiState.datePreset}
          onChange={(e) => uiState.handleDatePresetChange(e.target.value)}
          className="input-field"
          data-testid="date-filter"
        >
          {DATE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {uiState.datePreset === 'custom' && (
          <>
            <input
              type="date"
              value={uiState.customDateFrom}
              onChange={(e) => uiState.handleCustomDateFromChange(e.target.value)}
              className="input-field"
              data-testid="custom-date-from"
            />
            <span className="text-text-secondary">–</span>
            <input
              type="date"
              value={uiState.customDateTo}
              onChange={(e) => uiState.handleCustomDateToChange(e.target.value)}
              className="input-field"
              data-testid="custom-date-to"
            />
          </>
        )}
      </div>

      {/* Page-specific extra filters */}
      {children}
    </div>
  );
}

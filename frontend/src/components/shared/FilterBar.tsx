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
import { Input, Select, DatePicker, Space, Typography } from 'antd';
import dayjs from 'dayjs';

const { Text } = Typography;

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
    <div style={{ marginBottom: 16 }}>
      <Space wrap size="middle" style={{ width: '100%' }}>
        {/* Search */}
        <Input.Search
          placeholder={searchPlaceholder}
          value={uiState.search}
          onChange={(e) => uiState.handleSearchChange(e.target.value)}
          allowClear
          style={{ width: 360 }}
          data-testid="search-input"
        />

        {/* Status (hidden when statusOptions is empty — page manages its own filter) */}
        {statusOptions.length > 0 && (
          <Space size="small">
            <Text type="secondary">Status</Text>
            <Select
              value={uiState.status || undefined}
              onChange={(v) => uiState.handleStatusChange(v ?? '')}
              placeholder="All"
              allowClear
              style={{ minWidth: 140 }}
              data-testid="status-filter"
              options={statusOptions.filter(Boolean).map((s) => ({ value: s, label: s }))}
            />
          </Space>
        )}

        {/* Requestor */}
        <Space size="small">
          <Text type="secondary">Requestor</Text>
          <Input
            placeholder="Name or ID..."
            value={uiState.requestor}
            onChange={(e) => uiState.handleRequestorChange(e.target.value)}
            allowClear
            style={{ width: 150 }}
            data-testid="requestor-filter"
          />
        </Space>

        {/* Period */}
        <Space size="small">
          <Text type="secondary">Period</Text>
          <div data-testid="date-filter">
            <Select
              value={uiState.datePreset || undefined}
              onChange={(v) => uiState.handleDatePresetChange(v ?? '')}
              placeholder="All Time"
              allowClear
              style={{ minWidth: 120 }}
              options={DATE_PRESETS.map((p) => ({ value: p.value || 'all', label: p.label }))}
            />
          </div>
          {uiState.datePreset === 'custom' && (
            <DatePicker.RangePicker
              value={[
                uiState.customDateFrom ? dayjs(uiState.customDateFrom) : null,
                uiState.customDateTo ? dayjs(uiState.customDateTo) : null,
              ]}
              onChange={(dates) => {
                uiState.handleCustomDateFromChange(dates?.[0]?.format('YYYY-MM-DD') ?? '');
                uiState.handleCustomDateToChange(dates?.[1]?.format('YYYY-MM-DD') ?? '');
              }}
              data-testid="custom-date-range"
            />
          )}
        </Space>
      </Space>

      {/* Page-specific extra filters (second row) */}
      {children}
    </div>
  );
}

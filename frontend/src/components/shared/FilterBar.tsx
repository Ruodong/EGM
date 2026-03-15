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
  domain: string;
}

export interface FilterBarConfig {
  /** Placeholder for the search input */
  searchPlaceholder?: string;
  /** Status dropdown options. First entry should be '' for "All". */
  statusOptions: string[];
  /** Enable multi-select for Status filter */
  statusMultiSelect?: boolean;
  /** Domain dropdown options for multi-select domain filter. If provided, domain filter is shown. */
  domainOptions?: { value: string; label: string }[];
  /** Hide the Requestor filter (e.g. for requestor-role users who only see own requests) */
  hideRequestor?: boolean;
}

/* ─── Hook: manages all filter state + debounce ────────────────── */
export function useFilterState(onPageReset: () => void) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<string | string[]>('');
  const [requestor, setRequestor] = useState('');
  const [debouncedRequestor, setDebouncedRequestor] = useState('');
  const [domain, setDomain] = useState<string[]>([]);
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

  const handleStatusChange = useCallback((value: string | string[]) => {
    setStatus(value);
    onPageReset();
  }, [onPageReset]);

  const handleDomainChange = useCallback((value: string[]) => {
    setDomain(value);
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

  // Normalize to comma-separated strings for API
  const statusStr = Array.isArray(status) ? status.join(',') : status;
  const domainStr = domain.join(',');

  const filterValues: FilterValues = {
    search: debouncedSearch,
    status: statusStr,
    requestor: debouncedRequestor,
    dateFrom,
    dateTo,
    domain: domainStr,
  };

  const uiState = {
    search, status, requestor, domain, datePreset, customDateFrom, customDateTo,
    handleSearchChange, handleStatusChange, handleRequestorChange, handleDomainChange,
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
  const { searchPlaceholder = 'Search by ID or Name...', statusOptions, statusMultiSelect, domainOptions, hideRequestor } = config;

  return (
    <div style={{ marginBottom: 8 }}>
      <Space wrap size="small" style={{ width: '100%' }}>
        {/* Search */}
        <Input.Search
          placeholder={searchPlaceholder}
          value={uiState.search}
          onChange={(e) => uiState.handleSearchChange(e.target.value)}
          allowClear
          size="small"
          style={{ width: 240 }}
          data-testid="search-input"
        />

        {/* Status */}
        {statusOptions.length > 0 && (
          <Space size={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>Status</Text>
            {statusMultiSelect ? (
              <Select
                mode="multiple"
                size="small"
                value={Array.isArray(uiState.status) ? uiState.status : (uiState.status ? [uiState.status] : [])}
                onChange={(v: string[]) => uiState.handleStatusChange(v)}
                placeholder="All"
                allowClear
                style={{ minWidth: 160 }}
                maxTagCount="responsive"
                data-testid="status-filter"
                options={statusOptions.filter(Boolean).map((s) => ({ value: s, label: s }))}
              />
            ) : (
              <Select
                size="small"
                value={(uiState.status as string) || undefined}
                onChange={(v) => uiState.handleStatusChange(v ?? '')}
                placeholder="All"
                allowClear
                style={{ minWidth: 120 }}
                data-testid="status-filter"
                options={statusOptions.filter(Boolean).map((s) => ({ value: s, label: s }))}
              />
            )}
          </Space>
        )}

        {/* Domain (only shown when domainOptions provided) */}
        {domainOptions && domainOptions.length > 0 && (
          <Space size={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>Domain</Text>
            <Select
              mode="multiple"
              size="small"
              value={uiState.domain}
              onChange={(v: string[]) => uiState.handleDomainChange(v)}
              placeholder="All"
              allowClear
              style={{ minWidth: 160 }}
              maxTagCount="responsive"
              data-testid="domain-filter"
              options={domainOptions}
            />
          </Space>
        )}

        {/* Requestor */}
        {!hideRequestor && (
          <Space size={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>Requestor</Text>
            <Input
              placeholder="Name or ID..."
              size="small"
              value={uiState.requestor}
              onChange={(e) => uiState.handleRequestorChange(e.target.value)}
              allowClear
              style={{ width: 130 }}
              data-testid="requestor-filter"
            />
          </Space>
        )}

        {/* Period */}
        <Space size={4}>
          <Text type="secondary" style={{ fontSize: 12 }}>Period</Text>
          <div data-testid="date-filter">
            <Select
              size="small"
              value={uiState.datePreset || undefined}
              onChange={(v) => uiState.handleDatePresetChange(v ?? '')}
              placeholder="All Time"
              allowClear
              style={{ minWidth: 100 }}
              options={DATE_PRESETS.map((p) => ({ value: p.value || 'all', label: p.label }))}
            />
          </div>
          {uiState.datePreset === 'custom' && (
            <DatePicker.RangePicker
              size="small"
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

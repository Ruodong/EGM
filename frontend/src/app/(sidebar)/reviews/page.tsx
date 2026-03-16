'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { statusHex } from '@/lib/constants';
import Link from 'next/link';
import { useState, useCallback, useMemo } from 'react';
import { Button, Input, Select, Tag, Typography, DatePicker } from 'antd';
import { SearchOutlined, UndoOutlined } from '@ant-design/icons';
import DataTable, { type Column } from '@/components/shared/DataTable';
import MultiSelect, { type MultiSelectOption } from '@/components/shared/MultiSelect';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const DATE_PRESETS = [
  { label: 'All Time', value: 'all' },
  { label: '1 Day', value: '1d' },
  { label: '7 Days', value: '7d' },
  { label: '1 Month', value: '1m' },
  { label: '3 Months', value: '3m' },
  { label: 'Custom', value: 'custom' },
];

const STATUS_OPTIONS: MultiSelectOption[] = [
  { value: 'Waiting for Accept', label: 'Waiting for Accept' },
  { value: 'Return for Additional Information', label: 'Return for Additional Information' },
  { value: 'Accept', label: 'Accept' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Approved with Exception', label: 'Approved with Exception' },
  { value: 'Not Passed', label: 'Not Passed' },
];

interface DomainReview {
  id: string;
  requestId: string;
  govRequestId: string;
  domainCode: string;
  domainName: string;
  status: string;
  outcome: string | null;
  reviewer: string | null;
  reviewerName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  projectName: string | null;
  requestor: string | null;
  requestorName: string | null;
  govStatus: string | null;
  govCreateAt: string | null;
}

interface PaginatedResponse {
  data: DomainReview[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface DomainRegistryItem {
  domainCode: string;
  domainName: string;
  isActive: boolean;
}

interface AppliedFilters {
  search: string;
  requestor: string;
  status: string;
  domain: string;
  dateFrom: string;
  dateTo: string;
}

const INITIAL_FILTERS: AppliedFilters = {
  search: '',
  requestor: '',
  status: '',
  domain: '',
  dateFrom: '',
  dateTo: '',
};

function computeDateRange(preset: string, customFrom: string, customTo: string) {
  if (preset === 'custom') return { dateFrom: customFrom, dateTo: customTo };
  if (!preset || preset === 'all') return { dateFrom: '', dateTo: '' };
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  let from: Date;
  switch (preset) {
    case '1d': from = new Date(now.getTime() - 1 * 86400000); break;
    case '7d': from = new Date(now.getTime() - 7 * 86400000); break;
    case '1m': from = new Date(now); from.setMonth(from.getMonth() - 1); break;
    case '3m': from = new Date(now); from.setMonth(from.getMonth() - 3); break;
    default: return { dateFrom: '', dateTo: '' };
  }
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: to };
}

export default function AllReviewsPage() {
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState('create_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  // Draft filter state
  const [search, setSearch] = useState('');
  const [requestor, setRequestor] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [domainFilter, setDomainFilter] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState('');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');

  // Applied filters
  const [applied, setApplied] = useState<AppliedFilters>(INITIAL_FILTERS);

  const handleSearch = useCallback(() => {
    const { dateFrom, dateTo } = computeDateRange(datePreset, customDateFrom, customDateTo);
    setApplied({
      search,
      requestor,
      status: statusFilter.join(','),
      domain: domainFilter.join(','),
      dateFrom,
      dateTo,
    });
    setPage(1);
  }, [search, requestor, statusFilter, domainFilter, datePreset, customDateFrom, customDateTo]);

  const handleReset = useCallback(() => {
    setSearch('');
    setRequestor('');
    setStatusFilter([]);
    setDomainFilter([]);
    setDatePreset('');
    setCustomDateFrom('');
    setCustomDateTo('');
    setApplied(INITIAL_FILTERS);
    setPage(1);
  }, []);

  // Fetch domain options for the filter
  const { data: domains } = useQuery<{ data: DomainRegistryItem[] }>({
    queryKey: ['domain-registry'],
    queryFn: () => api.get('/domain-registry'),
    staleTime: 5 * 60 * 1000,
  });

  const domainOptions: MultiSelectOption[] = useMemo(() =>
    (domains?.data ?? [])
      .filter((d) => d.isActive)
      .map((d) => ({ value: d.domainCode, label: `${d.domainName || d.domainCode} (${d.domainCode})` })),
    [domains]
  );

  const handleSort = useCallback((field: string, order: 'ASC' | 'DESC') => {
    setSortField(field);
    setSortOrder(order);
    setPage(1);
  }, []);

  const { data, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ['all-domain-reviews', page, applied, sortField, sortOrder],
    queryFn: () =>
      api.get('/domain-reviews', {
        page,
        pageSize: 20,
        sortField,
        sortOrder,
        ...(applied.status && { status: applied.status }),
        ...(applied.domain && { domainCode: applied.domain }),
        ...(applied.search && { search: applied.search }),
        ...(applied.requestor && { requestor: applied.requestor }),
        ...(applied.dateFrom && { dateFrom: applied.dateFrom }),
        ...(applied.dateTo && { dateTo: applied.dateTo }),
      }),
  });

  const columns: Column<DomainReview>[] = [
    {
      key: 'gov_request_id',
      label: 'Request ID',
      render: (r) => (
        <Link href={`/governance/${r.govRequestId || r.requestId}/reviews/${r.domainCode}`} className="text-primary-blue hover:underline">
          {r.govRequestId || r.requestId}
        </Link>
      ),
      exportValue: (r) => r.govRequestId || r.requestId,
    },
    {
      key: 'project_name',
      label: 'Project Name',
      render: (r) => <span title={r.projectName || ''}>{r.projectName || '-'}</span>,
      exportValue: (r) => r.projectName || '',
    },
    {
      key: 'requestor_name',
      label: 'Requestor',
      render: (r) => <>{r.requestorName || r.requestor || '-'}</>,
      exportValue: (r) => r.requestorName || r.requestor || '',
    },
    {
      key: 'gov_status',
      label: 'Request Status',
      render: (r) => r.govStatus ? (
        <Tag color={statusHex[r.govStatus] || '#9CA3AF'}>{r.govStatus}</Tag>
      ) : <Text type="secondary">-</Text>,
      exportValue: (r) => r.govStatus || '',
    },
    {
      key: 'domain',
      label: 'Domain',
      render: (r) => <span className="font-medium">{r.domainName || r.domainCode}</span>,
      exportValue: (r) => r.domainName || r.domainCode,
    },
    {
      key: 'review_status',
      label: 'Review Status',
      render: (r) => {
        const label = r.outcome || r.status;
        return (
          <Tag color={statusHex[label] || '#9CA3AF'}>{label}</Tag>
        );
      },
      exportValue: (r) => r.outcome || r.status,
    },
    {
      key: 'gov_create_at',
      label: 'Created',
      render: (r) => (
        <Text type="secondary">
          {r.govCreateAt ? new Date(r.govCreateAt).toLocaleDateString() : '-'}
        </Text>
      ),
      exportValue: (r) => r.govCreateAt ? new Date(r.govCreateAt).toLocaleDateString() : '',
    },
  ];

  return (
    <div>
      <Title level={4} style={{ margin: 0, marginBottom: 16 }}>All Domain Reviews</Title>

      <div className="border border-border-light rounded-lg px-3 py-2.5 mb-3">
        {/* Row 1 */}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Input
            placeholder="Request ID / Project Name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={handleSearch}
            allowClear
            size="small"
            style={{ width: 220 }}
          />
          <MultiSelect
            options={STATUS_OPTIONS}
            selected={statusFilter}
            onChange={setStatusFilter}
            placeholder="Review Status"
            size="small"
          />
          <Select
            size="small"
            value={datePreset || undefined}
            onChange={(v) => setDatePreset(v ?? '')}
            placeholder="Period"
            allowClear
            style={{ minWidth: 110 }}
            options={DATE_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
          />
          {datePreset === 'custom' && (
            <DatePicker.RangePicker
              size="small"
              value={[
                customDateFrom ? dayjs(customDateFrom) : null,
                customDateTo ? dayjs(customDateTo) : null,
              ]}
              onChange={(dates) => {
                setCustomDateFrom(dates?.[0]?.format('YYYY-MM-DD') ?? '');
                setCustomDateTo(dates?.[1]?.format('YYYY-MM-DD') ?? '');
              }}
            />
          )}
        </div>
        {/* Row 2 */}
        <div className="flex flex-wrap items-center gap-2">
          <MultiSelect
            options={domainOptions}
            selected={domainFilter}
            onChange={setDomainFilter}
            placeholder="Domain"
            size="small"
          />
          <Input
            placeholder="Requestor"
            size="small"
            value={requestor}
            onChange={(e) => setRequestor(e.target.value)}
            onPressEnter={handleSearch}
            allowClear
            style={{ width: 150 }}
          />
          <Button type="primary" size="small" icon={<SearchOutlined />} onClick={handleSearch}>
            Search
          </Button>
          <Button size="small" icon={<UndoOutlined />} onClick={handleReset}>
            Reset
          </Button>
        </div>
      </div>

      <DataTable<DomainReview>
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        rowKey={(r) => r.id}
        sortField={sortField}
        sortOrder={sortOrder}
        onSort={handleSort}
        exportFilename="domain-reviews"
        pagination={
          data && data.totalPages > 1
            ? {
                page,
                totalPages: data.totalPages,
                total: data.total,
                pageSize: 20,
                onPageChange: setPage,
              }
            : undefined
        }
      />
    </div>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { statusHex } from '@/lib/constants';
import Link from 'next/link';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Input, Select, Typography, Tooltip, DatePicker } from 'antd';
import { PlusOutlined, SearchOutlined, UndoOutlined } from '@ant-design/icons';
import DataTable, { type Column } from '@/components/shared/DataTable';
import MultiSelect, { type MultiSelectOption } from '@/components/shared/MultiSelect';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/lib/locale-context';
import dayjs from 'dayjs';

const { Title } = Typography;

/** Review status labels shown in legend. */
const REVIEW_STATUSES = [
  'Waiting for Accept',
  'Return for Additional Information',
  'Accept',
  'Approved',
  'Approved with Exception',
  'Not Passed',
];

const REVIEW_STATUS_OPTIONS: MultiSelectOption[] = REVIEW_STATUSES.map((s) => ({
  value: s,
  label: s,
}));

interface DomainOption {
  domainCode: string;
  domainName: string;
}

interface DomainReviewSummary {
  domainCode: string;
  status: string;
  outcome: string | null;
}

interface GovRequest {
  id: string;
  requestId: string;
  title: string;
  govProjectType: string | null;
  projectName: string | null;
  projectDescription: string | null;
  status: string;
  lifecycleStatus: string;
  domainReviews: DomainReviewSummary[];
  requestor: string;
  requestorName: string;
  createAt: string;
}

interface PaginatedResponse {
  data: GovRequest[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/* ─── Applied filter state (only used for API queries) ─── */
interface AppliedFilters {
  search: string;
  requestor: string;
  status: string[];
  domain: string[];
  lifecycle: string[];
  reviewStatus: string[];
  dateFrom: string;
  dateTo: string;
}

const INITIAL_FILTERS: AppliedFilters = {
  search: '',
  requestor: '',
  status: [],
  domain: [],
  lifecycle: ['Active'],
  reviewStatus: [],
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

export default function RequestsPage() {
  const { hasRole } = useAuth();
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const isRequestorOnly = !hasRole('admin', 'governance_lead', 'domain_reviewer');

  const DATE_PRESETS = [
    { label: t('date.allTime'), value: 'all' },
    { label: t('date.1day'), value: '1d' },
    { label: t('date.7days'), value: '7d' },
    { label: t('date.1month'), value: '1m' },
    { label: t('date.3months'), value: '3m' },
    { label: t('date.custom'), value: 'custom' },
  ];

  const STATUS_OPTIONS: MultiSelectOption[] = [
    { value: 'Draft', label: t('status.draft') },
    { value: 'Submitted', label: t('status.submitted') },
    { value: 'In Progress', label: t('status.inProgress') },
    { value: 'Complete', label: t('status.complete') },
  ];

  const LIFECYCLE_OPTIONS: MultiSelectOption[] = [
    { value: 'Active', label: t('status.active') },
    { value: 'Archived', label: t('status.archived') },
    { value: 'Cancelled', label: t('status.cancelled') },
  ];

  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState('create_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  // ── Draft filter state (user edits these, not applied until Search) ──
  const [search, setSearch] = useState('');
  const [requestor, setRequestor] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [domainFilter, setDomainFilter] = useState<string[]>([]);
  const [lifecycleFilter, setLifecycleFilter] = useState<string[]>(['Active']);
  const [reviewStatusFilter, setReviewStatusFilter] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState('');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');

  // ── Applied filters (drives API query, updated only on Search click) ──
  const [applied, setApplied] = useState<AppliedFilters>(INITIAL_FILTERS);

  // ── Read URL query params on mount (e.g. from dashboard stat cards) ──
  const [urlParamsApplied, setUrlParamsApplied] = useState(false);
  useEffect(() => {
    if (urlParamsApplied) return;
    const urlStatus = searchParams.get('status');
    if (urlStatus) {
      const statuses = urlStatus.split(',').map(s => s.trim());
      setStatusFilter(statuses);
      setApplied(prev => ({ ...prev, status: statuses }));
    }
    setUrlParamsApplied(true);
  }, [searchParams, urlParamsApplied]);

  const handleSearch = useCallback(() => {
    const { dateFrom, dateTo } = computeDateRange(datePreset, customDateFrom, customDateTo);
    setApplied({
      search,
      requestor,
      status: statusFilter,
      domain: domainFilter,
      lifecycle: lifecycleFilter,
      reviewStatus: reviewStatusFilter,
      dateFrom,
      dateTo,
    });
    setPage(1);
  }, [search, requestor, statusFilter, domainFilter, lifecycleFilter, reviewStatusFilter, datePreset, customDateFrom, customDateTo]);

  const handleReset = useCallback(() => {
    setSearch('');
    setRequestor('');
    setStatusFilter([]);
    setDomainFilter([]);
    setLifecycleFilter(['Active']);
    setReviewStatusFilter([]);
    setDatePreset('');
    setCustomDateFrom('');
    setCustomDateTo('');
    setApplied(INITIAL_FILTERS);
    setPage(1);
  }, []);

  const { data: domainsData } = useQuery<{ data: DomainOption[] }>({
    queryKey: ['domains'],
    queryFn: () => api.get('/domains'),
  });

  const domainList = domainsData?.data || [];
  const domainOptions: MultiSelectOption[] = domainList.map((d) => ({
    value: d.domainCode,
    label: `${d.domainName} (${d.domainCode})`,
  }));
  const domainNameMap: Record<string, string> = {};
  for (const d of domainList) domainNameMap[d.domainCode] = d.domainName;

  const handleSort = useCallback((field: string, order: 'ASC' | 'DESC') => {
    setSortField(field);
    setSortOrder(order);
    setPage(1);
  }, []);

  // Build API params from applied filters
  const statusParam = applied.status.join(',');
  const domainParam = applied.domain.join(',');
  const lifecycleParam = applied.lifecycle.join(',');
  const reviewStatusParam = applied.reviewStatus.join(',');

  const { data, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ['governance-requests', page, applied, sortField, sortOrder],
    queryFn: () =>
      api.get('/governance-requests', {
        page,
        pageSize: 20,
        sortField,
        sortOrder,
        ...(statusParam && { status: statusParam }),
        ...(applied.search && { search: applied.search }),
        ...(applied.requestor && { requestor: applied.requestor }),
        ...(applied.dateFrom && { dateFrom: applied.dateFrom }),
        ...(applied.dateTo && { dateTo: applied.dateTo }),
        ...(domainParam && { domain: domainParam }),
        ...(lifecycleParam && { lifecycleStatus: lifecycleParam }),
        ...(reviewStatusParam && { reviewStatus: reviewStatusParam }),
      }),
  });

  // ── Column definitions ───────────────────────

  const columns: Column<GovRequest>[] = [
    {
      key: 'request_id',
      label: t('col.requestId'),
      sortable: true,
      render: (r) => (
        <Link href={`/governance/${r.requestId}`} className="text-primary-blue hover:underline">
          {r.requestId}
        </Link>
      ),
      exportValue: (r) => r.requestId,
    },
    {
      key: 'project_name',
      label: t('col.projectName'),
      sortable: true,
      render: (r) => (
        <Tooltip title={r.projectName || ''}>
          <span className="block max-w-[180px] truncate" title={r.projectDescription || ''}>
            {r.projectName || '-'}
          </span>
        </Tooltip>
      ),
      exportValue: (r) => r.projectName || '',
    },
    {
      key: 'status',
      label: t('col.status'),
      sortable: true,
      render: (r) => (
        <div className="flex justify-center">
          <span
            className="px-2 py-0.5 rounded text-xs text-white whitespace-nowrap"
            style={{ backgroundColor: statusHex[r.status] || '#9CA3AF' }}
          >
            {r.status}
          </span>
        </div>
      ),
      exportValue: (r) => r.status,
    },
    {
      key: 'domainReviews',
      label: t('col.reviewStatus'),
      render: (r) => {
        if (!r.domainReviews?.length) return <span className="text-text-secondary">-</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {r.domainReviews.map((dr) => {
              const label = dr.outcome || dr.status;
              const fullText = `${domainNameMap[dr.domainCode] || dr.domainCode}: ${label}`;
              return (
                <Tooltip key={dr.domainCode} title={fullText}>
                  <span
                    className="inline-flex items-center justify-center rounded px-1.5 h-5 text-[10px] font-bold text-white leading-none cursor-help"
                    style={{ backgroundColor: statusHex[label] || '#9CA3AF' }}
                  >
                    {dr.domainCode}
                  </span>
                </Tooltip>
              );
            })}
          </div>
        );
      },
      exportValue: (r) =>
        (r.domainReviews || []).map((dr) => `${dr.domainCode}: ${dr.outcome || dr.status}`).join('; '),
    },
    ...(!isRequestorOnly ? [{
      key: 'requestor',
      label: t('col.requestor'),
      sortable: true,
      render: (r: GovRequest) => <span className="whitespace-nowrap">{r.requestorName || r.requestor}</span>,
      exportValue: (r: GovRequest) => r.requestorName || r.requestor,
    }] : []),
    {
      key: 'create_at',
      label: t('col.created'),
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>{t('requests.title')}</Title>
        {isRequestorOnly && (
          <Link href="/governance/create">
            <Button type="primary" icon={<PlusOutlined />} size="small" style={{ background: '#13C2C2', borderColor: '#13C2C2' }}>
              {t('requests.newRequest')}
            </Button>
          </Link>
        )}
      </div>

      {/* ── Filters & Legend ── */}
      <div className="space-y-2 mb-3">
        {/* Filters */}
        <div className="border border-border-light rounded-lg px-3 py-2.5">
          {/* Row 1 */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Input
              placeholder={t('requests.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onPressEnter={handleSearch}
              allowClear
              size="small"
              style={{ width: 220 }}
              data-testid="search-input"
            />
            <MultiSelect
              options={LIFECYCLE_OPTIONS}
              selected={lifecycleFilter}
              onChange={setLifecycleFilter}
              placeholder={t('requests.lifecycle')}
              size="small"
              data-testid="lifecycle-filter"
            />
            <MultiSelect
              options={STATUS_OPTIONS}
              selected={statusFilter}
              onChange={setStatusFilter}
              placeholder={t('col.requestStatus')}
              size="small"
              data-testid="status-filter"
            />
            <div data-testid="date-filter">
              <Select
                size="small"
                value={datePreset || undefined}
                onChange={(v) => setDatePreset(v ?? '')}
                placeholder={t('requests.period')}
                allowClear
                style={{ minWidth: 110 }}
                options={DATE_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
              />
            </div>
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
              placeholder={t('col.domain')}
              size="small"
              data-testid="domain-filter"
            />
            <MultiSelect
              options={REVIEW_STATUS_OPTIONS}
              selected={reviewStatusFilter}
              onChange={setReviewStatusFilter}
              placeholder={t('col.reviewStatus')}
              size="small"
              data-testid="review-status-filter"
            />
            {!isRequestorOnly && (
              <Input
                placeholder={t('requests.requestorPlaceholder')}
                size="small"
                value={requestor}
                onChange={(e) => setRequestor(e.target.value)}
                onPressEnter={handleSearch}
                allowClear
                style={{ width: 150 }}
                data-testid="requestor-filter"
              />
            )}
            <Button type="primary" size="small" icon={<SearchOutlined />} onClick={handleSearch} data-testid="search-button">
              {t('common.search')}
            </Button>
            <Button size="small" icon={<UndoOutlined />} onClick={handleReset}>
              {t('common.reset')}
            </Button>
          </div>
        </div>

        {/* Legend */}
        {domainList.length > 0 && (
          <div className="border border-border-light rounded-lg px-3 py-2 text-[11px] text-text-secondary">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-text-primary" style={{ fontSize: 11 }}>{t('requests.governanceDomains')}</span>
              {domainList.map((d) => (
                <span key={d.domainCode} className="inline-flex items-center gap-0.5">
                  <span className="font-semibold text-text-primary">{d.domainCode}</span>
                  <span>{d.domainName}</span>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-text-primary" style={{ fontSize: 11 }}>{t('requests.domainReviewStatus')}</span>
              {REVIEW_STATUSES.map((status) => (
                <span key={status} className="inline-flex items-center gap-0.5">
                  <span
                    className="inline-block w-3 h-3 rounded"
                    style={{ backgroundColor: statusHex[status] || '#9CA3AF' }}
                  />
                  <span>{status}</span>
                </span>
              ))}
            </div>
          </div>
        )}
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
                pageSize: 20,
                onPageChange: setPage,
              }
            : undefined
        }
      />
    </div>
  );
}

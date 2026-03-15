'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { statusHex } from '@/lib/constants';
import Link from 'next/link';
import { useState, useCallback } from 'react';
import { Button, Space, Typography, Tooltip } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import DataTable, { type Column } from '@/components/shared/DataTable';
import FilterBar, { useFilterState, type FilterBarConfig } from '@/components/shared/FilterBar';
import MultiSelect, { type MultiSelectOption } from '@/components/shared/MultiSelect';
import { useAuth } from '@/lib/auth-context';

const { Title, Text } = Typography;

/** Review status labels shown in legend. */
const REVIEW_STATUSES = [
  'Waiting for Accept',
  'Return for Additional Information',
  'Accept',
  'Approved',
  'Approved with Exception',
  'Not Passed',
];

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

const FILTER_CONFIG_BASE = {
  searchPlaceholder: 'Search by Request ID or Project Name...',
  statusOptions: [] as string[],
};

const STATUS_OPTIONS: MultiSelectOption[] = [
  { value: 'Draft', label: 'Draft' },
  { value: 'Submitted', label: 'Submitted' },
  { value: 'In Progress', label: 'In Progress' },
  { value: 'Complete', label: 'Complete' },
];

const LIFECYCLE_OPTIONS: MultiSelectOption[] = [
  { value: 'Active', label: 'Active' },
  { value: 'Archived', label: 'Archived' },
  { value: 'Cancelled', label: 'Cancelled' },
];

export default function RequestsPage() {
  const { hasRole } = useAuth();
  const isRequestorOnly = !hasRole('admin', 'governance_lead', 'domain_reviewer');

  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState('create_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [domainFilter, setDomainFilter] = useState<string[]>([]);
  const [lifecycleFilter, setLifecycleFilter] = useState<string[]>(['Active']);

  const { filterValues, uiState } = useFilterState(() => setPage(1));

  const { data: domainsData } = useQuery<{ data: DomainOption[] }>({
    queryKey: ['domains'],
    queryFn: () => api.get('/domains'),
  });

  const domainList = domainsData?.data || [];
  const domainOptions: MultiSelectOption[] = domainList.map((d) => ({
    value: d.domainCode,
    label: `${d.domainName} (${d.domainCode})`,
  }));
  // Lookup map: code → name for tooltips
  const domainNameMap: Record<string, string> = {};
  for (const d of domainList) domainNameMap[d.domainCode] = d.domainName;


  const handleSort = useCallback((field: string, order: 'ASC' | 'DESC') => {
    setSortField(field);
    setSortOrder(order);
    setPage(1);
  }, []);

  // Join arrays into comma-separated strings for API
  const statusParam = statusFilter.join(',');
  const domainParam = domainFilter.join(',');
  const lifecycleParam = lifecycleFilter.join(',');

  const { data, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ['governance-requests', page, filterValues, sortField, sortOrder, statusParam, domainParam, lifecycleParam],
    queryFn: () =>
      api.get('/governance-requests', {
        page,
        pageSize: 20,
        sortField,
        sortOrder,
        ...(statusParam && { status: statusParam }),
        ...(filterValues.search && { search: filterValues.search }),
        ...(filterValues.requestor && { requestor: filterValues.requestor }),
        ...(filterValues.dateFrom && { dateFrom: filterValues.dateFrom }),
        ...(filterValues.dateTo && { dateTo: filterValues.dateTo }),
        ...(domainParam && { domain: domainParam }),
        ...(lifecycleParam && { lifecycleStatus: lifecycleParam }),
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
      key: 'project_name',
      label: 'Project Name',
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
      label: 'Status',
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
      label: 'Review Status',
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
      label: 'Requestor',
      sortable: true,
      render: (r: GovRequest) => <span className="whitespace-nowrap">{r.requestorName || r.requestor}</span>,
      exportValue: (r: GovRequest) => r.requestorName || r.requestor,
    }] : []),
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Governance Requests</Title>
        {isRequestorOnly && (
          <Link href="/governance/create">
            <Button type="primary" icon={<PlusOutlined />} size="small" style={{ background: '#13C2C2', borderColor: '#13C2C2' }}>
              New Request
            </Button>
          </Link>
        )}
      </div>

      {/* ── Filters & Legend: two compact side-by-side sections ── */}
      <div className="flex flex-wrap gap-3 mb-3">
        {/* Section 1: Filters */}
        <div className="flex-1 min-w-[320px] border border-border-light rounded-lg px-3 py-2">
          <div className="text-xs font-medium text-text-secondary mb-1.5">Filters</div>
          <FilterBar config={{ ...FILTER_CONFIG_BASE, hideRequestor: isRequestorOnly }} uiState={uiState} />
          <Space wrap size="small">
            <Space size={4}>
              <Text type="secondary" style={{ fontSize: 12 }}>Status</Text>
              <MultiSelect
                options={STATUS_OPTIONS}
                selected={statusFilter}
                onChange={(v) => { setStatusFilter(v); setPage(1); }}
                placeholder="All"
                size="small"
                data-testid="status-filter"
              />
            </Space>
            <Space size={4}>
              <Text type="secondary" style={{ fontSize: 12 }}>Domain</Text>
              <MultiSelect
                options={domainOptions}
                selected={domainFilter}
                onChange={(v) => { setDomainFilter(v); setPage(1); }}
                placeholder="All"
                size="small"
                data-testid="domain-filter"
              />
            </Space>
            <Space size={4}>
              <Text type="secondary" style={{ fontSize: 12 }}>Lifecycle</Text>
              <MultiSelect
                options={LIFECYCLE_OPTIONS}
                selected={lifecycleFilter}
                onChange={(v) => { setLifecycleFilter(v); setPage(1); }}
                placeholder="All"
                size="small"
                data-testid="lifecycle-filter"
              />
            </Space>
          </Space>
        </div>

        {/* Section 2: Legend */}
        {domainList.length > 0 && (
          <div className="min-w-[220px] border border-border-light rounded-lg px-3 py-2 text-[11px] text-text-secondary">
            <div className="font-medium text-text-secondary mb-1.5" style={{ fontSize: 12 }}>Legend</div>
            {/* Domain codes → names */}
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="font-semibold text-text-primary" style={{ fontSize: 12 }}>Governance Domains:</span>
              {domainList.map((d) => (
                <span key={d.domainCode} className="inline-flex items-center gap-0.5">
                  <span className="font-semibold text-text-primary">{d.domainCode}</span>
                  <span>{d.domainName}</span>
                </span>
              ))}
            </div>
            {/* Review status colours */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-text-primary" style={{ fontSize: 12 }}>Domain Review Status:</span>
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

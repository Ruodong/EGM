'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { statusHex } from '@/lib/constants';
import Link from 'next/link';
import { useState, useCallback } from 'react';
import { Button, Tag, Space, Typography, Tooltip } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import DataTable, { type Column } from '@/components/shared/DataTable';
import FilterBar, { useFilterState, type FilterBarConfig } from '@/components/shared/FilterBar';
import MultiSelect, { type MultiSelectOption } from '@/components/shared/MultiSelect';

const { Title, Text } = Typography;

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

const FILTER_CONFIG: FilterBarConfig = {
  searchPlaceholder: 'Search by Request ID or Project Name...',
  statusOptions: [],  // Status filter moved to second row as multi-select
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
        <span title={r.projectDescription || ''}>
          {r.projectName || '-'}
        </span>
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
            className="px-2 py-0.5 rounded text-xs text-white"
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
      label: 'Domain Review Status',
      render: (r) => {
        if (!r.domainReviews?.length) return <span className="text-text-secondary">-</span>;
        return (
          <div className="flex flex-col gap-1">
            {r.domainReviews.map((dr) => {
              const label = dr.outcome || dr.status;
              return (
                <div key={dr.domainCode} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-text-primary cursor-help" title={domainNameMap[dr.domainCode] || dr.domainCode}>{dr.domainCode}</span>
                  <span
                    className="px-2 py-0.5 rounded text-white whitespace-nowrap"
                    style={{ backgroundColor: statusHex[label] || '#9CA3AF' }}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        );
      },
      exportValue: (r) =>
        (r.domainReviews || []).map((dr) => `${dr.domainCode}: ${dr.outcome || dr.status}`).join('; '),
    },
    {
      key: 'requestor',
      label: 'Requestor',
      sortable: true,
      render: (r) => <>{r.requestorName || r.requestor}</>,
      exportValue: (r) => r.requestorName || r.requestor,
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>Governance Requests</Title>
        <Link href="/governance/create">
          <Button type="primary" icon={<PlusOutlined />} style={{ background: '#13C2C2', borderColor: '#13C2C2' }}>
            New Request
          </Button>
        </Link>
      </div>

      <FilterBar config={FILTER_CONFIG} uiState={uiState} />

      {/* Second row: Request Status, Related Governance Domain, Request Lifecycle (all multi-select) */}
      <Space wrap size="middle" style={{ marginBottom: 16 }}>
        <Space size="small">
          <Text type="secondary">Request Status</Text>
          <MultiSelect
            options={STATUS_OPTIONS}
            selected={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            placeholder="All"
            data-testid="status-filter"
          />
        </Space>
        <Space size="small">
          <Text type="secondary">Related Governance Domain</Text>
          <MultiSelect
            options={domainOptions}
            selected={domainFilter}
            onChange={(v) => { setDomainFilter(v); setPage(1); }}
            placeholder="All"
            data-testid="domain-filter"
          />
        </Space>
        <Space size="small">
          <Text type="secondary">Request Lifecycle</Text>
          <MultiSelect
            options={LIFECYCLE_OPTIONS}
            selected={lifecycleFilter}
            onChange={(v) => { setLifecycleFilter(v); setPage(1); }}
            placeholder="All"
            data-testid="lifecycle-filter"
          />
        </Space>
      </Space>

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

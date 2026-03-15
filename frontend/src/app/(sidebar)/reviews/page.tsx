'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { statusHex } from '@/lib/constants';
import Link from 'next/link';
import { useState, useCallback, useMemo } from 'react';
import { Tag, Typography } from 'antd';
import DataTable, { type Column } from '@/components/shared/DataTable';
import FilterBar, { useFilterState, type FilterBarConfig } from '@/components/shared/FilterBar';

const { Title, Text } = Typography;

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

export default function AllReviewsPage() {
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState('create_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  // Fetch domain options for the filter
  const { data: domains } = useQuery<{ data: DomainRegistryItem[] }>({
    queryKey: ['domain-registry'],
    queryFn: () => api.get('/domain-registry'),
    staleTime: 5 * 60 * 1000, // cache 5 minutes
  });

  const domainOptions = useMemo(() =>
    (domains?.data ?? [])
      .filter((d) => d.isActive)
      .map((d) => ({ value: d.domainCode, label: d.domainName || d.domainCode })),
    [domains]
  );

  const filterConfig: FilterBarConfig = useMemo(() => ({
    searchPlaceholder: 'Search by Request ID or Project Name...',
    statusOptions: ['', 'Waiting for Accept', 'Return for Additional Information', 'Accept', 'Approved', 'Approved with Exception', 'Not Passed'],
    statusMultiSelect: true,
    domainOptions,
  }), [domainOptions]);

  const { filterValues, uiState } = useFilterState(() => setPage(1));

  const handleSort = useCallback((field: string, order: 'ASC' | 'DESC') => {
    setSortField(field);
    setSortOrder(order);
    setPage(1);
  }, []);

  const { data, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ['all-domain-reviews', page, filterValues, sortField, sortOrder],
    queryFn: () =>
      api.get('/domain-reviews', {
        page,
        pageSize: 20,
        sortField,
        sortOrder,
        ...(filterValues.status && { status: filterValues.status }),
        ...(filterValues.domain && { domainCode: filterValues.domain }),
        ...(filterValues.search && { search: filterValues.search }),
        ...(filterValues.requestor && { requestor: filterValues.requestor }),
        ...(filterValues.dateFrom && { dateFrom: filterValues.dateFrom }),
        ...(filterValues.dateTo && { dateTo: filterValues.dateTo }),
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
      <Title level={4} style={{ margin: 0, marginBottom: 24 }}>All Domain Reviews</Title>

      <FilterBar config={filterConfig} uiState={uiState} />

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

'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import Link from 'next/link';
import { useState, useCallback, useMemo } from 'react';
import { Tag, Typography } from 'antd';
import DataTable, { type Column } from '@/components/shared/DataTable';
import FilterBar, { useFilterState, type FilterBarConfig } from '@/components/shared/FilterBar';

const { Title, Text } = Typography;

interface ActionItem {
  id: string;
  domainReviewId: string;
  actionNo: number | null;
  title: string;
  description: string | null;
  priority: string;
  actionType: string;
  status: string;
  assignee: string | null;
  assigneeName: string | null;
  domainCode: string;
  domainName: string;
  govRequestId: string;
  govRequestorName: string | null;
  govTitle: string | null;
  createBy: string;
  createByName: string | null;
  createAt: string | null;
  updateAt: string | null;
}

interface DomainRegistryItem {
  domainCode: string;
  domainName: string;
  isActive: boolean;
}

const PRIORITY_HEX: Record<string, string> = {
  High: '#EF4444',
  Medium: '#F59E0B',
  Low: '#6B7280',
};

const ACTION_STATUS_HEX: Record<string, string> = {
  Created: '#8C8C8C',
  Assigned: '#1890FF',
  Closed: '#52C41A',
  Cancelled: '#8C8C8C',
};

const ACTION_TYPE_HEX: Record<string, string> = {
  Mandatory: '#722ED1',
  'Long Term': '#13C2C2',
};

export default function ActionsPage() {
  const [sortField, setSortField] = useState('create_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  // Fetch domain options for the filter
  const { data: domains } = useQuery<{ data: DomainRegistryItem[] }>({
    queryKey: ['domain-registry'],
    queryFn: () => api.get('/domain-registry'),
    staleTime: 5 * 60 * 1000,
  });

  const domainOptions = useMemo(() =>
    (domains?.data ?? [])
      .filter((d) => d.isActive)
      .map((d) => ({ value: d.domainCode, label: d.domainName || d.domainCode })),
    [domains]
  );

  const filterConfig: FilterBarConfig = useMemo(() => ({
    searchPlaceholder: 'Search by title, request ID, or assignee...',
    statusOptions: ['', 'Created', 'Assigned', 'Closed', 'Cancelled'],
    statusMultiSelect: true,
    domainOptions,
  }), [domainOptions]);

  const { filterValues, uiState } = useFilterState(() => {});

  const handleSort = useCallback((field: string, order: 'ASC' | 'DESC') => {
    setSortField(field);
    setSortOrder(order);
  }, []);

  const { data, isLoading } = useQuery<{ data: ActionItem[] }>({
    queryKey: ['review-actions-list', filterValues],
    queryFn: () =>
      api.get('/review-actions', {
        ...(filterValues.status && { status: filterValues.status }),
        ...(filterValues.domain && { domainCode: filterValues.domain }),
        ...(filterValues.search && { search: filterValues.search }),
      }),
  });

  // Client-side sort (API returns pre-sorted by create_at DESC)
  const sortedData = useMemo(() => {
    const items = data?.data ?? [];
    if (!sortField) return items;
    return [...items].sort((a, b) => {
      let va: string | number | null = null;
      let vb: string | number | null = null;
      switch (sortField) {
        case 'create_at': va = a.createAt; vb = b.createAt; break;
        case 'title': va = a.title; vb = b.title; break;
        case 'priority': va = a.priority; vb = b.priority; break;
        case 'status': va = a.status; vb = b.status; break;
        case 'domain': va = a.domainName; vb = b.domainName; break;
        case 'assignee': va = a.assigneeName; vb = b.assigneeName; break;
        case 'gov_request_id': va = a.govRequestId; vb = b.govRequestId; break;
        default: return 0;
      }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = String(va).localeCompare(String(vb));
      return sortOrder === 'ASC' ? cmp : -cmp;
    });
  }, [data, sortField, sortOrder]);

  const columns: Column<ActionItem>[] = [
    {
      key: 'gov_request_id',
      label: 'Request ID',
      sortable: true,
      render: (r) => (
        <Link
          href={`/governance/${r.govRequestId}/reviews/${r.domainCode}`}
          className="text-primary-blue hover:underline"
        >
          {r.govRequestId}
        </Link>
      ),
      exportValue: (r) => r.govRequestId,
    },
    {
      key: 'title',
      label: 'Action Title',
      sortable: true,
      render: (r) => (
        <span title={r.title}>
          {r.actionNo ? `#${r.actionNo} ` : ''}{r.title}
        </span>
      ),
      exportValue: (r) => r.title,
    },
    {
      key: 'domain',
      label: 'Domain',
      sortable: true,
      render: (r) => <span className="font-medium">{r.domainName || r.domainCode}</span>,
      exportValue: (r) => r.domainName || r.domainCode,
    },
    {
      key: 'priority',
      label: 'Priority',
      sortable: true,
      render: (r) => (
        <Tag color={PRIORITY_HEX[r.priority] || '#6B7280'}>{r.priority}</Tag>
      ),
      exportValue: (r) => r.priority,
    },
    {
      key: 'action_type',
      label: 'Type',
      render: (r) => (
        <Tag color={ACTION_TYPE_HEX[r.actionType] || '#8C8C8C'}>{r.actionType}</Tag>
      ),
      exportValue: (r) => r.actionType,
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (r) => (
        <Tag color={ACTION_STATUS_HEX[r.status] || '#8C8C8C'}>{r.status}</Tag>
      ),
      exportValue: (r) => r.status,
    },
    {
      key: 'assignee',
      label: 'Assignee',
      sortable: true,
      render: (r) => <>{r.assigneeName || r.assignee || '-'}</>,
      exportValue: (r) => r.assigneeName || r.assignee || '',
    },
    {
      key: 'create_at',
      label: 'Created',
      sortable: true,
      render: (r) => (
        <Text type="secondary">
          {r.createAt ? new Date(r.createAt).toLocaleDateString() : '-'}
        </Text>
      ),
      exportValue: (r) => r.createAt ? new Date(r.createAt).toLocaleDateString() : '',
    },
  ];

  return (
    <div>
      <Title level={4} style={{ margin: 0, marginBottom: 24 }}>Review Actions</Title>

      <FilterBar config={filterConfig} uiState={uiState} />

      <DataTable<ActionItem>
        columns={columns}
        data={sortedData}
        isLoading={isLoading}
        rowKey={(r) => r.id}
        sortField={sortField}
        sortOrder={sortOrder}
        onSort={handleSort}
        exportFilename="review-actions"
      />
    </div>
  );
}

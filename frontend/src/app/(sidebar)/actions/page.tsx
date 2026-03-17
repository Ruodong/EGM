'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import Link from 'next/link';
import { useState, useCallback, useMemo } from 'react';
import { Button, Input, Tag, Typography } from 'antd';
import { SearchOutlined, UndoOutlined } from '@ant-design/icons';
import DataTable, { type Column } from '@/components/shared/DataTable';
import MultiSelect, { type MultiSelectOption } from '@/components/shared/MultiSelect';
import { useLocale } from '@/lib/locale-context';

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

interface AppliedFilters {
  search: string;
  status: string;
  domain: string;
}

const INITIAL_FILTERS: AppliedFilters = {
  search: '',
  status: '',
  domain: '',
};

export default function ActionsPage() {
  const { t } = useLocale();

  const STATUS_OPTIONS: MultiSelectOption[] = [
    { value: 'Created', label: t('actionStatus.created') },
    { value: 'Assigned', label: t('actionStatus.assigned') },
    { value: 'Closed', label: t('actionStatus.closed') },
    { value: 'Cancelled', label: t('actionStatus.cancelled') },
  ];

  const [sortField, setSortField] = useState('create_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  // Draft filter state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [domainFilter, setDomainFilter] = useState<string[]>([]);

  // Applied filters
  const [applied, setApplied] = useState<AppliedFilters>(INITIAL_FILTERS);

  const handleSearch = useCallback(() => {
    setApplied({
      search,
      status: statusFilter.join(','),
      domain: domainFilter.join(','),
    });
  }, [search, statusFilter, domainFilter]);

  const handleReset = useCallback(() => {
    setSearch('');
    setStatusFilter([]);
    setDomainFilter([]);
    setApplied(INITIAL_FILTERS);
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
  }, []);

  const { data, isLoading } = useQuery<{ data: ActionItem[] }>({
    queryKey: ['review-actions-list', applied],
    queryFn: () =>
      api.get('/review-actions', {
        ...(applied.status && { status: applied.status }),
        ...(applied.domain && { domainCode: applied.domain }),
        ...(applied.search && { search: applied.search }),
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
      label: t('col.requestId'),
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
      label: t('col.actionTitle'),
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
      label: t('col.domain'),
      sortable: true,
      render: (r) => <span className="font-medium">{r.domainName || r.domainCode}</span>,
      exportValue: (r) => r.domainName || r.domainCode,
    },
    {
      key: 'priority',
      label: t('col.priority'),
      sortable: true,
      render: (r) => (
        <Tag color={PRIORITY_HEX[r.priority] || '#6B7280'}>{r.priority}</Tag>
      ),
      exportValue: (r) => r.priority,
    },
    {
      key: 'action_type',
      label: t('common.type'),
      render: (r) => (
        <Tag color={ACTION_TYPE_HEX[r.actionType] || '#8C8C8C'}>{r.actionType}</Tag>
      ),
      exportValue: (r) => r.actionType,
    },
    {
      key: 'status',
      label: t('col.status'),
      sortable: true,
      render: (r) => (
        <Tag color={ACTION_STATUS_HEX[r.status] || '#8C8C8C'}>{r.status}</Tag>
      ),
      exportValue: (r) => r.status,
    },
    {
      key: 'assignee',
      label: t('col.assignee'),
      sortable: true,
      render: (r) => <>{r.assigneeName || r.assignee || '-'}</>,
      exportValue: (r) => r.assigneeName || r.assignee || '',
    },
    {
      key: 'create_at',
      label: t('col.created'),
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
      <Title level={4} style={{ margin: 0, marginBottom: 16 }}>{t('actions.title')}</Title>

      <div className="border border-border-light rounded-lg px-3 py-2.5 mb-3">
        {/* Row 1 */}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Input
            placeholder={t('actions.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={handleSearch}
            allowClear
            size="small"
            style={{ width: 260 }}
          />
          <MultiSelect
            options={STATUS_OPTIONS}
            selected={statusFilter}
            onChange={setStatusFilter}
            placeholder={t('col.status')}
            size="small"
          />
        </div>
        {/* Row 2 */}
        <div className="flex flex-wrap items-center gap-2">
          <MultiSelect
            options={domainOptions}
            selected={domainFilter}
            onChange={setDomainFilter}
            placeholder={t('col.domain')}
            size="small"
          />
          <Button type="primary" size="small" icon={<SearchOutlined />} onClick={handleSearch}>
            {t('common.search')}
          </Button>
          <Button size="small" icon={<UndoOutlined />} onClick={handleReset}>
            {t('common.reset')}
          </Button>
        </div>
      </div>

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

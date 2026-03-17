'use client';

import { useCallback, useMemo } from 'react';
import { Table, Button, Space, Tooltip } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import type { TableProps } from 'antd';
import { exportToCsv } from '@/lib/csv';
import { useLocale } from '@/lib/locale-context';

// -- Public types (re-exported for consumers) ------------------------------------

export interface Column<T> {
  /** Field name used for sorting key and CSV export. */
  key: string;
  /** Display header text. */
  label: string;
  /** Enable click-to-sort on this column. Default: false. */
  sortable?: boolean;
  /** Custom cell renderer. Falls back to `row[key]` as string. */
  render?: (row: T) => React.ReactNode;
  /** Custom value extractor for CSV export. Falls back to `row[key]`. */
  exportValue?: (row: T) => string;
}

export interface PaginationConfig {
  page: number;
  totalPages: number;
  total: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  /** Unique key extractor per row. Default: `(row as any).id` */
  rowKey?: (row: T) => string;
  /** Currently sorted field (controlled). */
  sortField?: string;
  /** Current sort direction (controlled). */
  sortOrder?: 'ASC' | 'DESC';
  /** Callback when user clicks a sortable header. */
  onSort?: (field: string, order: 'ASC' | 'DESC') => void;
  /** If provided, shows an "Export CSV" button and uses this as the filename (without .csv). */
  exportFilename?: string;
  /** If provided, renders a pagination bar below the table. */
  pagination?: PaginationConfig;
}

// -- Component -------------------------------------------------------------------

export default function DataTable<T extends object>({
  columns,
  data,
  isLoading = false,
  rowKey,
  sortField,
  sortOrder = 'DESC',
  onSort,
  exportFilename,
  pagination,
}: DataTableProps<T>) {
  const { t } = useLocale();

  // -- CSV export ----------------------------------------------------------------

  const handleExport = useCallback(() => {
    if (!exportFilename) return;

    const valueExtractors: Record<string, (row: T) => string> = {};
    for (const col of columns) {
      if (col.exportValue) {
        valueExtractors[col.key] = col.exportValue;
      }
    }

    exportToCsv(
      exportFilename,
      columns.map((c) => ({ key: c.key, label: c.label })),
      data,
      Object.keys(valueExtractors).length > 0 ? valueExtractors : undefined,
    );
  }, [exportFilename, columns, data]);

  // -- Map Column<T> -> antd ColumnsType ----------------------------------------

  const antdColumns: TableProps<T>['columns'] = useMemo(
    () =>
      columns.map((col) => ({
        title: col.label,
        dataIndex: col.key,
        key: col.key,
        sorter: col.sortable && onSort ? true : undefined,
        sortOrder:
          sortField === col.key
            ? sortOrder === 'ASC'
              ? ('ascend' as const)
              : ('descend' as const)
            : undefined,
        render: col.render
          ? (_: unknown, record: T) => col.render!(record)
          : undefined,
      })),
    [columns, sortField, sortOrder, onSort],
  );

  // -- Sort change handler -------------------------------------------------------

  const handleTableChange: TableProps<T>['onChange'] = useCallback(
    (_pagination: unknown, _filters: unknown, sorter: any) => {
      if (!onSort || !sorter?.field) return;
      const field = sorter.field as string;
      const order = sorter.order === 'ascend' ? 'ASC' : 'DESC';
      onSort(field, order);
    },
    [onSort],
  );

  // -- Render --------------------------------------------------------------------

  return (
    <div>
      {exportFilename && data.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <Button
            icon={<DownloadOutlined style={{ fontSize: 11 }} />}
            onClick={handleExport}
            data-testid="export-csv-btn"
            size="small"
            type="text"
            style={{ padding: '0 6px', height: 20, fontSize: 11, lineHeight: '20px' }}
          >
            {t('common.exportCsv')}
          </Button>
        </div>
      )}

      <Table<T>
        columns={antdColumns}
        dataSource={data}
        loading={isLoading}
        rowKey={rowKey || ((row) => (row as Record<string, unknown>).id as string)}
        onChange={handleTableChange}
        pagination={
          pagination
            ? {
                current: pagination.page,
                total: pagination.total,
                pageSize: pagination.pageSize || Math.ceil(pagination.total / pagination.totalPages) || 20,
                onChange: pagination.onPageChange,
                showTotal: (total) => t('common.total').replace('{total}', String(total)),
                size: 'small',
              }
            : false
        }
        size="middle"
        showSorterTooltip={false}
      />
    </div>
  );
}

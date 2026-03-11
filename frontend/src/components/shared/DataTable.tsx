'use client';

import { useCallback } from 'react';
import clsx from 'clsx';
import { exportToCsv } from '@/lib/csv';

// ── Public types (re-exported for consumers) ──────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────

export default function DataTable<T extends Record<string, unknown>>({
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
  const colCount = columns.length;

  // ── Sort handler ──────────────────────────────────────────────────

  const handleSort = useCallback(
    (field: string) => {
      if (!onSort) return;
      if (sortField === field) {
        // Toggle direction
        onSort(field, sortOrder === 'ASC' ? 'DESC' : 'ASC');
      } else {
        // New column → default ASC
        onSort(field, 'ASC');
      }
    },
    [onSort, sortField, sortOrder],
  );

  // ── CSV export ────────────────────────────────────────────────────

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

  // ── Sort indicator ────────────────────────────────────────────────

  const sortIndicator = (field: string) => {
    if (sortField !== field) return <span className="ml-1 text-gray-300">⇅</span>;
    return (
      <span className="ml-1" data-testid={`sort-indicator-${field}`}>
        {sortOrder === 'ASC' ? '▲' : '▼'}
      </span>
    );
  };

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div>
      {/* Export button */}
      {exportFilename && data.length > 0 && (
        <div className="flex justify-end mb-2">
          <button
            onClick={handleExport}
            className="px-3 py-1.5 text-sm border border-border-light rounded hover:bg-gray-50 flex items-center gap-1"
            data-testid="export-csv-btn"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg border border-border-light">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-light bg-bg-gray">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={clsx(
                    'text-left p-3 font-medium',
                    col.sortable && onSort && 'cursor-pointer select-none hover:bg-gray-100',
                  )}
                  onClick={col.sortable && onSort ? () => handleSort(col.key) : undefined}
                >
                  {col.label}
                  {col.sortable && onSort && sortIndicator(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={colCount} className="p-4 text-center text-text-secondary">
                  Loading...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="p-4 text-center text-text-secondary">
                  No data available
                </td>
              </tr>
            ) : (
              data.map((row, idx) => (
                <tr
                  key={rowKey ? rowKey(row) : (row as Record<string, unknown>).id as string ?? idx}
                  className="border-b border-border-light hover:bg-gray-50"
                >
                  {columns.map((col) => (
                    <td key={col.key} className="p-3">
                      {col.render ? col.render(row) : String(row[col.key] ?? '-')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t border-border-light">
            <span className="text-sm text-text-secondary">Total {pagination.total} items</span>
            <div className="flex gap-1">
              {Array.from({ length: pagination.totalPages }, (_, i) => (
                <button
                  key={i + 1}
                  onClick={() => pagination.onPageChange(i + 1)}
                  className={clsx(
                    'px-3 py-1 rounded text-sm',
                    pagination.page === i + 1
                      ? 'bg-primary-blue text-white'
                      : 'hover:bg-gray-100',
                  )}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

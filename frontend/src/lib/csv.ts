/**
 * CSV export utility — pure client-side generation + browser download.
 * Reusable across all list pages via DataTable component.
 */

interface CsvColumn {
  key: string;
  label: string;
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Wrap in quotes if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportToCsv<T extends object>(
  filename: string,
  columns: CsvColumn[],
  data: T[],
  valueExtractors?: Record<string, (row: T) => string>,
): void {
  // Header row
  const header = columns.map((c) => escapeCsvValue(c.label)).join(',');

  // Data rows
  const rows = data.map((row) =>
    columns
      .map((col) => {
        const extractor = valueExtractors?.[col.key];
        const value = extractor ? extractor(row) : (row as Record<string, unknown>)[col.key];
        return escapeCsvValue(value);
      })
      .join(','),
  );

  const csvContent = [header, ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

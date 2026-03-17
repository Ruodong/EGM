'use client';

import { useState, useRef, useEffect } from 'react';
import { HistoryOutlined } from '@ant-design/icons';
import clsx from 'clsx';

export interface ChangeEntry {
  id: string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: string;
  changedAt: string | null;
}

interface ChangeHighlightProps {
  fieldName: string;
  changelog: ChangeEntry[];
  children: React.ReactNode;
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '(empty)';
  // Handle questionnaire answer objects like { value: "Yes", otherText: "...", descriptionText: "..." }
  if (typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    if ('value' in obj) {
      const v = obj.value;
      const parts: string[] = [];
      if (Array.isArray(v)) parts.push(v.join(', '));
      else if (v) parts.push(String(v));
      if (obj.otherText) parts.push(`(Other: ${String(obj.otherText)})`);
      if (obj.descriptionText) parts.push(`[${String(obj.descriptionText)}]`);
      return parts.length > 0 ? parts.join(' ') : '(empty)';
    }
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) return val.join(', ');
  return String(val);
}

export function ChangeHighlight({ fieldName, changelog, children }: ChangeHighlightProps) {
  const [showPopover, setShowPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const fieldChanges = changelog.filter((c) => c.fieldName === fieldName);
  const hasChanges = fieldChanges.length > 0;

  useEffect(() => {
    if (!showPopover) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPopover]);

  if (!hasChanges) return <>{children}</>;

  return (
    <div className="relative">
      <div
        className={clsx(
          'border-l-4 border-amber-400 bg-amber-50/50 pl-3 -ml-3 rounded-r',
        )}
      >
        {children}
        <button
          type="button"
          onClick={() => setShowPopover(!showPopover)}
          className="absolute top-1 right-1 p-1 rounded hover:bg-amber-100 transition-colors"
          title="View change history"
          data-testid={`change-history-btn-${fieldName}`}
        >
          <HistoryOutlined className="text-amber-600" style={{ fontSize: 14 }} />
        </button>
      </div>

      {showPopover && (
        <div
          ref={popoverRef}
          className="absolute z-50 right-0 top-full mt-1 w-80 bg-white border border-border-light rounded-lg shadow-lg p-3"
          data-testid={`change-popover-${fieldName}`}
        >
          <h4 className="text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wide">
            Change History
          </h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {fieldChanges.map((entry) => (
              <div key={entry.id} className="text-xs border-b border-border-light pb-2 last:border-0">
                <div className="flex justify-between text-text-secondary mb-1">
                  <span>{entry.changedBy}</span>
                  <span>{entry.changedAt ? new Date(entry.changedAt).toLocaleString() : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="line-through text-red-500">{formatValue(entry.oldValue)}</span>
                  <span className="text-text-secondary">&rarr;</span>
                  <span className="text-green-600 font-medium">{formatValue(entry.newValue)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

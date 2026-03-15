'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import { getDomainIcon } from '@/lib/domain-icons';
import { ActionFeedbackPanel } from './ActionFeedbackPanel';
import clsx from 'clsx';

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
  createBy: string;
  createByName: string | null;
  createAt: string | null;
}

interface FeedbackEntry {
  id: string;
  actionId: string;
  roundNo: number;
  feedbackType: 'response' | 'follow_up';
  content: string;
  createdBy: string;
  createdByName: string | null;
  createAt: string | null;
}

interface DomainGroup {
  domainCode: string;
  domainName: string;
  actions: ActionItem[];
}

interface GovernanceDomainActionsProps {
  requestId: string;
}

const PRIORITY_COLORS: Record<string, string> = {
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

export function GovernanceDomainActions({ requestId }: GovernanceDomainActionsProps) {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());

  const { data } = useQuery<{ data: DomainGroup[] }>({
    queryKey: ['review-actions-by-request', requestId],
    queryFn: () => api.get(`/review-actions/by-request/${requestId}`),
    enabled: !!requestId,
  });

  const groups = data?.data || [];

  if (groups.length === 0) return null;

  const toggleDomain = (code: string) => {
    setCollapsed((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  const toggleAction = (id: string) => {
    setExpandedActions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const isCollapsed = collapsed[group.domainCode] ?? false;
        const { Icon, colors } = getDomainIcon(group.domainCode);
        const activeCount = group.actions.filter(
          (a) => a.status !== 'Closed' && a.status !== 'Cancelled',
        ).length;

        return (
          <div key={group.domainCode} className="border border-border-light rounded-lg bg-white">
            {/* Domain header */}
            <button
              type="button"
              onClick={() => toggleDomain(group.domainCode)}
              className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-50 transition-colors rounded-lg"
            >
              {isCollapsed ? (
                <RightOutlined style={{ fontSize: 12 }} />
              ) : (
                <DownOutlined style={{ fontSize: 12 }} />
              )}
              <span
                className={clsx(
                  'inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0',
                  colors,
                )}
              >
                <Icon style={{ fontSize: 15 }} />
              </span>
              <span className="font-medium">{group.domainName}</span>
              <span className="text-xs text-text-secondary">({group.domainCode})</span>
              <span className="ml-auto text-xs text-text-secondary">
                {group.actions.length} action{group.actions.length !== 1 ? 's' : ''}
                {activeCount > 0 && (
                  <span className="ml-1 text-amber-600">({activeCount} active)</span>
                )}
              </span>
            </button>

            {/* Action list */}
            {!isCollapsed && (
              <div className="border-t border-border-light px-4 pb-4 pt-3 space-y-2">
                {group.actions.map((action) => (
                  <RequestorActionRow
                    key={action.id}
                    action={action}
                    expanded={expandedActions.has(action.id)}
                    onToggle={() => toggleAction(action.id)}
                    requestId={requestId}
                    currentUser={user?.id || ''}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Requestor Action Row (read-only with feedback) ─── */

function RequestorActionRow({
  action,
  expanded,
  onToggle,
  requestId,
  currentUser,
}: {
  action: ActionItem;
  expanded: boolean;
  onToggle: () => void;
  requestId: string;
  currentUser: string;
}) {
  // Fetch feedback when expanded
  const { data: feedbackData } = useQuery<{ data: FeedbackEntry[] }>({
    queryKey: ['action-feedback', action.id],
    queryFn: () => api.get(`/review-actions/${action.id}/feedback`),
    enabled: expanded,
  });

  const isTerminal = action.status === 'Closed' || action.status === 'Cancelled';
  const isAssignee = currentUser === action.assignee;
  const canSubmitFeedback = !isTerminal && action.status === 'Assigned' && isAssignee;

  return (
    <div className="border border-border-light rounded-lg">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        {expanded ? (
          <DownOutlined style={{ fontSize: 10 }} />
        ) : (
          <RightOutlined style={{ fontSize: 10 }} />
        )}
        <span className="text-sm font-medium flex-1">
          {action.actionNo ? `#${action.actionNo} ` : ''}
          {action.title}
        </span>
        <span
          className="px-2 py-0.5 rounded text-xs text-white"
          style={{ backgroundColor: PRIORITY_COLORS[action.priority] || '#6B7280' }}
        >
          {action.priority}
        </span>
        <span className="text-xs text-text-secondary">{action.actionType}</span>
        <span
          className="px-2 py-0.5 rounded text-xs text-white"
          style={{ backgroundColor: ACTION_STATUS_HEX[action.status] || '#8C8C8C' }}
        >
          {action.status}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border-light">
          {action.description && (
            <p className="text-sm text-text-secondary mt-3 mb-2">{action.description}</p>
          )}
          <div className="flex items-center gap-4 text-xs text-text-secondary mt-2">
            <span>Created by {action.createByName || action.createBy}</span>
            {action.createAt && <span>{new Date(action.createAt).toLocaleString()}</span>}
          </div>

          {/* Feedback panel — assignee can respond */}
          <ActionFeedbackPanel
            actionId={action.id}
            feedback={feedbackData?.data || []}
            currentUser={currentUser}
            canSubmit={canSubmitFeedback}
            domainReviewId={action.domainReviewId}
            requestId={requestId}
          />
        </div>
      )}
    </div>
  );
}

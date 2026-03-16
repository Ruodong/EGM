'use client';

import { useState, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ui/Toast';
import { DownOutlined, RightOutlined, PaperClipOutlined, UploadOutlined, DownloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { Button, Image } from 'antd';
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

interface ActionAttachment {
  id: string;
  actionId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  createBy: string;
  createByName: string | null;
  createAt: string | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch feedback when expanded
  const { data: feedbackData } = useQuery<{ data: FeedbackEntry[] }>({
    queryKey: ['action-feedback', action.id],
    queryFn: () => api.get(`/review-actions/${action.id}/feedback`),
    enabled: expanded,
  });

  // Fetch action-level attachments when expanded
  const { data: attachmentsData } = useQuery<{ data: ActionAttachment[] }>({
    queryKey: ['action-attachments', action.id],
    queryFn: () => api.get(`/review-actions/${action.id}/attachments`),
    enabled: expanded,
  });

  const attachments = attachmentsData?.data || [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['action-attachments', action.id] });
  };

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.upload(`/review-actions/${action.id}/attachments`, formData);
    },
    onSuccess: () => { invalidate(); toast('Attachment uploaded', 'success'); },
    onError: () => toast('Failed to upload attachment', 'error'),
  });

  const deleteAttMutation = useMutation({
    mutationFn: (attId: string) => api.delete(`/review-actions/${action.id}/attachments/${attId}`),
    onSuccess: () => { invalidate(); toast('Attachment deleted', 'success'); },
    onError: () => toast('Failed to delete attachment', 'error'),
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

          {/* Action-level attachments */}
          <div className="mt-3 border-t border-border-light pt-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-text-secondary">
                <PaperClipOutlined /> Attachments{attachments.length > 0 ? ` (${attachments.length})` : ''}
              </span>
              {!isTerminal && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadMutation.mutate(f);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    size="small"
                    icon={<UploadOutlined />}
                    onClick={() => fileInputRef.current?.click()}
                    loading={uploadMutation.isPending}
                  >
                    Upload
                  </Button>
                </>
              )}
            </div>
            {attachments.length > 0 && (
              <div className="space-y-1">
                {attachments.map((att) => {
                  const attUrl = `${API_BASE}/review-actions/${action.id}/attachments/${att.id}`;
                  const isImg = att.contentType?.startsWith('image/');
                  return (
                    <div key={att.id} className="bg-gray-50 rounded px-2 py-1.5">
                      {isImg && (
                        <Image
                          src={attUrl}
                          alt={att.fileName}
                          style={{ maxHeight: 160, borderRadius: 6, objectFit: 'contain' }}
                          preview={{ mask: 'Click to preview' }}
                        />
                      )}
                      <div className="flex items-center gap-2 text-xs mt-1">
                        <PaperClipOutlined style={{ fontSize: 11, color: '#8C8C8C' }} />
                        <a
                          href={attUrl}
                          download={att.fileName}
                          className="text-primary-blue hover:underline truncate flex-1"
                          title={att.fileName}
                        >
                          {att.fileName}
                        </a>
                        <span className="text-text-secondary whitespace-nowrap">
                          {formatFileSize(att.fileSize)}
                        </span>
                        <span className="text-text-secondary whitespace-nowrap">
                          {att.createByName || att.createBy}
                        </span>
                        <a href={attUrl} download={att.fileName} title="Download">
                          <DownloadOutlined style={{ fontSize: 12, color: '#1890FF' }} />
                        </a>
                        {att.createBy === currentUser && (
                          <button
                            type="button"
                            onClick={() => deleteAttMutation.mutate(att.id)}
                            className="text-red-400 hover:text-red-600"
                            title="Delete"
                          >
                            <DeleteOutlined style={{ fontSize: 12 }} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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

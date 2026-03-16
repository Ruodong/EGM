'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth-context';
import { Button, DatePicker, Image } from 'antd';
import dayjs from 'dayjs';
import { DEFAULT_DUE_DATE_OFFSET_DAYS } from '@/lib/constants';
import {
  PlusOutlined,
  CopyOutlined,
  CloseCircleOutlined,
  CheckCircleOutlined,
  DownOutlined,
  RightOutlined,
  PaperClipOutlined,
  DeleteOutlined,
  DownloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { statusHex } from '@/lib/constants';
import { ActionFeedbackPanel } from './ActionFeedbackPanel';

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
  dueDate: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  createBy: string;
  createByName: string | null;
  createAt: string | null;
  updateAt: string | null;
  feedback?: FeedbackEntry[];
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
  attachments?: { id: string; feedbackId: string; actionId: string; fileName: string; fileSize: number; contentType: string; createBy: string; createByName: string | null; createAt: string | null }[];
}

interface ActionAttachment {
  id: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  createBy: string;
  createByName: string | null;
  createAt: string | null;
}

interface Employee {
  itcode: string;
  name: string;
  email: string;
}

interface ActionItemsSectionProps {
  domainReviewId: string;
  requestId: string;
  reviewStatus: string;
  /** Requestor's IT code (auto-assigned as assignee) */
  requestorItcode?: string;
  /** Requestor's display name */
  requestorName?: string;
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

export function ActionItemsSection({ domainReviewId, requestId, reviewStatus, requestorItcode, requestorName }: ActionItemsSectionProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());

  // Fetch actions for this domain review
  const { data: actionsData } = useQuery<{ data: ActionItem[] }>({
    queryKey: ['review-actions', domainReviewId],
    queryFn: () => api.get('/review-actions', { domainReviewId }),
  });

  const actions = actionsData?.data || [];
  const canCreate = reviewStatus === 'Accept';

  // No actions and can't create — don't show section
  if (actions.length === 0 && !canCreate) return null;

  const toggleAction = (id: string) => {
    setExpandedActions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const invalidateActions = () => {
    queryClient.invalidateQueries({ queryKey: ['review-actions', domainReviewId] });
    queryClient.invalidateQueries({ queryKey: ['review-actions-by-request', requestId] });
  };

  return (
    <div className="bg-white rounded-lg border border-border-light p-6 mt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold">Action Items</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            {actions.length} action item{actions.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canCreate && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setShowCreateModal(true)}
            size="small"
          >
            Create Action
          </Button>
        )}
      </div>

      {/* Action list */}
      {actions.length > 0 && (
        <div className="space-y-2">
          {actions.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              expanded={expandedActions.has(action.id)}
              onToggle={() => toggleAction(action.id)}
              canCreate={canCreate}
              domainReviewId={domainReviewId}
              requestId={requestId}
              currentUser={user?.id || ''}
              onInvalidate={invalidateActions}
            />
          ))}
        </div>
      )}

      {actions.length === 0 && canCreate && (
        <p className="text-sm text-text-secondary text-center py-4">
          No action items yet. Click &quot;Create Action&quot; to add one.
        </p>
      )}

      {/* Create Action Modal */}
      {showCreateModal && (
        <CreateActionModal
          domainReviewId={domainReviewId}
          requestId={requestId}
          requestorItcode={requestorItcode}
          requestorName={requestorName}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            invalidateActions();
          }}
        />
      )}
    </div>
  );
}

/* ─── Action Row ─── */

function ActionRow({
  action,
  expanded,
  onToggle,
  canCreate,
  domainReviewId,
  requestId,
  currentUser,
  onInvalidate,
}: {
  action: ActionItem;
  expanded: boolean;
  onToggle: () => void;
  canCreate: boolean;
  domainReviewId: string;
  requestId: string;
  currentUser: string;
  onInvalidate: () => void;
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

  // Fetch attachments when expanded
  const { data: attachmentsData } = useQuery<{ data: ActionAttachment[] }>({
    queryKey: ['action-attachments', action.id],
    queryFn: () => api.get(`/review-actions/${action.id}/attachments`),
    enabled: expanded,
  });
  const attachments = attachmentsData?.data || [];

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.upload(`/review-actions/${action.id}/attachments`, formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action-attachments', action.id] });
      toast('File uploaded', 'success');
    },
    onError: () => toast('Failed to upload file', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (attId: string) => api.delete(`/review-actions/${action.id}/attachments/${attId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action-attachments', action.id] });
      toast('Attachment deleted', 'success');
    },
    onError: () => toast('Failed to delete attachment', 'error'),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
      e.target.value = '';
    }
  };

  const closeMutation = useMutation({
    mutationFn: () => api.put(`/review-actions/${action.id}/close`, {}),
    onSuccess: () => { onInvalidate(); toast('Action closed', 'success'); },
    onError: () => toast('Failed to close action', 'error'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.put(`/review-actions/${action.id}/cancel`, {}),
    onSuccess: () => { onInvalidate(); toast('Action cancelled', 'success'); },
    onError: () => toast('Failed to cancel action', 'error'),
  });

  const copyMutation = useMutation({
    mutationFn: () => api.post(`/review-actions/${action.id}/copy`, {}),
    onSuccess: () => { onInvalidate(); toast('Action copied', 'success'); },
    onError: () => toast('Failed to copy action', 'error'),
  });

  const isTerminal = action.status === 'Closed' || action.status === 'Cancelled';
  const canSubmitFeedback = !isTerminal && action.status === 'Assigned';

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

  return (
    <div className="border border-border-light rounded-lg">
      {/* Header row */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        {expanded ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
        <span className="text-sm font-medium flex-1">
          {action.actionNo ? `#${action.actionNo} ` : ''}{action.title}
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
        {action.assigneeName && (
          <span className="text-xs text-text-secondary">→ {action.assigneeName}</span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border-light">
          {action.description && (
            <p className="text-sm text-text-secondary mt-3 mb-2">{action.description}</p>
          )}

          <div className="flex items-center gap-4 text-xs text-text-secondary mt-2">
            <span>Created by {action.createByName || action.createBy}</span>
            {action.createAt && <span>{new Date(action.createAt).toLocaleString()}</span>}
            {action.dueDate && <span>Due: {action.dueDate}</span>}
            {action.closedAt && <span>Closed: {new Date(action.closedAt).toLocaleString()}</span>}
            {action.cancelledAt && <span>Cancelled: {new Date(action.cancelledAt).toLocaleString()}</span>}
          </div>

          {/* Action buttons */}
          {!isTerminal && (
            <div className="flex gap-2 mt-3">
              {canCreate && (
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => copyMutation.mutate()}
                  disabled={copyMutation.isPending}
                >
                  Copy
                </Button>
              )}
              {action.status === 'Assigned' && (
                <Button
                  size="small"
                  type="primary"
                  style={{ background: '#52c41a', borderColor: '#52c41a' }}
                  icon={<CheckCircleOutlined />}
                  onClick={() => closeMutation.mutate()}
                  disabled={closeMutation.isPending}
                >
                  Close
                </Button>
              )}
              <Button
                size="small"
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                Cancel
              </Button>
            </div>
          )}

          {/* Attachments section */}
          <div className="mt-4 border border-border-light rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-text-secondary flex items-center gap-1">
                <PaperClipOutlined /> Attachments{attachments.length > 0 ? ` (${attachments.length})` : ''}
              </span>
              {!isTerminal && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <Button
                    size="small"
                    type="text"
                    icon={<UploadOutlined />}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadMutation.isPending}
                    style={{ fontSize: 11, height: 22, padding: '0 6px' }}
                  >
                    {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
                  </Button>
                </>
              )}
            </div>
            {attachments.length > 0 ? (
              <div className="space-y-1">
                {attachments.map((att) => {
                  const attUrl = `${API_BASE}/review-actions/${action.id}/attachments/${att.id}`;
                  const isImg = att.contentType?.startsWith('image/');
                  return (
                    <div key={att.id} className="py-1 px-2 rounded hover:bg-gray-50">
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
                          className="text-primary-blue hover:underline flex-1 truncate"
                          title={att.fileName}
                        >
                          {att.fileName}
                        </a>
                        <span className="text-text-secondary whitespace-nowrap">{formatFileSize(att.fileSize)}</span>
                        {att.createByName && (
                          <span className="text-text-secondary whitespace-nowrap">{att.createByName}</span>
                        )}
                        <a href={attUrl} download={att.fileName} title="Download">
                          <DownloadOutlined style={{ fontSize: 12, color: '#1890FF' }} />
                        </a>
                        {att.createBy === currentUser && (
                          <button
                            type="button"
                            onClick={() => deleteMutation.mutate(att.id)}
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
            ) : (
              <p className="text-xs text-text-secondary italic">No attachments</p>
            )}
          </div>

          {/* Feedback panel */}
          <ActionFeedbackPanel
            actionId={action.id}
            feedback={feedbackData?.data || []}
            currentUser={currentUser}
            canSubmit={canSubmitFeedback}
            domainReviewId={domainReviewId}
            requestId={requestId}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Create Action Modal ─── */

function CreateActionModal({
  domainReviewId,
  requestId,
  requestorItcode,
  requestorName,
  onClose,
  onCreated,
}: {
  domainReviewId: string;
  requestId: string;
  requestorItcode?: string;
  requestorName?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [actionType, setActionType] = useState('Mandatory');
  const [dueDate, setDueDate] = useState<dayjs.Dayjs>(dayjs().add(DEFAULT_DUE_DATE_OFFSET_DAYS, 'day'));

  const createMutation = useMutation({
    mutationFn: (data: Record<string, string>) => api.post('/review-actions', data),
    onSuccess: () => {
      toast('Action item created', 'success');
      onCreated();
    },
    onError: () => toast('Failed to create action item', 'error'),
  });

  const handleSubmit = () => {
    const payload: Record<string, string> = {
      domainReviewId,
      title: title.trim(),
      description: description.trim(),
      priority,
      actionType,
    };
    if (dueDate) {
      payload.dueDate = dueDate.format('YYYY-MM-DD');
    }
    if (requestorItcode) {
      payload.assignee = requestorItcode;
      payload.assigneeName = requestorName || requestorItcode;
    }
    createMutation.mutate(payload);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Create Action Item</h3>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="text-sm font-medium">Title <span className="text-red-500">*</span></label>
            <input
              className="input-field w-full mt-1"
              placeholder="Action item title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium">Description</label>
            <textarea
              className="input-field w-full mt-1 resize-none"
              rows={3}
              placeholder="Describe the action item..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Priority + Type row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Priority</label>
              <select
                className="input-field w-full mt-1"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Type</label>
              <select
                className="input-field w-full mt-1"
                value={actionType}
                onChange={(e) => setActionType(e.target.value)}
              >
                <option value="Mandatory">Mandatory</option>
                <option value="Long Term">Long Term</option>
              </select>
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label className="text-sm font-medium">Due Date</label>
            <div className="mt-1">
              <DatePicker
                className="w-full"
                value={dueDate}
                onChange={(d) => d && setDueDate(d)}
                format="YYYY-MM-DD"
                allowClear={false}
              />
            </div>
          </div>

          {/* Assignee — read-only, always the requestor */}
          <div>
            <label className="text-sm font-medium">Assignee</label>
            <div className="mt-1 px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm text-text-secondary">
              {requestorName || requestorItcode || 'Requestor'}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button type="default" onClick={onClose}>Cancel</Button>
          <Button
            type="primary"
            onClick={handleSubmit}
            disabled={!title.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}

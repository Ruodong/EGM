'use client';

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PageLayout } from '@/components/layout/PageLayout';
import {
  FileProtectOutlined, AuditOutlined, CheckCircleOutlined, PlusOutlined,
  ExclamationCircleOutlined, CarryOutOutlined, RightOutlined,
  CloseOutlined, PaperClipOutlined, UploadOutlined, DownloadOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { Button, Tag, Switch, Pagination, Image } from 'antd';
import Link from 'next/link';
import { useState, useCallback, useRef } from 'react';
import { ActionFeedbackPanel } from '@/app/governance/_components/ActionFeedbackPanel';

const PAGE_SIZE = 10;

interface HomeStats {
  totalRequests: number;
  inReview: number;
  completed: number;
}

interface ReturnItem {
  reviewId: string;
  govUuid: string;
  govRequestId: string;
  domainCode: string;
  domainName: string;
  reviewerName: string | null;
  returnReason: string | null;
  projectName: string | null;
  govTitle: string | null;
  sendTime: string | null;
}

interface AssignedAction {
  id: string;
  actionNo: number | null;
  title: string;
  description: string | null;
  priority: string;
  actionType: string;
  status: string;
  domainCode: string;
  domainName: string;
  domainReviewId: string;
  govUuid: string;
  govRequestId: string;
  projectName: string | null;
  govTitle: string | null;
  dueDate: string | null;
  createBy: string;
  createByName: string | null;
  createAt: string | null;
  sendTime: string | null;
  lastFeedbackContent: string | null;
  lastFeedbackByName: string | null;
}

interface ReviewerPendingAction extends AssignedAction {
  assignee: string | null;
  assigneeName: string | null;
}

interface ResubmittedItem {
  reviewId: string;
  govUuid: string;
  govRequestId: string;
  domainCode: string;
  domainName: string;
  reviewerName: string | null;
  requestorName: string | null;
  projectName: string | null;
  govTitle: string | null;
  sendTime: string | null;
}

interface PendingTasks {
  returnForAdditional: ReturnItem[];
  assignedActions: AssignedAction[];
  reviewerFirstSubmit: ResubmittedItem[];
  reviewerResubmitted: ResubmittedItem[];
  reviewerPendingActions: ReviewerPendingAction[];
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

const PRIORITY_HEX: Record<string, string> = {
  High: '#EF4444',
  Medium: '#F59E0B',
  Low: '#6B7280',
};

const ACTION_TYPE_HEX: Record<string, string> = {
  Mandatory: '#722ED1',
  'Long Term': '#13C2C2',
};

function StatsCard({ label, value, icon, color }: { label: string; value: React.ReactNode; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white rounded-lg border border-border-light p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${color}`} style={{ fontSize: 24, color: '#fff' }}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-text-primary">{value}</p>
        <p className="text-sm text-text-secondary">{label}</p>
      </div>
    </div>
  );
}

/* ─── Action Detail Modal ─── */

function ActionDetailModal({
  action,
  currentUser,
  role,
  onClose,
}: {
  action: AssignedAction;
  currentUser: string;
  role: 'requestor' | 'reviewer';
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: feedbackData } = useQuery<{ data: any[] }>({
    queryKey: ['action-feedback', action.id],
    queryFn: () => api.get(`/review-actions/${action.id}/feedback`),
  });

  // Action-level attachments
  const { data: attachmentsData } = useQuery<{ data: ActionAttachment[] }>({
    queryKey: ['action-attachments', action.id],
    queryFn: () => api.get(`/review-actions/${action.id}/attachments`),
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
    },
  });

  const deleteAttMutation = useMutation({
    mutationFn: (attId: string) => api.delete(`/review-actions/${action.id}/attachments/${attId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action-attachments', action.id] });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
      e.target.value = '';
    }
  };

  const isTerminal = action.status === 'Closed' || action.status === 'Cancelled';
  const canSubmitFeedback = !isTerminal && action.status === 'Assigned';
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-base font-semibold text-text-primary truncate">
              {action.actionNo ? `#${action.actionNo} ` : ''}{action.title}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary p-1">
            <CloseOutlined />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Meta info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-text-secondary">Request ID</span>
              <div className="mt-0.5">
                <Link
                  href={role === 'reviewer'
                    ? `/governance/${action.govUuid}/reviews/${action.domainCode}`
                    : `/governance/${action.govUuid}`}
                  className="text-primary-blue hover:underline"
                  onClick={onClose}
                >
                  {action.govRequestId}
                </Link>
              </div>
            </div>
            <div>
              <span className="text-text-secondary">Project Name</span>
              <p className="mt-0.5 font-medium">{action.projectName || '-'}</p>
            </div>
            <div>
              <span className="text-text-secondary">Review Domain</span>
              <p className="mt-0.5 font-medium">{action.domainName || action.domainCode}</p>
            </div>
            <div>
              <span className="text-text-secondary">Reviewer</span>
              <p className="mt-0.5 font-medium">{action.createByName || action.createBy}</p>
            </div>
            <div>
              <span className="text-text-secondary">Priority</span>
              <div className="mt-0.5">
                <Tag color={PRIORITY_HEX[action.priority] || '#6B7280'}>{action.priority}</Tag>
              </div>
            </div>
            <div>
              <span className="text-text-secondary">Type</span>
              <div className="mt-0.5">
                <Tag color={ACTION_TYPE_HEX[action.actionType] || '#8C8C8C'}>{action.actionType}</Tag>
              </div>
            </div>
            <div>
              <span className="text-text-secondary">Due Date</span>
              <p className="mt-0.5">{action.dueDate || '-'}</p>
            </div>
            <div>
              <span className="text-text-secondary">Send Time</span>
              <p className="mt-0.5">{action.sendTime ? new Date(action.sendTime).toLocaleString() : '-'}</p>
            </div>
          </div>

          {/* Description */}
          {action.description && (
            <div>
              <span className="text-sm text-text-secondary">Description</span>
              <p className="mt-1 text-sm bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{action.description}</p>
            </div>
          )}

          {/* Action-level attachments */}
          <div className="border border-border-light rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-text-secondary flex items-center gap-1">
                <PaperClipOutlined /> Attachments{attachments.length > 0 ? ` (${attachments.length})` : ''}
              </span>
              {!isTerminal && (
                <>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
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
                        <span className="text-text-secondary whitespace-nowrap">
                          {att.fileSize < 1024 ? `${att.fileSize} B` : att.fileSize < 1048576 ? `${(att.fileSize / 1024).toFixed(1)} KB` : `${(att.fileSize / 1048576).toFixed(1)} MB`}
                        </span>
                        {att.createByName && <span className="text-text-secondary whitespace-nowrap">{att.createByName}</span>}
                        <a href={attUrl} download={att.fileName} title="Download">
                          <DownloadOutlined style={{ fontSize: 12, color: '#1890FF' }} />
                        </a>
                        {att.createBy === currentUser && (
                          <button type="button" onClick={() => deleteAttMutation.mutate(att.id)} className="text-red-400 hover:text-red-600" title="Delete">
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

          {/* Feedback panel with attachment support */}
          <ActionFeedbackPanel
            actionId={action.id}
            feedback={feedbackData?.data || []}
            currentUser={currentUser}
            canSubmit={canSubmitFeedback}
            domainReviewId={action.domainReviewId}
            requestId={action.govRequestId}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── Home Page ─── */

export default function HomePage() {
  const { user, hasRole, loading: authLoading } = useAuth();
  const [selectedAction, setSelectedAction] = useState<AssignedAction | null>(null);
  const [selectedActionRole, setSelectedActionRole] = useState<'requestor' | 'reviewer'>('requestor');
  const [myOnly, setMyOnly] = useState(true);

  // Pagination state for all 5 tables
  const [firstSubmitPage, setFirstSubmitPage] = useState(1);
  const [returnPage, setReturnPage] = useState(1);
  const [actionPage, setActionPage] = useState(1);
  const [resubmittedPage, setResubmittedPage] = useState(1);
  const [pendingActionsPage, setPendingActionsPage] = useState(1);

  const isReviewer = hasRole('admin', 'governance_lead', 'domain_reviewer');

  const { data: stats } = useQuery<HomeStats>({
    queryKey: ['home-stats'],
    queryFn: () => api.get('/dashboard/home-stats'),
    enabled: !authLoading,
  });

  const { data: pending } = useQuery<PendingTasks>({
    queryKey: ['pending-tasks', myOnly],
    queryFn: () => api.get('/dashboard/pending-tasks', { myOnly: myOnly ? 'true' : 'false' }),
    enabled: !authLoading,
  });

  const hasReturnItems = (pending?.returnForAdditional?.length ?? 0) > 0;
  const hasAssignedActions = (pending?.assignedActions?.length ?? 0) > 0;
  const hasPendingTasks = hasReturnItems || hasAssignedActions;

  const hasReviewerFirstSubmit = (pending?.reviewerFirstSubmit?.length ?? 0) > 0;
  const hasReviewerResubmitted = (pending?.reviewerResubmitted?.length ?? 0) > 0;
  const hasReviewerPendingActions = (pending?.reviewerPendingActions?.length ?? 0) > 0;
  const hasReviewerTasks = hasReviewerResubmitted || hasReviewerPendingActions;

  const handleActionClick = useCallback((action: AssignedAction, role: 'requestor' | 'reviewer' = 'requestor') => {
    setSelectedAction(action);
    setSelectedActionRole(role);
  }, []);

  // Paginated slices
  const firstSubmitItems = pending?.reviewerFirstSubmit ?? [];
  const paginatedFirstSubmit = firstSubmitItems.slice((firstSubmitPage - 1) * PAGE_SIZE, firstSubmitPage * PAGE_SIZE);

  const returnItems = pending?.returnForAdditional ?? [];
  const paginatedReturn = returnItems.slice((returnPage - 1) * PAGE_SIZE, returnPage * PAGE_SIZE);

  const actionItems = pending?.assignedActions ?? [];
  const paginatedActions = actionItems.slice((actionPage - 1) * PAGE_SIZE, actionPage * PAGE_SIZE);

  const resubmittedItems = pending?.reviewerResubmitted ?? [];
  const paginatedResubmitted = resubmittedItems.slice((resubmittedPage - 1) * PAGE_SIZE, resubmittedPage * PAGE_SIZE);

  const pendingActionItems = pending?.reviewerPendingActions ?? [];
  const paginatedPendingActions = pendingActionItems.slice((pendingActionsPage - 1) * PAGE_SIZE, pendingActionsPage * PAGE_SIZE);

  return (
    <PageLayout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Enterprise Governance Portal</h1>
            <p className="text-text-secondary mt-1">AI Governance Management Dashboard</p>
          </div>
          <Link href="/governance/create">
            <Button type="primary" style={{ background: '#13C2C2', borderColor: '#13C2C2' }} icon={<PlusOutlined />}>
              New Governance Request
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatsCard label="Total Requests" value={stats?.totalRequests ?? 0} icon={<FileProtectOutlined />} color="bg-primary-blue" />
          <StatsCard label="In Progress" value={stats?.inReview ?? 0} icon={<AuditOutlined />} color="bg-status-in-progress" />
          <StatsCard label="Completed" value={stats?.completed ?? 0} icon={<CheckCircleOutlined />} color="bg-status-completed" />
        </div>

        {/* ── Reviews Waiting for Accept (first-time submissions) ── */}
        {/* Not controlled by myOnly — always shows all domain reviews for the reviewer */}
        {isReviewer && hasReviewerFirstSubmit && (
          <div className="space-y-4 mb-8">
            <div className="bg-white rounded-lg border border-border-light overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-border-light bg-green-50">
                <CheckCircleOutlined style={{ color: '#52C41A', fontSize: 16 }} />
                <h2 className="text-sm font-semibold text-green-700">
                  Reviews Waiting for Accept
                </h2>
                <span className="ml-1 text-xs text-green-500">
                  ({firstSubmitItems.length})
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-text-secondary uppercase tracking-wider">
                    <th className="px-5 py-2.5 font-medium">Request ID</th>
                    <th className="px-5 py-2.5 font-medium">Project Name</th>
                    <th className="px-5 py-2.5 font-medium">Domain</th>
                    <th className="px-5 py-2.5 font-medium">Requestor</th>
                    <th className="px-5 py-2.5 font-medium">Submit Time</th>
                    <th className="px-5 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {paginatedFirstSubmit.map((item) => (
                    <tr key={item.reviewId} className="hover:bg-green-50/50 transition-colors">
                      <td className="px-5 py-3">
                        <Link
                          href={`/governance/${item.govUuid}/reviews/${item.domainCode}`}
                          className="text-primary-blue hover:underline font-medium whitespace-nowrap"
                        >
                          {item.govRequestId}
                        </Link>
                      </td>
                      <td className="px-5 py-3">{item.projectName || '-'}</td>
                      <td className="px-5 py-3 whitespace-nowrap">{item.domainName || item.domainCode}</td>
                      <td className="px-5 py-3 whitespace-nowrap">{item.requestorName || '-'}</td>
                      <td className="px-5 py-3 text-text-secondary whitespace-nowrap">
                        {item.sendTime ? new Date(item.sendTime).toLocaleString() : '-'}
                      </td>
                      <td className="px-5 py-3">
                        <Link
                          href={`/governance/${item.govUuid}/reviews/${item.domainCode}`}
                          className="text-green-600 hover:text-green-800 text-xs font-medium"
                        >
                          Review <RightOutlined className="text-[10px]" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {firstSubmitItems.length > PAGE_SIZE && (
                <div className="flex justify-end px-5 py-3 border-t border-border-light">
                  <Pagination
                    size="small"
                    current={firstSubmitPage}
                    pageSize={PAGE_SIZE}
                    total={firstSubmitItems.length}
                    onChange={(p) => setFirstSubmitPage(p)}
                    showSizeChanger={false}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pending tasks — show only when there are items needing attention */}
        {hasPendingTasks && (
          <div className="space-y-4 mb-8">
            {/* Return for Additional Information */}
            {hasReturnItems && (
              <div className="bg-white rounded-lg border border-border-light overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border-light bg-pink-50">
                  <ExclamationCircleOutlined style={{ color: '#EB2F96', fontSize: 16 }} />
                  <h2 className="text-sm font-semibold text-pink-700">
                    Return for Additional Information
                  </h2>
                  <span className="ml-1 text-xs text-pink-500">
                    ({returnItems.length})
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs text-text-secondary uppercase tracking-wider">
                      <th className="px-5 py-2.5 font-medium">Request ID</th>
                      <th className="px-5 py-2.5 font-medium">Project Name</th>
                      <th className="px-5 py-2.5 font-medium">Review Domain</th>
                      <th className="px-5 py-2.5 font-medium">Reviewer</th>
                      <th className="px-5 py-2.5 font-medium">Send Time</th>
                      <th className="px-5 py-2.5 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {paginatedReturn.map((item) => (
                      <tr key={item.reviewId} className="hover:bg-pink-50/50 transition-colors">
                        <td className="px-5 py-3">
                          <Link
                            href={`/governance/${item.govUuid}`}
                            className="text-primary-blue hover:underline font-medium whitespace-nowrap"
                          >
                            {item.govRequestId}
                          </Link>
                        </td>
                        <td className="px-5 py-3 font-medium">
                          {item.projectName || '-'}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          {item.domainName || item.domainCode}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          {item.reviewerName || '-'}
                        </td>
                        <td className="px-5 py-3 text-text-secondary whitespace-nowrap">
                          {item.sendTime ? new Date(item.sendTime).toLocaleString() : '-'}
                        </td>
                        <td className="px-5 py-3">
                          <Link
                            href={`/governance/${item.govUuid}`}
                            className="text-pink-600 hover:text-pink-800 text-xs font-medium"
                          >
                            Respond <RightOutlined className="text-[10px]" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {returnItems.length > PAGE_SIZE && (
                  <div className="flex justify-end px-5 py-3 border-t border-border-light">
                    <Pagination
                      size="small"
                      current={returnPage}
                      pageSize={PAGE_SIZE}
                      total={returnItems.length}
                      onChange={(p) => setReturnPage(p)}
                      showSizeChanger={false}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Assigned Actions — table layout */}
            {hasAssignedActions && (
              <div className="bg-white rounded-lg border border-border-light overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border-light bg-blue-50">
                  <CarryOutOutlined style={{ color: '#1890FF', fontSize: 16 }} />
                  <h2 className="text-sm font-semibold text-blue-700">
                    Action Items Assigned to You
                  </h2>
                  <span className="ml-1 text-xs text-blue-500">
                    ({actionItems.length})
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs text-text-secondary uppercase tracking-wider">
                      <th className="px-5 py-2.5 font-medium">Request ID</th>
                      <th className="px-5 py-2.5 font-medium">Project Name</th>
                      <th className="px-5 py-2.5 font-medium">Action Name</th>
                      <th className="px-5 py-2.5 font-medium">Last Feedback</th>
                      <th className="px-5 py-2.5 font-medium">Review Domain</th>
                      <th className="px-5 py-2.5 font-medium">Priority</th>
                      <th className="px-5 py-2.5 font-medium">Type</th>
                      <th className="px-5 py-2.5 font-medium">Reviewer</th>
                      <th className="px-5 py-2.5 font-medium">Due Date</th>
                      <th className="px-5 py-2.5 font-medium">Send Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {paginatedActions.map((action) => (
                      <tr
                        key={action.id}
                        className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                        onClick={() => handleActionClick(action)}
                      >
                        <td className="px-5 py-3 text-primary-blue font-medium whitespace-nowrap">
                          {action.govRequestId}
                        </td>
                        <td className="px-5 py-3">
                          {action.projectName || '-'}
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-medium">
                            {action.actionNo ? `#${action.actionNo} ` : ''}{action.title}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-text-secondary text-xs max-w-[200px] truncate" title={action.lastFeedbackContent || ''}>
                          {action.lastFeedbackContent || <span className="italic">—</span>}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          {action.domainName || action.domainCode}
                        </td>
                        <td className="px-5 py-3">
                          <Tag color={PRIORITY_HEX[action.priority] || '#6B7280'}>{action.priority}</Tag>
                        </td>
                        <td className="px-5 py-3">
                          <Tag color={ACTION_TYPE_HEX[action.actionType] || '#8C8C8C'}>{action.actionType}</Tag>
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          {action.createByName || action.createBy}
                        </td>
                        <td className="px-5 py-3 text-text-secondary whitespace-nowrap">
                          {action.dueDate || '-'}
                        </td>
                        <td className="px-5 py-3 text-text-secondary whitespace-nowrap">
                          {action.sendTime ? new Date(action.sendTime).toLocaleString() : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {actionItems.length > PAGE_SIZE && (
                  <div className="flex justify-end px-5 py-3 border-t border-border-light">
                    <Pagination
                      size="small"
                      current={actionPage}
                      pageSize={PAGE_SIZE}
                      total={actionItems.length}
                      onChange={(p) => setActionPage(p)}
                      showSizeChanger={false}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Reviewer section ── */}
        {isReviewer && (
          <div className="space-y-4 mb-8">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-text-primary">Reviewer Tasks</h2>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-text-secondary">My Only</span>
                <Switch size="small" checked={myOnly} onChange={setMyOnly} />
              </div>
            </div>

            {!hasReviewerTasks && (
              <div className="bg-white rounded-lg border border-border-light p-6 text-center text-sm text-text-secondary">
                No pending reviewer tasks
              </div>
            )}

            {/* Waiting for Accept with Additional Information */}
            {hasReviewerResubmitted && (
              <div className="bg-white rounded-lg border border-border-light overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border-light bg-green-50">
                  <CheckCircleOutlined style={{ color: '#52C41A', fontSize: 16 }} />
                  <h2 className="text-sm font-semibold text-green-700">
                    Waiting for Accept with Additional Information
                  </h2>
                  <span className="ml-1 text-xs text-green-500">
                    ({resubmittedItems.length})
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs text-text-secondary uppercase tracking-wider">
                      <th className="px-5 py-2.5 font-medium">Request ID</th>
                      <th className="px-5 py-2.5 font-medium">Project Name</th>
                      <th className="px-5 py-2.5 font-medium">Domain</th>
                      <th className="px-5 py-2.5 font-medium">Requestor</th>
                      <th className="px-5 py-2.5 font-medium">Resubmit Time</th>
                      <th className="px-5 py-2.5 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {paginatedResubmitted.map((item) => (
                      <tr key={item.reviewId} className="hover:bg-green-50/50 transition-colors">
                        <td className="px-5 py-3">
                          <Link
                            href={`/governance/${item.govUuid}/reviews/${item.domainCode}`}
                            className="text-primary-blue hover:underline font-medium whitespace-nowrap"
                          >
                            {item.govRequestId}
                          </Link>
                        </td>
                        <td className="px-5 py-3">{item.projectName || '-'}</td>
                        <td className="px-5 py-3 whitespace-nowrap">{item.domainName || item.domainCode}</td>
                        <td className="px-5 py-3 whitespace-nowrap">{item.requestorName || '-'}</td>
                        <td className="px-5 py-3 text-text-secondary whitespace-nowrap">
                          {item.sendTime ? new Date(item.sendTime).toLocaleString() : '-'}
                        </td>
                        <td className="px-5 py-3">
                          <Link
                            href={`/governance/${item.govUuid}/reviews/${item.domainCode}`}
                            className="text-green-600 hover:text-green-800 text-xs font-medium"
                          >
                            Review <RightOutlined className="text-[10px]" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {resubmittedItems.length > PAGE_SIZE && (
                  <div className="flex justify-end px-5 py-3 border-t border-border-light">
                    <Pagination
                      size="small"
                      current={resubmittedPage}
                      pageSize={PAGE_SIZE}
                      total={resubmittedItems.length}
                      onChange={(p) => setResubmittedPage(p)}
                      showSizeChanger={false}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Action Responses Pending Review */}
            {hasReviewerPendingActions && (
              <div className="bg-white rounded-lg border border-border-light overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border-light bg-orange-50">
                  <CarryOutOutlined style={{ color: '#FA8C16', fontSize: 16 }} />
                  <h2 className="text-sm font-semibold text-orange-700">
                    Action Responses — Pending Your Review
                  </h2>
                  <span className="ml-1 text-xs text-orange-500">
                    ({pendingActionItems.length})
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs text-text-secondary uppercase tracking-wider">
                      <th className="px-5 py-2.5 font-medium">Request ID</th>
                      <th className="px-5 py-2.5 font-medium">Project Name</th>
                      <th className="px-5 py-2.5 font-medium">Action Name</th>
                      <th className="px-5 py-2.5 font-medium">Last Feedback</th>
                      <th className="px-5 py-2.5 font-medium">Domain</th>
                      <th className="px-5 py-2.5 font-medium">Assignee</th>
                      <th className="px-5 py-2.5 font-medium">Due Date</th>
                      <th className="px-5 py-2.5 font-medium">Response Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {paginatedPendingActions.map((action) => (
                      <tr
                        key={action.id}
                        className="hover:bg-orange-50/50 cursor-pointer transition-colors"
                        onClick={() => handleActionClick(action, 'reviewer')}
                      >
                        <td className="px-5 py-3 text-primary-blue font-medium whitespace-nowrap">
                          {action.govRequestId}
                        </td>
                        <td className="px-5 py-3">{action.projectName || '-'}</td>
                        <td className="px-5 py-3">
                          <span className="font-medium">
                            {action.actionNo ? `#${action.actionNo} ` : ''}{action.title}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-text-secondary text-xs max-w-[200px] truncate" title={action.lastFeedbackContent || ''}>
                          {action.lastFeedbackContent || <span className="italic">—</span>}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">{action.domainName || action.domainCode}</td>
                        <td className="px-5 py-3 whitespace-nowrap">{action.assigneeName || action.assignee || '-'}</td>
                        <td className="px-5 py-3 text-text-secondary whitespace-nowrap">{action.dueDate || '-'}</td>
                        <td className="px-5 py-3 text-text-secondary whitespace-nowrap">
                          {action.sendTime ? new Date(action.sendTime).toLocaleString() : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pendingActionItems.length > PAGE_SIZE && (
                  <div className="flex justify-end px-5 py-3 border-t border-border-light">
                    <Pagination
                      size="small"
                      current={pendingActionsPage}
                      pageSize={PAGE_SIZE}
                      total={pendingActionItems.length}
                      onChange={(p) => setPendingActionsPage(p)}
                      showSizeChanger={false}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="bg-white rounded-lg border border-border-light p-6">
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="grid grid-cols-3 gap-4">
            <Link href="/governance/create" className="p-4 border border-border-light rounded-lg hover:border-primary-blue transition-colors">
              <h3 className="font-medium">Create New Request</h3>
              <p className="text-sm text-text-secondary mt-1">Submit a new AI governance review request</p>
            </Link>
            <Link href="/requests" className="p-4 border border-border-light rounded-lg hover:border-primary-blue transition-colors">
              <h3 className="font-medium">View All Requests</h3>
              <p className="text-sm text-text-secondary mt-1">Browse and manage governance requests</p>
            </Link>
            <Link href="/reports/governance-dashboard" className="p-4 border border-border-light rounded-lg hover:border-primary-blue transition-colors">
              <h3 className="font-medium">Governance Dashboard</h3>
              <p className="text-sm text-text-secondary mt-1">View governance metrics and KPIs</p>
            </Link>
          </div>
        </div>
      </div>

      {/* Action detail modal */}
      {selectedAction && (
        <ActionDetailModal
          action={selectedAction}
          currentUser={user?.id || ''}
          role={selectedActionRole}
          onClose={() => setSelectedAction(null)}
        />
      )}
    </PageLayout>
  );
}

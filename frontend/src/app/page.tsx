'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PageLayout } from '@/components/layout/PageLayout';
import {
  FileProtectOutlined, AuditOutlined, CheckCircleOutlined, PlusOutlined,
  ExclamationCircleOutlined, CarryOutOutlined, RightOutlined,
  CloseOutlined, SendOutlined, UserOutlined, CommentOutlined,
} from '@ant-design/icons';
import { Button, Tag, Switch } from 'antd';
import Link from 'next/link';
import { useState, useCallback } from 'react';

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
  reviewerResubmitted: ResubmittedItem[];
  reviewerPendingActions: ReviewerPendingAction[];
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
  onClose,
}: {
  action: AssignedAction;
  currentUser: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');

  const { data: feedbackData } = useQuery<{ data: FeedbackEntry[] }>({
    queryKey: ['action-feedback', action.id],
    queryFn: () => api.get(`/review-actions/${action.id}/feedback`),
  });

  const feedbackMutation = useMutation({
    mutationFn: (text: string) =>
      api.post(`/review-actions/${action.id}/feedback`, { content: text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action-feedback', action.id] });
      queryClient.invalidateQueries({ queryKey: ['pending-tasks'] });
      setContent('');
      // After assignee responds, action moves to reviewer side — close modal
      onClose();
    },
  });

  const feedback = feedbackData?.data || [];

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
                  href={`/governance/${action.govUuid}/reviews/${action.domainCode}`}
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

          {/* Feedback timeline */}
          <div>
            <span className="text-sm text-text-secondary font-medium">Feedback History</span>
            {feedback.length > 0 ? (
              <div className="space-y-2 mt-2">
                {feedback.map((f) => {
                  const isResponse = f.feedbackType === 'response';
                  return (
                    <div key={f.id} className={`flex gap-2 ${isResponse ? '' : 'flex-row-reverse'}`}>
                      <div
                        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs ${
                          isResponse ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'
                        }`}
                      >
                        {isResponse ? <UserOutlined /> : <CommentOutlined />}
                      </div>
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                          isResponse ? 'bg-blue-50 text-blue-900' : 'bg-purple-50 text-purple-900'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-xs">{f.createdByName || f.createdBy}</span>
                          <span className="text-xs opacity-60">
                            Round {f.roundNo} · {isResponse ? 'Response' : 'Follow-up'}
                          </span>
                          {f.createAt && (
                            <span className="text-xs opacity-50">{new Date(f.createAt).toLocaleString()}</span>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap">{f.content}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-text-secondary italic mt-2">No feedback yet</p>
            )}
          </div>
        </div>

        {/* Footer — feedback input */}
        <div className="border-t border-border-light px-6 py-4">
          <div className="flex gap-2">
            <textarea
              className="input-field flex-1 resize-none"
              rows={2}
              placeholder="Type your feedback response..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              disabled={!content.trim() || feedbackMutation.isPending}
              onClick={() => feedbackMutation.mutate(content.trim())}
              style={{ alignSelf: 'flex-end' }}
            >
              {feedbackMutation.isPending ? 'Sending...' : 'Send'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Home Page ─── */

export default function HomePage() {
  const { user, hasRole, loading: authLoading } = useAuth();
  const [selectedAction, setSelectedAction] = useState<AssignedAction | null>(null);
  const [myOnly, setMyOnly] = useState(true);

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

  const hasReviewerResubmitted = (pending?.reviewerResubmitted?.length ?? 0) > 0;
  const hasReviewerPendingActions = (pending?.reviewerPendingActions?.length ?? 0) > 0;
  const hasReviewerTasks = hasReviewerResubmitted || hasReviewerPendingActions;

  const handleActionClick = useCallback((action: AssignedAction) => {
    setSelectedAction(action);
  }, []);

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
                    ({pending!.returnForAdditional.length})
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
                    {pending!.returnForAdditional.map((item) => (
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
                    ({pending!.assignedActions.length})
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
                    {pending!.assignedActions.map((action) => (
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

            {/* Resubmitted Reviews */}
            {hasReviewerResubmitted && (
              <div className="bg-white rounded-lg border border-border-light overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border-light bg-green-50">
                  <CheckCircleOutlined style={{ color: '#52C41A', fontSize: 16 }} />
                  <h2 className="text-sm font-semibold text-green-700">
                    Reviews Waiting for Accept
                  </h2>
                  <span className="ml-1 text-xs text-green-500">
                    ({pending!.reviewerResubmitted.length})
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
                    {pending!.reviewerResubmitted.map((item) => (
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
                    ({pending!.reviewerPendingActions.length})
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
                    {pending!.reviewerPendingActions.map((action) => (
                      <tr
                        key={action.id}
                        className="hover:bg-orange-50/50 cursor-pointer transition-colors"
                        onClick={() => handleActionClick(action)}
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
          onClose={() => setSelectedAction(null)}
        />
      )}
    </PageLayout>
  );
}

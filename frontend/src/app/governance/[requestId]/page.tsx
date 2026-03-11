'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { PageLayout } from '@/components/layout/PageLayout';
import { useToast } from '@/components/ui/Toast';
import { statusColors } from '@/lib/constants';
import Link from 'next/link';
import clsx from 'clsx';

interface GovRequest {
  id: string;
  requestId: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  requestor: string;
  requestorName: string;
  organization: string;
  overallVerdict: string | null;
  projectName: string;
  projectId: string;
  createAt: string;
}

interface ProgressData {
  totalDomains: number;
  completedDomains: number;
  progressPercent: number;
  openInfoRequests: number;
  domains: { domainCode: string; status: string; outcome: string | null; reviewer: string | null }[];
}

export default function RequestDetailPage() {
  const params = useParams();
  const requestId = params.requestId as string;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: request, isLoading } = useQuery<GovRequest>({
    queryKey: ['governance-request', requestId],
    queryFn: () => api.get(`/governance-requests/${requestId}`),
  });

  const submitMutation = useMutation({
    mutationFn: () => api.put(`/governance-requests/${requestId}/submit`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-request', requestId] });
      toast('Request submitted for review', 'success');
    },
    onError: () => toast('Failed to submit request', 'error'),
  });

  const { data: progress } = useQuery<ProgressData>({
    queryKey: ['progress', requestId],
    queryFn: () => api.get(`/progress/${requestId}`),
    enabled: !!request && request.status !== 'Draft',
  });

  if (isLoading) return <PageLayout><p>Loading...</p></PageLayout>;
  if (!request) return <PageLayout><p>Request not found</p></PageLayout>;

  const steps = [
    { label: 'Create', href: '#', done: true },
    { label: 'Scoping', href: `/governance/${requestId}/scoping`, done: ['Scoping', 'In Review', 'Info Requested', 'Completed'].includes(request.status) },
    { label: 'Questionnaire', href: `/governance/${requestId}/common-questionnaire`, done: ['In Review', 'Info Requested', 'Completed'].includes(request.status) },
    { label: 'Reviews', href: `/governance/${requestId}/reviews`, done: ['In Review', 'Info Requested', 'Completed'].includes(request.status) },
    { label: 'Summary', href: `/governance/${requestId}/summary`, done: request.status === 'Completed' },
  ];

  return (
    <PageLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">{request.requestId}: {request.title}</h1>
            <div className="flex items-center gap-3 mt-2">
              <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[request.status] || 'bg-gray-400')}>
                {request.status}
              </span>
              <span className="text-sm text-text-secondary">Priority: {request.priority}</span>
              {request.overallVerdict && (
                <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[request.overallVerdict] || 'bg-gray-400')}>
                  {request.overallVerdict}
                </span>
              )}
            </div>
          </div>
          {request.status === 'Draft' && (
            <button
              className="btn-teal"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              data-testid="submit-request-btn"
            >
              {submitMutation.isPending ? 'Submitting...' : 'Submit for Review'}
            </button>
          )}
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8 bg-white p-4 rounded-lg border border-border-light">
          {steps.map((step, i) => (
            <div key={step.label} className="flex items-center">
              {i > 0 && <div className={clsx('w-8 h-0.5 mx-2', step.done ? 'bg-egm-teal' : 'bg-border-light')} />}
              <Link
                href={step.href}
                className={clsx(
                  'px-4 py-2 rounded text-sm font-medium',
                  step.done ? 'bg-egm-teal/10 text-egm-teal' : 'bg-gray-50 text-text-secondary'
                )}
              >
                {step.label}
              </Link>
            </div>
          ))}
        </div>

        {/* Request details */}
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-lg border border-border-light p-6">
            <h2 className="text-lg font-semibold mb-4">Request Details</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex"><dt className="w-32 text-text-secondary">Requestor</dt><dd>{request.requestorName || request.requestor}</dd></div>
              <div className="flex"><dt className="w-32 text-text-secondary">Organization</dt><dd>{request.organization || '-'}</dd></div>
              <div className="flex"><dt className="w-32 text-text-secondary">Project</dt><dd>{request.projectId ? `${request.projectId}${request.projectName ? ` — ${request.projectName}` : ''}` : '-'}</dd></div>
              <div className="flex"><dt className="w-32 text-text-secondary">Created</dt><dd>{request.createAt ? new Date(request.createAt).toLocaleDateString() : '-'}</dd></div>
              <div className="flex"><dt className="w-32 text-text-secondary">Description</dt><dd>{request.description || '-'}</dd></div>
            </dl>
          </div>

          {progress && progress.totalDomains > 0 && (
            <div className="bg-white rounded-lg border border-border-light p-6">
              <h2 className="text-lg font-semibold mb-4">Review Progress</h2>
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span>{progress.completedDomains}/{progress.totalDomains} domains complete</span>
                  <span>{progress.progressPercent}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-egm-teal h-2 rounded-full transition-all" style={{ width: `${progress.progressPercent}%` }} />
                </div>
              </div>
              {progress.openInfoRequests > 0 && (
                <p className="text-sm text-status-info-requested mb-3">{progress.openInfoRequests} open info request(s)</p>
              )}
              <div className="space-y-2">
                {progress.domains.map((d) => (
                  <div key={d.domainCode} className="flex items-center justify-between text-sm p-2 bg-bg-gray rounded">
                    <span className="font-medium">{d.domainCode}</span>
                    <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[d.status] || 'bg-gray-400')}>
                      {d.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

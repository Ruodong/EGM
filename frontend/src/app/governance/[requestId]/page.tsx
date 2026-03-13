'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { PageLayout } from '@/components/layout/PageLayout';
import { useToast } from '@/components/ui/Toast';
import { statusColors } from '@/lib/constants';
import Link from 'next/link';
import clsx from 'clsx';

interface Attachment {
  id: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  createBy: string;
  createAt: string;
}

interface GovRequest {
  id: string;
  requestId: string;
  egqId: string | null;
  title: string;
  description: string;
  govProjectType: string | null;
  businessUnit: string | null;
  status: string;
  requestor: string;
  requestorName: string;
  productSoftwareType: string | null;
  productSoftwareTypeOther: string | null;
  productEndUser: string[];
  userRegion: string[];
  thirdPartyVendor: string | null;
  overallVerdict: string | null;
  projectId: string | null;
  projectType: string | null;
  projectCode: string | null;
  projectName: string | null;
  projectProjType: string | null;
  projectStatus: string | null;
  projectDescription: string | null;
  projectPm: string | null;
  projectPmItcode: string | null;
  projectDtLead: string | null;
  projectDtLeadItcode: string | null;
  projectItLead: string | null;
  projectItLeadItcode: string | null;
  projectStartDate: string | null;
  projectGoLiveDate: string | null;
  projectEndDate: string | null;
  projectAiRelated: string | null;
  createAt: string;
  ruleCodes: string[];
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

  const { data: attachmentsData } = useQuery<{ data: Attachment[] }>({
    queryKey: ['attachments', requestId],
    queryFn: () => api.get(`/governance-requests/${requestId}/attachments`),
    enabled: !!request,
  });

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

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
            <h1 className="text-xl font-bold">
              {request.egqId || request.requestId}
              {request.govProjectType && <span className="text-text-secondary font-normal"> · {request.govProjectType}</span>}
              {request.projectName && <span className="text-text-secondary font-normal"> · {request.projectName}</span>}
            </h1>
            <div className="flex items-center gap-3 mt-2">
              <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[request.status] || 'bg-gray-400')}>
                {request.status}
              </span>
              {request.productSoftwareType && <span className="text-sm text-text-secondary">{request.productSoftwareType === 'Other' ? request.productSoftwareTypeOther : request.productSoftwareType}</span>}
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
              <div className="flex"><dt className="w-32 text-text-secondary">Business Unit</dt><dd data-testid="request-bu">{request.businessUnit || '-'}</dd></div>
              <div className="flex"><dt className="w-32 text-text-secondary">End User</dt><dd>{request.productEndUser?.join(', ') || '-'}</dd></div>
              <div className="flex"><dt className="w-32 text-text-secondary">User Region</dt><dd>{request.userRegion?.join(', ') || '-'}</dd></div>
              {request.thirdPartyVendor && <div className="flex"><dt className="w-32 text-text-secondary">3rd-party Vendor</dt><dd>{request.thirdPartyVendor}</dd></div>}
              <div className="flex"><dt className="w-32 text-text-secondary">Project</dt><dd>{request.projectCode || request.projectId ? `${request.projectCode || request.projectId}${request.projectName ? ` — ${request.projectName}` : ''}` : '-'}</dd></div>
              <div className="flex"><dt className="w-32 text-text-secondary">Created</dt><dd>{request.createAt ? new Date(request.createAt).toLocaleDateString() : '-'}</dd></div>
              <div className="flex"><dt className="w-32 text-text-secondary">Description</dt><dd>{request.description || '-'}</dd></div>
              <div className="flex">
                <dt className="w-32 text-text-secondary">Rules</dt>
                <dd data-testid="request-rule-codes">
                  {request.ruleCodes && request.ruleCodes.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {request.ruleCodes.map((code) => (
                        <span key={code} className="px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-700 font-medium font-mono">
                          {code}
                        </span>
                      ))}
                    </div>
                  ) : '-'}
                </dd>
              </div>
            </dl>
          </div>

          {(request.projectType || request.projectCode || request.projectId) && (
            <div className="bg-white rounded-lg border border-border-light p-6" data-testid="project-info-card">
              <h2 className="text-lg font-semibold mb-4">
                Project Information
                {request.projectType && (
                  <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded bg-gray-100 text-text-secondary">
                    {request.projectType === 'mspo' ? 'MSPO' : 'Non-MSPO'}
                  </span>
                )}
              </h2>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {request.projectCode && <div><dt className="text-text-secondary">Code</dt><dd>{request.projectCode}</dd></div>}
                {request.projectName && <div><dt className="text-text-secondary">Name</dt><dd>{request.projectName}</dd></div>}
                {request.projectProjType && <div><dt className="text-text-secondary">Type</dt><dd>{request.projectProjType}</dd></div>}
                {request.projectStatus && <div><dt className="text-text-secondary">Status</dt><dd>{request.projectStatus}</dd></div>}
                {request.projectPm && <div><dt className="text-text-secondary">PM</dt><dd>{request.projectPm}{request.projectPmItcode ? ` (${request.projectPmItcode})` : ''}</dd></div>}
                {request.projectDtLead && <div><dt className="text-text-secondary">DT Lead</dt><dd>{request.projectDtLead}</dd></div>}
                {request.projectItLead && <div><dt className="text-text-secondary">IT Lead</dt><dd>{request.projectItLead}</dd></div>}
                {request.projectStartDate && <div><dt className="text-text-secondary">Start Date</dt><dd>{request.projectStartDate}</dd></div>}
                {request.projectGoLiveDate && <div><dt className="text-text-secondary">Go Live Date</dt><dd>{request.projectGoLiveDate}</dd></div>}
                {request.projectEndDate && <div><dt className="text-text-secondary">End Date</dt><dd>{request.projectEndDate}</dd></div>}
                {request.projectAiRelated && <div><dt className="text-text-secondary">AI Related</dt><dd>{request.projectAiRelated}</dd></div>}
                {request.projectDescription && (
                  <div className="col-span-2"><dt className="text-text-secondary">Description</dt><dd>{request.projectDescription}</dd></div>
                )}
              </dl>
            </div>
          )}

          {attachmentsData && attachmentsData.data.length > 0 && (
            <div className="bg-white rounded-lg border border-border-light p-6" data-testid="attachments-card">
              <h2 className="text-lg font-semibold mb-4">Attachments</h2>
              <ul className="space-y-2">
                {attachmentsData.data.map((att) => (
                  <li key={att.id} className="flex items-center justify-between text-sm p-2 bg-bg-gray rounded">
                    <span className="font-medium truncate">{att.fileName}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-text-secondary text-xs">
                        {att.fileSize < 1024 ? `${att.fileSize} B` : att.fileSize < 1048576 ? `${(att.fileSize / 1024).toFixed(1)} KB` : `${(att.fileSize / 1048576).toFixed(1)} MB`}
                      </span>
                      <a
                        href={`${API_BASE}/governance-requests/${requestId}/attachments/${att.id}`}
                        className="text-egm-teal hover:underline text-xs"
                        download
                      >
                        Download
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

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

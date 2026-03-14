'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState, useMemo } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { statusColors } from '@/lib/constants';
import { SectionCard } from '../../../_components/SectionCard';
import { DomainQuestionnaires } from '../../../_components/DomainQuestionnaires';
import { ProcessingLogStepper } from '../../../_components/ProcessingLogStepper';
import { DomainPreviewChip } from '../../../_components/DomainPreviewChip';
import { HistoryOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import clsx from 'clsx';

interface ChangeEntry {
  id: string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: string;
  changedAt: string | null;
}

interface DomainReview {
  id: string;
  requestId: string;
  domainCode: string;
  domainName: string;
  status: string;
  outcome: string | null;
  reviewer: string | null;
  reviewerName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  commonDataUpdatedAt: string | null;
}

interface InfoRequest {
  id: string;
  category: string;
  fieldReference: string | null;
  description: string;
  status: string;
  priority: string;
  resolutionNote: string | null;
  createAt: string;
}

interface GovRequest {
  id: string;
  requestId: string;
  title: string;
  govProjectType: string | null;
  businessUnit: string | null;
  status: string;
  requestor: string;
  requestorName: string;
  requestorEmail?: string;
  requestorManagerName?: string;
  requestorTier1Org?: string;
  requestorTier2Org?: string;
  productSoftwareType: string | null;
  productSoftwareTypeOther: string | null;
  productEndUser: string[];
  userRegion: string[];
  thirdPartyVendor: string | null;
  projectType: string | null;
  projectCode: string | null;
  projectName: string | null;
  projectDescription: string | null;
  projectPm: string | null;
  projectStartDate: string | null;
  projectGoLiveDate: string | null;
  projectEndDate: string | null;
  ruleCodes?: string[];
  autoRuleCodes?: string[];
}

interface MatrixData {
  rules: { ruleCode: string; ruleName: string; parentRuleCode: string | null }[];
  domains: { domainCode: string; domainName: string }[];
  matrix: Record<string, Record<string, string>>;
}

function formatChangeValue(val: unknown): string {
  if (val === null || val === undefined) return '(empty)';
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <label className="text-xs text-text-secondary">{label}</label>
      <div className="text-sm mt-0.5">{value || '-'}</div>
    </div>
  );
}

function ReadOnlyRulesDisplay({ ruleCodes }: { ruleCodes: string[] }) {
  const { data: matrixData, isLoading } = useQuery<MatrixData>({
    queryKey: ['dispatch-rules-matrix'],
    queryFn: () => api.get('/dispatch-rules/matrix'),
  });

  if (isLoading) return <span className="text-xs text-text-secondary">Loading rules...</span>;
  if (!ruleCodes.length) return <span className="text-sm text-text-secondary">No rules selected</span>;

  const ruleMap = new Map(matrixData?.rules.map((r) => [r.ruleCode, r]) || []);

  const autoParents = new Set<string>();
  for (const code of ruleCodes) {
    const rule = ruleMap.get(code);
    if (rule?.parentRuleCode) autoParents.add(rule.parentRuleCode);
  }

  type Group = { parent: { ruleCode: string; ruleName: string }; children: { ruleCode: string; ruleName: string }[] };
  const groups: Group[] = [];
  const usedCodes = new Set<string>();

  for (const parentCode of autoParents) {
    const parentRule = ruleMap.get(parentCode);
    if (!parentRule) continue;
    const children = ruleCodes
      .filter((c) => ruleMap.get(c)?.parentRuleCode === parentCode)
      .map((c) => ({ ruleCode: c, ruleName: ruleMap.get(c)?.ruleName || c }));
    groups.push({ parent: { ruleCode: parentCode, ruleName: parentRule.ruleName }, children });
    usedCodes.add(parentCode);
    children.forEach((ch) => usedCodes.add(ch.ruleCode));
  }

  for (const code of ruleCodes) {
    if (usedCodes.has(code)) continue;
    const rule = ruleMap.get(code);
    if (!rule || rule.parentRuleCode) continue;
    groups.push({ parent: { ruleCode: code, ruleName: rule.ruleName }, children: [] });
    usedCodes.add(code);
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.parent.ruleCode}>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-text-primary bg-gray-100">
            {group.parent.ruleName}
            <span className="text-xs opacity-70">({group.parent.ruleCode})</span>
          </span>
          {group.children.length > 0 && (
            <div className="ml-6 mt-1.5 flex flex-wrap gap-1.5">
              {group.children.map((child) => (
                <span key={child.ruleCode} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-text-primary bg-gray-100">
                  {child.ruleName}
                  <span className="text-xs opacity-70">({child.ruleCode})</span>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ApplicableDomainsDisplay({ ruleCodes }: { ruleCodes: string[] }) {
  const { data: matrixData, isLoading } = useQuery<MatrixData>({
    queryKey: ['dispatch-rules-matrix'],
    queryFn: () => api.get('/dispatch-rules/matrix'),
  });

  const triggeredDomains = useMemo(() => {
    if (!matrixData || !ruleCodes) return [];
    const domainSet = new Set<string>();

    const parentCodes = new Set<string>();
    for (const rc of ruleCodes) {
      const rule = matrixData.rules.find((r) => r.ruleCode === rc);
      if (rule?.parentRuleCode) parentCodes.add(rule.parentRuleCode);
    }

    for (const rc of ruleCodes) {
      const ruleMatrix = matrixData.matrix[rc];
      if (!ruleMatrix) continue;
      for (const [domainCode, rel] of Object.entries(ruleMatrix)) {
        if (rel === 'in') domainSet.add(domainCode);
      }
    }

    for (const pc of parentCodes) {
      const parentMatrix = matrixData.matrix[pc];
      if (!parentMatrix) continue;
      for (const [domainCode, rel] of Object.entries(parentMatrix)) {
        if (rel === 'in') domainSet.add(domainCode);
      }
    }

    return matrixData.domains.filter((d) => domainSet.has(d.domainCode));
  }, [ruleCodes, matrixData]);

  if (isLoading) return <span className="text-xs text-text-secondary">Loading domains...</span>;

  if (triggeredDomains.length === 0) {
    return <span className="text-xs text-text-secondary italic">No domains triggered</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {triggeredDomains.map((domain) => (
        <DomainPreviewChip key={domain.domainCode} domainCode={domain.domainCode} domainName={domain.domainName} />
      ))}
    </div>
  );
}

export default function DomainReviewDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const requestId = params.requestId as string;
  const domainCode = params.domainCode as string;

  const [showInfoForm, setShowInfoForm] = useState(false);
  const [infoCategory, setInfoCategory] = useState('');
  const [infoDescription, setInfoDescription] = useState('');
  const [infoPriority, setInfoPriority] = useState('Normal');
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [returnReason, setReturnReason] = useState('');

  // Get all reviews for this request, then find the one for this domain
  const { data: reviews } = useQuery<{ data: DomainReview[] }>({
    queryKey: ['domain-reviews', requestId],
    queryFn: () => api.get('/domain-reviews', { request_id: requestId }),
  });

  const review = reviews?.data?.find((r) => r.domainCode === domainCode);

  // Fetch governance request details
  const { data: govRequest } = useQuery<GovRequest>({
    queryKey: ['governance-request', requestId],
    queryFn: () => api.get(`/governance-requests/${requestId}`),
  });

  const { data: infoRequests } = useQuery<{ data: InfoRequest[] }>({
    queryKey: ['info-requests', requestId, domainCode, review?.id],
    queryFn: () => api.get('/info-requests', { request_id: requestId, domainReviewId: review!.id }),
    enabled: !!review,
  });

  // Fetch change history for the governance request
  const { data: changelogData } = useQuery<{ data: ChangeEntry[] }>({
    queryKey: ['changelog', requestId],
    queryFn: () => api.get(`/governance-requests/${requestId}/changelog`),
    enabled: !!govRequest,
  });

  const changelog: ChangeEntry[] = changelogData?.data ?? [];

  const assignMutation = useMutation({
    mutationFn: () => api.put(`/domain-reviews/${review?.id}/assign`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domain-reviews', requestId] });
      toast('Review assigned', 'success');
    },
  });

  const startMutation = useMutation({
    mutationFn: () => api.put(`/domain-reviews/${review?.id}/start`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domain-reviews', requestId] });
      toast('Review started', 'success');
    },
  });

  const completeMutation = useMutation({
    mutationFn: (outcome: string) => api.put(`/domain-reviews/${review?.id}/complete`, { outcome }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domain-reviews', requestId] });
      toast('Review completed', 'success');
    },
  });

  const createInfoRequest = useMutation({
    mutationFn: () =>
      api.post('/info-requests', {
        requestId,
        domainReviewId: review?.id,
        category: infoCategory,
        description: infoDescription,
        priority: infoPriority,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['info-requests'] });
      toast('Information request created', 'success');
      setShowInfoForm(false);
      setInfoCategory('');
      setInfoDescription('');
    },
    onError: () => toast('Failed to create info request', 'error'),
  });

  const returnMutation = useMutation({
    mutationFn: (reason: string) => api.put(`/domain-reviews/${review?.id}/return`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domain-reviews', requestId] });
      queryClient.invalidateQueries({ queryKey: ['governance-request', requestId] });
      toast('Request returned to requestor', 'success');
      setShowReturnDialog(false);
      setReturnReason('');
    },
    onError: () => toast('Failed to return request', 'error'),
  });

  const acceptMutation = useMutation({
    mutationFn: () => api.put(`/domain-reviews/${review?.id}/accept`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domain-reviews', requestId] });
      queryClient.invalidateQueries({ queryKey: ['governance-request', requestId] });
      toast('Request accepted', 'success');
    },
    onError: () => toast('Failed to accept request', 'error'),
  });

  if (!review) {
    return (
      <PageLayout>
        <div className="max-w-4xl mx-auto">
          <p className="text-text-secondary">Loading review for {domainCode}...</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">{review.domainName || review.domainCode} Review</h1>
            <p className="text-sm text-text-secondary mt-0.5">
              {requestId} {govRequest?.projectName ? `· ${govRequest.projectName}` : ''}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[review.status] || 'bg-gray-400')}>
                {review.status}
              </span>
              {review.outcome && (
                <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[review.outcome] || 'bg-gray-400')}>
                  {review.outcome}
                </span>
              )}
            </div>
          </div>
          {review.status === 'Waiting for Accept' && (
            <div className="flex gap-2">
              <Button
                style={{ background: '#f59e0b', borderColor: '#f59e0b', color: '#fff' }}
                onClick={() => setShowReturnDialog(true)}
              >
                Return to Requestor
              </Button>
              <Button
                type="primary"
                style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
                onClick={() => acceptMutation.mutate()}
                disabled={acceptMutation.isPending}
              >
                {acceptMutation.isPending ? 'Accepting...' : 'Accept Request'}
              </Button>
            </div>
          )}
        </div>

        {/* Return to Requestor Dialog */}
        {showReturnDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold mb-2">Return to Requestor</h3>
              <p className="text-sm text-text-secondary mb-4">
                Please provide a reason for returning this request. The requestor will be notified and can update the submission.
              </p>
              <textarea
                className="input-field w-full h-28 resize-none"
                placeholder="Enter the reason or information needed from the requestor..."
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-4">
                <Button type="default" onClick={() => { setShowReturnDialog(false); setReturnReason(''); }}>
                  Cancel
                </Button>
                <Button
                  style={{ background: '#f59e0b', borderColor: '#f59e0b', color: '#fff' }}
                  onClick={() => returnMutation.mutate(returnReason)}
                  disabled={!returnReason.trim() || returnMutation.isPending}
                >
                  {returnMutation.isPending ? 'Submitting...' : 'Confirm Return'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {review.commonDataUpdatedAt && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-blue-800">
              Common questionnaire data was updated on {new Date(review.commonDataUpdatedAt).toLocaleString()}.
              Review the changes before continuing.
            </p>
          </div>
        )}

        {/* Processing Log Stepper */}
        {govRequest && (
          <div className="bg-white rounded-lg border border-border-light p-4 mb-4">
            <ProcessingLogStepper
              currentStatus={govRequest.status}
              infoInquiryDomain={review?.domainName || review?.domainCode}
            />
          </div>
        )}

        {/* Applicable Domains */}
        {govRequest && govRequest.status !== 'Draft' && (
          <div className="bg-white rounded-lg border border-border-light p-4 mb-4">
            <label className="block text-sm font-medium mb-2 text-text-secondary">Applicable Domains</label>
            <ApplicableDomainsDisplay ruleCodes={govRequest.ruleCodes || []} />
          </div>
        )}

        <div className="space-y-4">
          {/* Governance Scope Determination (read-only) */}
          {govRequest && (
            <SectionCard title="Governance Scope Determination" subtitle="Compliance rules selected by requestor">
              <ReadOnlyRulesDisplay ruleCodes={govRequest.ruleCodes || []} />
            </SectionCard>
          )}

          {/* Requestor Information (read-only) */}
          {govRequest && (
            <SectionCard title="Requestor Information" defaultOpen>
              <div className="grid grid-cols-2 gap-4">
                <InfoField label="IT Code" value={govRequest.requestor} />
                <InfoField label="Name" value={govRequest.requestorName} />
                <InfoField label="Email Address" value={govRequest.requestorEmail} />
                <InfoField label="Line Manager" value={govRequest.requestorManagerName} />
                <InfoField label="T1 Organization" value={govRequest.requestorTier1Org} />
                <InfoField label="T2 Organization" value={govRequest.requestorTier2Org} />
              </div>
            </SectionCard>
          )}

          {/* Project Information (inherited from governance request) */}
          {govRequest && (
            <SectionCard title="Project Information" subtitle="Inherited from governance request" defaultOpen={false}>
              <div className="grid grid-cols-2 gap-4">
                <InfoField label="Request ID" value={govRequest.requestId} />
                <InfoField label="Requestor" value={govRequest.requestorName || govRequest.requestor} />
                <InfoField label="Project Type" value={govRequest.govProjectType} />
                <InfoField label="Business Unit" value={govRequest.businessUnit} />
                <InfoField label="Project Mode" value={govRequest.projectType === 'mspo' ? 'MSPO Project' : 'Non-MSPO Project'} />
                <InfoField label="Project Name" value={govRequest.projectName} />
                {govRequest.projectType === 'non_mspo' && (
                  <>
                    <InfoField label="Project Code" value={govRequest.projectCode} />
                    <InfoField label="Project Manager" value={govRequest.projectPm} />
                    <InfoField label="Start Date" value={govRequest.projectStartDate} />
                    <InfoField label="Go-Live Date" value={govRequest.projectGoLiveDate} />
                    {govRequest.projectEndDate && <InfoField label="End Date" value={govRequest.projectEndDate} />}
                  </>
                )}
                {govRequest.projectDescription && (
                  <div className="col-span-2">
                    <InfoField label="Description" value={govRequest.projectDescription} />
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {/* Business & Product Information */}
          {govRequest && (
            <SectionCard title="Business & Product Information" defaultOpen={false}>
              <div className="grid grid-cols-2 gap-4">
                <InfoField label="Product/Software Type" value={govRequest.productSoftwareType === 'Other' ? `Other: ${govRequest.productSoftwareTypeOther}` : govRequest.productSoftwareType} />
                <InfoField label="Third-party Vendor" value={govRequest.thirdPartyVendor} />
                <div>
                  <label className="text-xs text-text-secondary">Product End User</label>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {govRequest.productEndUser?.length ? govRequest.productEndUser.map((u) => (
                      <span key={u} className="text-xs bg-gray-100 px-2 py-0.5 rounded">{u}</span>
                    )) : <span className="text-sm">-</span>}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-secondary">User Region</label>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {govRequest.userRegion?.length ? govRequest.userRegion.map((r) => (
                      <span key={r} className="text-xs bg-gray-100 px-2 py-0.5 rounded">{r}</span>
                    )) : <span className="text-sm">-</span>}
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {/* Domain Questionnaire Answers (read-only) */}
          <SectionCard title="Domain Questionnaire" subtitle={`Answers submitted by the requestor for ${review.domainName || review.domainCode}`} defaultOpen>
            <DomainQuestionnaires requestId={requestId} readOnly />
          </SectionCard>

          {/* Change History */}
          {changelog.length > 0 && (
            <SectionCard title="Change History" subtitle={`${changelog.length} change(s) recorded`} defaultOpen={false}>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {[...changelog].reverse().map((entry) => {
                  const isQuestionnaire = entry.fieldName.startsWith('questionnaire:');
                  let displayField = entry.fieldName;
                  let category = 'Request Field';
                  if (isQuestionnaire) {
                    const parts = entry.fieldName.split(':');
                    const domain = parts[1] || '';
                    const question = parts.slice(2).join(':') || '';
                    displayField = question;
                    category = `Questionnaire (${domain})`;
                  }

                  return (
                    <div key={entry.id} className="border border-border-light rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <HistoryOutlined style={{ fontSize: 14, color: '#d97706' }} />
                          <span className="text-sm font-medium text-text-primary">{displayField}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-text-secondary">{category}</span>
                        </div>
                        <span className="text-xs text-text-secondary">
                          {entry.changedAt ? new Date(entry.changedAt).toLocaleString() : ''}
                        </span>
                      </div>
                      <div className="text-xs text-text-secondary mb-1">by {entry.changedBy}</div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="line-through text-red-500">{formatChangeValue(entry.oldValue)}</span>
                        <span className="text-text-secondary">→</span>
                        <span className="text-green-600 font-medium">{formatChangeValue(entry.newValue)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}
        </div>

        {/* Review Action Buttons */}
        {(review.status === 'Pending' || review.status === 'Assigned' || review.status === 'In Progress') && (
          <div className="bg-white rounded-lg border border-border-light p-6 mt-4">
            <h2 className="text-base font-semibold mb-3">Review Actions</h2>
            <div className="flex gap-2">
              {review.status === 'Pending' && (
                <Button type="primary" style={{ background: '#13C2C2', borderColor: '#13C2C2' }} onClick={() => assignMutation.mutate()}>
                  Assign to Me
                </Button>
              )}
              {review.status === 'Assigned' && (
                <Button type="primary" style={{ background: '#13C2C2', borderColor: '#13C2C2' }} onClick={() => startMutation.mutate()}>
                  Start Review
                </Button>
              )}
              {review.status === 'In Progress' && (
                <>
                  <Button type="primary" style={{ background: '#13C2C2', borderColor: '#13C2C2' }} onClick={() => completeMutation.mutate('Approved')}>
                    Approve
                  </Button>
                  <Button style={{ background: '#f59e0b', borderColor: '#f59e0b', color: '#fff' }} onClick={() => completeMutation.mutate('Approved with Conditions')}>
                    Approve with Conditions
                  </Button>
                  <Button danger type="primary" onClick={() => completeMutation.mutate('Rejected')}>
                    Reject
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Info Supplement Requests */}
        <div className="bg-white rounded-lg border border-border-light p-6 mt-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Information Requests</h2>
            {review.status === 'In Progress' && (
              <button className="text-sm text-primary-blue hover:underline" onClick={() => setShowInfoForm(!showInfoForm)}>
                + Request More Info
              </button>
            )}
          </div>

          {showInfoForm && (
            <div className="bg-gray-50 rounded p-4 mb-4 space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Category</label>
                <select className="select-field" value={infoCategory} onChange={(e) => setInfoCategory(e.target.value)}>
                  <option value="">-- Select Section --</option>
                  <option value="Project Details">Project Details</option>
                  <option value="Business Scenarios">Business Scenarios</option>
                  <option value="Data Info">Data Info</option>
                  <option value="Tech Overview">Tech Overview</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  className="input-field h-20"
                  value={infoDescription}
                  onChange={(e) => setInfoDescription(e.target.value)}
                  placeholder="What information is missing or needs to be updated?"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Priority</label>
                <select className="select-field" value={infoPriority} onChange={(e) => setInfoPriority(e.target.value)}>
                  <option value="Normal">Normal</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </div>
              <div className="flex gap-2">
                <Button type="primary" style={{ background: '#13C2C2', borderColor: '#13C2C2' }} onClick={() => createInfoRequest.mutate()} disabled={!infoCategory || !infoDescription}>
                  Submit Request
                </Button>
                <Button type="default" onClick={() => setShowInfoForm(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {infoRequests?.data && infoRequests.data.length > 0 ? (
            <div className="space-y-3">
              {infoRequests.data.map((ir) => (
                <div key={ir.id} className="border border-border-light rounded p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{ir.category}</span>
                      <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[ir.status] || 'bg-gray-400')}>
                        {ir.status}
                      </span>
                      {ir.priority === 'Urgent' && (
                        <span className="px-2 py-0.5 rounded text-xs bg-red-500 text-white">Urgent</span>
                      )}
                    </div>
                    <span className="text-xs text-text-secondary">{new Date(ir.createAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-text-secondary mt-1">{ir.description}</p>
                  {ir.resolutionNote && (
                    <p className="text-sm text-green-700 mt-1">Resolution: {ir.resolutionNote}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">No information requests.</p>
          )}
        </div>

        <div className="flex justify-between mt-6 pb-8">
          <Button type="default" onClick={() => router.push('/reviews')}>
            Back to Reviews
          </Button>
        </div>
      </div>
    </PageLayout>
  );
}

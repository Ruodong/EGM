'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState, useMemo, useRef } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { statusColors } from '@/lib/constants';
import { SectionCard } from '../../../_components/SectionCard';
import { DomainQuestionnaires } from '../../../_components/DomainQuestionnaires';
import { type ChangeEntry } from '../../../_components/ChangeHighlight';
import { ReviewerQuestionnaires, type ReviewerQuestionnairesRef } from '../../../_components/ReviewerQuestionnaires';
import { ProcessingLogStepper } from '../../../_components/ProcessingLogStepper';
import { DomainPreviewChip } from '../../../_components/DomainPreviewChip';
import { ActionItemsSection } from '../../../_components/ActionItemsSection';
import { AskEgmFloating } from '../../../_components/AskEgmFloating';
import { AIAnalysisSection } from '../../../_components/AIAnalysisSection';
import { Button } from 'antd';
import { useLocale } from '@/lib/locale-context';
import clsx from 'clsx';

interface ActivityLogEntry {
  id: string;
  action: string;
  entityType: string;
  domainCode: string | null;
  performedBy: string;
  performerName: string | null;
  performedAt: string | null;
  details: string;
}

interface DomainReview {
  id: string;
  requestId: string;
  domainCode: string;
  domainName: string;
  status: string;
  outcome: string | null;
  outcomeNotes: string | null;
  returnReason: string | null;
  reviewer: string | null;
  reviewerName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  commonDataUpdatedAt: string | null;
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

function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <label className="text-xs text-text-secondary">{label}</label>
      <div className="text-sm mt-0.5">{value || '-'}</div>
    </div>
  );
}

function ReadOnlyRulesDisplay({ ruleCodes }: { ruleCodes: string[] }) {
  const { t } = useLocale();
  const { data: matrixData, isLoading } = useQuery<MatrixData>({
    queryKey: ['dispatch-rules-matrix'],
    queryFn: () => api.get('/dispatch-rules/matrix'),
  });

  if (isLoading) return <span className="text-xs text-text-secondary">{t('domainReview.loadingRules')}</span>;
  if (!ruleCodes.length) return <span className="text-sm text-text-secondary">{t('domainReview.noRulesSelected')}</span>;

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
  const { t } = useLocale();
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

  if (isLoading) return <span className="text-xs text-text-secondary">{t('domainReview.loadingDomains')}</span>;

  if (triggeredDomains.length === 0) {
    return <span className="text-xs text-text-secondary italic">{t('domainReview.noDomainsTriggered')}</span>;
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
  const { t } = useLocale();

  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [showExceptionDialog, setShowExceptionDialog] = useState(false);
  const [exceptionNotes, setExceptionNotes] = useState('');
  const [showNotPassDialog, setShowNotPassDialog] = useState(false);
  const [notPassNotes, setNotPassNotes] = useState('');
  const reviewerQRef = useRef<ReviewerQuestionnairesRef>(null);

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

  // Fetch activity log for the governance request
  const { data: activityLogData } = useQuery<{ data: ActivityLogEntry[] }>({
    queryKey: ['activity-log', requestId],
    queryFn: () => api.get(`/governance-requests/${requestId}/activity-log`),
    enabled: !!govRequest,
  });

  // Show all request-level and domain-level activity (no domain filtering)
  const activityLog: ActivityLogEntry[] = activityLogData?.data ?? [];

  // Fetch changelog for questionnaire change indicators
  const { data: changelogData } = useQuery<{ data: ChangeEntry[] }>({
    queryKey: ['changelog', requestId],
    queryFn: () => api.get(`/governance-requests/${requestId}/changelog`),
    enabled: !!requestId,
  });
  const changelog: ChangeEntry[] = changelogData?.data ?? [];

  const returnMutation = useMutation({
    mutationFn: (reason: string) => api.put(`/domain-reviews/${review?.id}/return`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domain-reviews', requestId] });
      queryClient.invalidateQueries({ queryKey: ['governance-request', requestId] });
      queryClient.invalidateQueries({ queryKey: ['activity-log', requestId] });
      toast(t('domainReview.requestReturned'), 'success');
      setShowReturnDialog(false);
      setReturnReason('');
    },
    onError: () => toast(t('domainReview.failedReturn'), 'error'),
  });

  const acceptMutation = useMutation({
    mutationFn: () => api.put(`/domain-reviews/${review?.id}/accept`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domain-reviews', requestId] });
      queryClient.invalidateQueries({ queryKey: ['governance-request', requestId] });
      queryClient.invalidateQueries({ queryKey: ['activity-log', requestId] });
      toast(t('domainReview.requestAccepted'), 'success');
    },
    onError: () => toast(t('domainReview.failedAccept'), 'error'),
  });

  const approveMutation = useMutation({
    mutationFn: () => api.put(`/domain-reviews/${review?.id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domain-reviews', requestId] });
      queryClient.invalidateQueries({ queryKey: ['governance-request', requestId] });
      queryClient.invalidateQueries({ queryKey: ['activity-log', requestId] });
      toast(t('domainReview.reviewApproved'), 'success');
    },
    onError: () => toast(t('domainReview.failedApprove'), 'error'),
  });

  const approveWithExceptionMutation = useMutation({
    mutationFn: (outcomeNotes: string) => api.put(`/domain-reviews/${review?.id}/approve-with-exception`, { outcomeNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domain-reviews', requestId] });
      queryClient.invalidateQueries({ queryKey: ['governance-request', requestId] });
      queryClient.invalidateQueries({ queryKey: ['activity-log', requestId] });
      toast(t('domainReview.approvedWithExceptionSuccess'), 'success');
      setShowExceptionDialog(false);
      setExceptionNotes('');
    },
    onError: () => toast(t('domainReview.failedApprove'), 'error'),
  });

  const notPassMutation = useMutation({
    mutationFn: (outcomeNotes: string) => api.put(`/domain-reviews/${review?.id}/not-pass`, { outcomeNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domain-reviews', requestId] });
      queryClient.invalidateQueries({ queryKey: ['governance-request', requestId] });
      queryClient.invalidateQueries({ queryKey: ['activity-log', requestId] });
      toast(t('domainReview.reviewNotPassed'), 'success');
      setShowNotPassDialog(false);
      setNotPassNotes('');
    },
    onError: () => toast(t('domainReview.failedNotPass'), 'error'),
  });

  if (!review) {
    return (
      <PageLayout>
        <div className="max-w-4xl mx-auto">
          <p className="text-text-secondary">{t('domainReview.loadingReview')} {domainCode}...</p>
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
            <h1 className="text-xl font-bold">{review.domainName || review.domainCode} {t('domainReview.review')}</h1>
            <p className="text-sm text-text-secondary mt-0.5">
              {requestId} {govRequest?.projectName ? `· ${govRequest.projectName}` : ''}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[review.status] || 'bg-gray-400')}>
                {review.status}
              </span>
              {govRequest?.govProjectType && (
                <span className="px-2 py-0.5 rounded text-xs text-white bg-purple-500">
                  {govRequest.govProjectType}
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
                {t('domainReview.returnToRequestor')}
              </Button>
              <Button
                type="primary"
                style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
                onClick={() => acceptMutation.mutate()}
                disabled={acceptMutation.isPending}
              >
                {acceptMutation.isPending ? t('domainReview.accepting') : t('domainReview.acceptRequest')}
              </Button>
            </div>
          )}
        </div>

        {/* Return to Requestor Dialog */}
        {showReturnDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold mb-2">{t('domainReview.returnToRequestor')}</h3>
              <p className="text-sm text-text-secondary mb-4">
                {t('domainReview.returnReason')}
              </p>
              <textarea
                className="input-field w-full h-28 resize-none"
                placeholder={t('domainReview.returnPlaceholder')}
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-4">
                <Button type="default" onClick={() => { setShowReturnDialog(false); setReturnReason(''); }}>
                  {t('common.cancel')}
                </Button>
                <Button
                  style={{ background: '#f59e0b', borderColor: '#f59e0b', color: '#fff' }}
                  onClick={() => returnMutation.mutate(returnReason)}
                  disabled={!returnReason.trim() || returnMutation.isPending}
                >
                  {returnMutation.isPending ? t('domainReview.submitting') : t('domainReview.confirmReturn')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {review.commonDataUpdatedAt && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-blue-800">
              {t('domainReview.dataUpdatedOn')}{new Date(review.commonDataUpdatedAt).toLocaleString()}.
              {' '}{t('domainReview.reviewChanges')}
            </p>
          </div>
        )}

        {/* Processing Log Stepper */}
        {govRequest && (
          <div className="bg-white rounded-lg border border-border-light p-4 mb-4">
            <ProcessingLogStepper
              currentStatus={govRequest.status}
            />
          </div>
        )}

        {/* Applicable Domains */}
        {govRequest && govRequest.status !== 'Draft' && (
          <div className="bg-white rounded-lg border border-border-light p-4 mb-4">
            <label className="block text-sm font-medium mb-2 text-text-secondary">{t('domainReview.applicableDomains')}</label>
            <ApplicableDomainsDisplay ruleCodes={govRequest.ruleCodes || []} />
          </div>
        )}

        <div className="space-y-4">
          {/* Governance Scope Determination (read-only) */}
          {govRequest && (
            <SectionCard title={t('domainReview.scopeDetermination')} subtitle={t('domainReview.scopeSubtitle')}>
              <ReadOnlyRulesDisplay ruleCodes={govRequest.ruleCodes || []} />
            </SectionCard>
          )}

          {/* Requestor Information (read-only) */}
          {govRequest && (
            <SectionCard title={t('domainReview.requestorInfo')} defaultOpen>
              <div className="grid grid-cols-2 gap-4">
                <InfoField label={t('domainReview.itCode')} value={govRequest.requestor} />
                <InfoField label={t('common.name')} value={govRequest.requestorName} />
                <InfoField label={t('domainReview.emailAddress')} value={govRequest.requestorEmail} />
                <InfoField label={t('domainReview.lineManager')} value={govRequest.requestorManagerName} />
                <InfoField label={t('domainReview.t1Org')} value={govRequest.requestorTier1Org} />
                <InfoField label={t('domainReview.t2Org')} value={govRequest.requestorTier2Org} />
              </div>
            </SectionCard>
          )}

          {/* Project Information (inherited from governance request) */}
          {govRequest && (
            <SectionCard title={t('domainReview.projectInfo')} subtitle={t('domainReview.inheritedInfo')} defaultOpen={false}>
              <div className="grid grid-cols-2 gap-4">
                <InfoField label={t('col.requestId')} value={govRequest.requestId} />
                <InfoField label={t('col.requestor')} value={govRequest.requestorName || govRequest.requestor} />
                <InfoField label={t('govCreate.projectType')} value={govRequest.govProjectType} />
                <InfoField label={t('govCreate.businessUnit')} value={govRequest.businessUnit} />
                <InfoField label={t('domainReview.projectMode')} value={govRequest.projectType === 'mspo' ? t('govCreate.mspoProject') : t('govCreate.nonMspoProject')} />
                <InfoField label={t('col.projectName')} value={govRequest.projectName} />
                {govRequest.projectType === 'non_mspo' && (
                  <>
                    <InfoField label={t('govCreate.projectCode')} value={govRequest.projectCode} />
                    <InfoField label={t('govCreate.projectManager')} value={govRequest.projectPm} />
                    <InfoField label={t('govCreate.startDate')} value={govRequest.projectStartDate} />
                    <InfoField label={t('govCreate.goLiveDate')} value={govRequest.projectGoLiveDate} />
                    {govRequest.projectEndDate && <InfoField label={t('govCreate.endDate')} value={govRequest.projectEndDate} />}
                  </>
                )}
                {govRequest.projectDescription && (
                  <div className="col-span-2">
                    <InfoField label={t('common.description')} value={govRequest.projectDescription} />
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {/* Business & Product Information */}
          {govRequest && (
            <SectionCard title={t('domainReview.businessProductInfo')} defaultOpen={false}>
              <div className="grid grid-cols-2 gap-4">
                <InfoField label={t('govCreate.productType')} value={govRequest.productSoftwareType === 'Other' ? `${t('domainReview.otherPrefix')}${govRequest.productSoftwareTypeOther}` : govRequest.productSoftwareType} />
                <InfoField label={t('domainReview.thirdPartyVendor')} value={govRequest.thirdPartyVendor} />
                <div>
                  <label className="text-xs text-text-secondary">{t('domainReview.productEndUser')}</label>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {govRequest.productEndUser?.length ? govRequest.productEndUser.map((u) => (
                      <span key={u} className="text-xs bg-gray-100 px-2 py-0.5 rounded">{u}</span>
                    )) : <span className="text-sm">-</span>}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-secondary">{t('domainReview.userRegion')}</label>
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
          <SectionCard title={t('domainReview.domainQuestionnaire')} subtitle={`${t('domainReview.answersSubmittedBy')}${review.domainName || review.domainCode}`} defaultOpen>
            <DomainQuestionnaires requestId={requestId} readOnly changelog={changelog} />
          </SectionCard>

          {/* Reviewer Questionnaire */}
          {review && review.status === 'Accept' && (
            <SectionCard title={t('domainReview.reviewerQuestionnaire')} subtitle={t('domainReview.reviewerQSubtitle')} defaultOpen>
              <ReviewerQuestionnaires ref={reviewerQRef} domainReviewId={review.id} />
            </SectionCard>
          )}
          {review && ['Approved', 'Approved with Exception', 'Not Passed'].includes(review.status) && (
            <SectionCard title={t('domainReview.reviewerQuestionnaire')} subtitle={t('domainReview.reviewerQSubtitle')} defaultOpen>
              <ReviewerQuestionnaires domainReviewId={review.id} readOnly />
            </SectionCard>
          )}

          {/* AI Analysis — between Questionnaire and Activity Log */}
          {review && (
            <AIAnalysisSection domainReviewId={review.id} />
          )}

          {/* Activity Log */}
          {activityLog.length > 0 && (
            <SectionCard title={t('domainReview.activityLog')} subtitle={`${activityLog.length} ${t('domainReview.eventsRecorded')}`} defaultOpen={false}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-light text-left text-text-secondary">
                      <th className="pb-2 pr-4 font-medium">{t('domainReview.actionCol')}</th>
                      <th className="pb-2 pr-4 font-medium">{t('domainReview.userCol')}</th>
                      <th className="pb-2 pr-4 font-medium">{t('domainReview.timeCol')}</th>
                      <th className="pb-2 font-medium">{t('domainReview.detailsCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityLog.map((entry) => (
                      <tr key={entry.id} className="border-b border-border-light last:border-0">
                        <td className="py-2 pr-4 whitespace-nowrap">
                          <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                            {entry.action}
                          </span>
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap">{entry.performerName || entry.performedBy || '-'}</td>
                        <td className="py-2 pr-4 whitespace-nowrap text-text-secondary">
                          {entry.performedAt ? new Date(entry.performedAt).toLocaleString() : '-'}
                        </td>
                        <td className="py-2 text-text-secondary max-w-xs truncate">
                          {entry.details || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </div>

        {/* Action Items Section — visible when review is Accepted or actions exist */}
        {review && (
          <ActionItemsSection
            domainReviewId={review.id}
            requestId={requestId}
            reviewStatus={review.status}
            requestorItcode={govRequest?.requestor}
            requestorName={govRequest?.requestorName}
          />
        )}

        {/* Review Action Buttons — Accept status: terminal actions */}
        {review.status === 'Accept' && (
          <div className="bg-white rounded-lg border border-border-light p-6 mt-4">
            <h2 className="text-base font-semibold mb-3">{t('domainReview.reviewDecision')}</h2>
            <p className="text-sm text-text-secondary mb-4">{t('domainReview.selectOutcome')}</p>
            <div className="flex gap-2">
              <Button
                type="primary"
                style={{ background: '#52c41a', borderColor: '#52c41a' }}
                onClick={async () => {
                  if (reviewerQRef.current) {
                    await reviewerQRef.current.flushPendingSaves();
                    const incomplete = reviewerQRef.current.getIncompleteCount();
                    if (incomplete > 0) {
                      toast(t('domainReview.answerRequiredQuestions'), 'error');
                      return;
                    }
                  }
                  approveMutation.mutate();
                }}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? t('domainReview.approving') : t('domainReview.approve')}
              </Button>
              <Button
                style={{ background: '#f59e0b', borderColor: '#f59e0b', color: '#fff' }}
                onClick={async () => {
                  if (reviewerQRef.current) {
                    await reviewerQRef.current.flushPendingSaves();
                    const incomplete = reviewerQRef.current.getIncompleteCount();
                    if (incomplete > 0) {
                      toast(t('domainReview.answerRequiredQuestions'), 'error');
                      return;
                    }
                  }
                  setShowExceptionDialog(true);
                }}
              >
                {t('domainReview.approveWithException')}
              </Button>
              <Button
                danger
                type="primary"
                onClick={async () => {
                  if (reviewerQRef.current) {
                    await reviewerQRef.current.flushPendingSaves();
                    const incomplete = reviewerQRef.current.getIncompleteCount();
                    if (incomplete > 0) {
                      toast(t('domainReview.answerRequiredQuestions'), 'error');
                      return;
                    }
                  }
                  setShowNotPassDialog(true);
                }}
              >
                {t('domainReview.notPass')}
              </Button>
            </div>
          </div>
        )}

        {/* Return for Additional Information banner */}
        {review.status === 'Return for Additional Information' && review.returnReason && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-4">
            <h3 className="text-sm font-semibold text-amber-800 mb-1">{t('domainReview.returnedForInfo')}</h3>
            <p className="text-sm text-amber-700">{review.returnReason}</p>
          </div>
        )}

        {/* Approve with Exception Dialog */}
        {showExceptionDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold mb-2">{t('domainReview.approveWithException')}</h3>
              <p className="text-sm text-text-secondary mb-4">
                {t('domainReview.exceptionNotes')}
              </p>
              <textarea
                className="input-field w-full h-28 resize-none"
                placeholder={t('domainReview.exceptionPlaceholder')}
                value={exceptionNotes}
                onChange={(e) => setExceptionNotes(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-4">
                <Button type="default" onClick={() => { setShowExceptionDialog(false); setExceptionNotes(''); }}>
                  {t('common.cancel')}
                </Button>
                <Button
                  style={{ background: '#f59e0b', borderColor: '#f59e0b', color: '#fff' }}
                  onClick={() => approveWithExceptionMutation.mutate(exceptionNotes)}
                  disabled={!exceptionNotes.trim() || approveWithExceptionMutation.isPending}
                >
                  {approveWithExceptionMutation.isPending ? t('domainReview.submitting') : t('common.confirm')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Not Pass Dialog */}
        {showNotPassDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold mb-2">{t('domainReview.notPass')}</h3>
              <p className="text-sm text-text-secondary mb-4">
                {t('domainReview.notPassReason')}
              </p>
              <textarea
                className="input-field w-full h-28 resize-none"
                placeholder={t('domainReview.notPassPlaceholder')}
                value={notPassNotes}
                onChange={(e) => setNotPassNotes(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-4">
                <Button type="default" onClick={() => { setShowNotPassDialog(false); setNotPassNotes(''); }}>
                  {t('common.cancel')}
                </Button>
                <Button
                  danger
                  type="primary"
                  onClick={() => notPassMutation.mutate(notPassNotes)}
                  disabled={notPassMutation.isPending}
                >
                  {notPassMutation.isPending ? t('domainReview.submitting') : t('domainReview.confirmNotPass')}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-between mt-6 pb-8">
          <Button type="default" onClick={() => router.push('/reviews')}>
            {t('reviewDetail.backToReviews')}
          </Button>
        </div>
      </div>
      {/* Ask EGM floating AI assistant */}
      {review && (
        <AskEgmFloating
          domainReviewId={review.id}
          domainName={review.domainName || review.domainCode}
        />
      )}
    </PageLayout>
  );
}

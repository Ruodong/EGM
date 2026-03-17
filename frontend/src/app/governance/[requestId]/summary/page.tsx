'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { PageLayout } from '@/components/layout/PageLayout';
import { statusColors } from '@/lib/constants';
import { Button } from 'antd';
import { useLocale } from '@/lib/locale-context';
import clsx from 'clsx';

interface GovRequest {
  id: string;
  requestId: string;
  title: string;
  description: string;
  status: string;
  requestor: string;
  requestorName: string;
  projectName: string;
  createAt: string;
}

interface DomainReview {
  id: string;
  domainCode: string;
  domainName: string;
  status: string;
  outcome: string | null;
  reviewer: string | null;
  reviewerName: string | null;
  completedAt: string | null;
}

interface ProgressData {
  totalDomains: number;
  completedDomains: number;
  progressPercent: number;
  openInfoRequests: number;
}

export default function SummaryPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params.requestId as string;
  const { t } = useLocale();

  const { data: request } = useQuery<GovRequest>({
    queryKey: ['governance-request', requestId],
    queryFn: () => api.get(`/governance-requests/${requestId}`),
  });

  const { data: reviews } = useQuery<{ data: DomainReview[] }>({
    queryKey: ['domain-reviews', requestId],
    queryFn: () => api.get('/domain-reviews', { request_id: requestId }),
  });

  const { data: progress } = useQuery<ProgressData>({
    queryKey: ['progress', requestId],
    queryFn: () => api.get(`/progress/${requestId}`),
  });

  if (!request) {
    return <PageLayout><p className="text-text-secondary">{t('common.loading')}</p></PageLayout>;
  }

  const allComplete = progress && progress.completedDomains === progress.totalDomains && progress.totalDomains > 0;

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-bold mb-6">{t('summary.title')}</h1>

        {/* Overall status */}
        <div className="bg-white rounded-lg border border-border-light p-6 mb-4">
          <h2 className="text-base font-semibold mb-3">{t('summary.request')}{request.requestId}</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex"><dt className="w-36 text-text-secondary">{t('summary.title2')}</dt><dd>{request.title}</dd></div>
            <div className="flex"><dt className="w-36 text-text-secondary">{t('common.status')}</dt><dd>
              <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[request.status] || 'bg-gray-400')}>
                {request.status}
              </span>
            </dd></div>
            <div className="flex"><dt className="w-36 text-text-secondary">{t('col.requestor')}</dt><dd>{request.requestorName || request.requestor}</dd></div>
          </dl>
        </div>

        {/* Progress */}
        {progress && (
          <div className="bg-white rounded-lg border border-border-light p-6 mb-4">
            <h2 className="text-base font-semibold mb-3">{t('summary.reviewProgress')}</h2>
            <div className="flex justify-between text-sm mb-2">
              <span>{progress.completedDomains}/{progress.totalDomains} {t('summary.domainsComplete')}</span>
              <span>{progress.progressPercent}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
              <div
                className={clsx('h-2 rounded-full transition-all', allComplete ? 'bg-green-500' : 'bg-egm-teal')}
                style={{ width: `${progress.progressPercent}%` }}
              />
            </div>
            {progress.openInfoRequests > 0 && (
              <p className="text-sm text-status-info-requested">{progress.openInfoRequests} {t('reviewDetail.openInfoRequestsShort')}</p>
            )}
          </div>
        )}

        {/* Domain outcomes */}
        <div className="bg-white rounded-lg border border-border-light p-6 mb-4">
          <h2 className="text-base font-semibold mb-3">{t('summary.domainReviewOutcomes')}</h2>
          {reviews?.data && reviews.data.length > 0 ? (
            <div className="space-y-3">
              {reviews.data.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm p-3 bg-bg-gray rounded">
                  <div>
                    <span className="font-medium">{r.domainName || r.domainCode}</span>
                    {r.reviewerName && <span className="text-text-secondary ml-2">({r.reviewerName})</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[r.status] || 'bg-gray-400')}>
                      {r.status}
                    </span>
                    {r.outcome && (
                      <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[r.outcome] || 'bg-gray-400')}>
                        {r.outcome}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">{t('summary.noReviewsDispatched')}</p>
          )}
        </div>

        <div className="flex justify-between mt-6">
          <Button type="default" onClick={() => router.push(`/governance/${requestId}/reviews`)}>
            {t('reviewDetail.backToReviews')}
          </Button>
          <Button type="default" onClick={() => router.push(`/governance/${requestId}`)}>
            {t('summary.backToOverview')}
          </Button>
        </div>
      </div>
    </PageLayout>
  );
}

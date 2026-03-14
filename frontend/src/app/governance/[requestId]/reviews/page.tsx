'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { statusColors } from '@/lib/constants';
import Link from 'next/link';
import { Button } from 'antd';
import clsx from 'clsx';

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
  externalRefId: string | null;
}

interface InfoRequest {
  id: string;
  domainCode: string;
  category: string;
  description: string;
  status: string;
  priority: string;
  requester: string;
  createAt: string;
}

export default function ReviewsPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const requestId = params.requestId as string;

  const { data: reviews, isLoading } = useQuery<{ data: DomainReview[] }>({
    queryKey: ['domain-reviews', requestId],
    queryFn: () => api.get('/domain-reviews', { request_id: requestId }),
  });

  const { data: infoRequests } = useQuery<{ data: InfoRequest[] }>({
    queryKey: ['info-requests', requestId],
    queryFn: () => api.get('/info-requests', { request_id: requestId }),
  });

  const dispatchMutation = useMutation({
    mutationFn: () => api.post(`/dispatch/execute/${requestId}`, {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['domain-reviews', requestId] });
      toast(`Dispatched to ${data.created?.length || 0} domain(s)`, 'success');
    },
    onError: () => toast('Dispatch failed', 'error'),
  });

  const openInfoRequests = infoRequests?.data?.filter((ir) => ir.status === 'Open' || ir.status === 'Acknowledged') || [];

  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Domain Reviews</h1>
            <p className="text-sm text-text-secondary mt-1">
              Track the status of all domain reviews for this governance request.
            </p>
          </div>
          {(!reviews?.data || reviews.data.length === 0) && (
            <Button
              type="primary"
              style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
              disabled={dispatchMutation.isPending}
              onClick={() => dispatchMutation.mutate()}
            >
              {dispatchMutation.isPending ? 'Dispatching...' : 'Dispatch Reviews'}
            </Button>
          )}
        </div>

        {openInfoRequests.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-semibold text-amber-800 mb-2">
              {openInfoRequests.length} Open Information Request(s)
            </h3>
            <div className="space-y-2">
              {openInfoRequests.map((ir) => (
                <div key={ir.id} className="flex justify-between items-center text-sm">
                  <div>
                    <span className="font-medium">{ir.category}</span>
                    <span className="text-text-secondary ml-2">— {ir.description}</span>
                  </div>
                  <span className={clsx('px-2 py-0.5 rounded text-xs text-white', ir.priority === 'Urgent' ? 'bg-red-500' : 'bg-amber-500')}>
                    {ir.priority}
                  </span>
                </div>
              ))}
            </div>
            <button
              className="mt-3 text-sm text-primary-blue hover:underline"
              onClick={() => router.push(`/governance/${requestId}/common-questionnaire`)}
            >
              Update Common Questionnaire
            </button>
          </div>
        )}

        {isLoading ? (
          <p className="text-text-secondary">Loading reviews...</p>
        ) : !reviews?.data || reviews.data.length === 0 ? (
          <div className="bg-white rounded-lg border border-border-light p-8 text-center">
            <p className="text-text-secondary">No domain reviews have been created yet.</p>
            <p className="text-sm text-text-secondary mt-1">Complete scoping and dispatch to create domain reviews.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {reviews.data.map((review) => (
              <div key={review.id} className="bg-white rounded-lg border border-border-light p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-egm-teal/10 flex items-center justify-center">
                      <span className="text-sm font-bold text-egm-teal">{review.domainCode}</span>
                    </div>
                    <div>
                      <h3 className="font-medium">{review.domainName || review.domainCode}</h3>
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
                  </div>
                  <div className="flex items-center gap-3">
                    {review.reviewer && (
                      <span className="text-sm text-text-secondary">Reviewer: {review.reviewerName || review.reviewer}</span>
                    )}
                    <Link href={`/governance/${requestId}/reviews/${review.domainCode}`}>
                      <Button type="default" size="small">View Details</Button>
                    </Link>
                  </div>
                </div>
                {review.externalRefId && (
                  <p className="text-xs text-text-secondary mt-2">External Ref: {review.externalRefId}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-between mt-8">
          <Button type="default" onClick={() => router.push(`/governance/${requestId}/common-questionnaire`)}>
            Back to Questionnaire
          </Button>
          <Button type="primary" style={{ background: '#13C2C2', borderColor: '#13C2C2' }} onClick={() => router.push(`/governance/${requestId}/summary`)}>
            View Summary
          </Button>
        </div>
      </div>
    </PageLayout>
  );
}

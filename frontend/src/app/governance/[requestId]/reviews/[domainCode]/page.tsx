'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { statusColors } from '@/lib/constants';
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

  // Get all reviews for this request, then find the one for this domain
  const { data: reviews } = useQuery<{ data: DomainReview[] }>({
    queryKey: ['domain-reviews', requestId],
    queryFn: () => api.get('/domain-reviews', { request_id: requestId }),
  });

  const review = reviews?.data?.find((r) => r.domainCode === domainCode);

  const { data: infoRequests } = useQuery<{ data: InfoRequest[] }>({
    queryKey: ['info-requests', requestId, domainCode, review?.id],
    queryFn: () => api.get('/info-requests', { request_id: requestId, domainReviewId: review!.id }),
    enabled: !!review,
  });

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

  if (!review) {
    return (
      <PageLayout>
        <div className="max-w-3xl mx-auto">
          <p className="text-text-secondary">Loading review for {domainCode}...</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">{review.domainName || review.domainCode} Review</h1>
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

        {review.commonDataUpdatedAt && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-blue-800">
              Common questionnaire data was updated on {new Date(review.commonDataUpdatedAt).toLocaleString()}.
              Review the changes before continuing.
            </p>
          </div>
        )}

        {/* Review details */}
        <div className="bg-white rounded-lg border border-border-light p-6 mb-4">
          <h2 className="text-base font-semibold mb-3">Review Details</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex"><dt className="w-32 text-text-secondary">Domain</dt><dd>{review.domainCode}</dd></div>
            <div className="flex"><dt className="w-32 text-text-secondary">Reviewer</dt><dd>{review.reviewerName || review.reviewer || 'Unassigned'}</dd></div>
            <div className="flex"><dt className="w-32 text-text-secondary">Started</dt><dd>{review.startedAt ? new Date(review.startedAt).toLocaleString() : '-'}</dd></div>
            <div className="flex"><dt className="w-32 text-text-secondary">Completed</dt><dd>{review.completedAt ? new Date(review.completedAt).toLocaleString() : '-'}</dd></div>
          </dl>

          {/* Action buttons based on status */}
          <div className="flex gap-2 mt-4 pt-4 border-t border-border-light">
            {review.status === 'Pending' && (
              <button className="btn-teal text-sm" onClick={() => assignMutation.mutate()}>
                Assign to Me
              </button>
            )}
            {review.status === 'Assigned' && (
              <button className="btn-teal text-sm" onClick={() => startMutation.mutate()}>
                Start Review
              </button>
            )}
            {review.status === 'In Progress' && (
              <>
                <button className="btn-teal text-sm" onClick={() => completeMutation.mutate('Approved')}>
                  Approve
                </button>
                <button className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded text-sm" onClick={() => completeMutation.mutate('Approved with Conditions')}>
                  Approve with Conditions
                </button>
                <button className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded text-sm" onClick={() => completeMutation.mutate('Rejected')}>
                  Reject
                </button>
              </>
            )}
          </div>
        </div>

        {/* Info Supplement Requests */}
        <div className="bg-white rounded-lg border border-border-light p-6 mb-4">
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
                <button className="btn-teal text-sm" onClick={() => createInfoRequest.mutate()} disabled={!infoCategory || !infoDescription}>
                  Submit Request
                </button>
                <button className="btn-default text-sm" onClick={() => setShowInfoForm(false)}>Cancel</button>
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

        <div className="flex justify-between mt-6">
          <button className="btn-default" onClick={() => router.push(`/governance/${requestId}/reviews`)}>
            Back to Reviews
          </button>
        </div>
      </div>
    </PageLayout>
  );
}

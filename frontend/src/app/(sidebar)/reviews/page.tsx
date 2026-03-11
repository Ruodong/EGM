'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { statusColors } from '@/lib/constants';
import Link from 'next/link';
import { useState } from 'react';
import clsx from 'clsx';

interface DomainReview {
  id: string;
  requestId: string;
  govRequestId: string;
  domainCode: string;
  domainName: string;
  status: string;
  outcome: string | null;
  reviewer: string | null;
  reviewerName: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export default function AllReviewsPage() {
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery<{ data: DomainReview[] }>({
    queryKey: ['all-domain-reviews', statusFilter],
    queryFn: () => api.get('/domain-reviews', { pageSize: 500, ...(statusFilter ? { status: statusFilter } : {}) }),
  });

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">All Domain Reviews</h1>

      <div className="mb-4 flex gap-2">
        {['', 'Pending', 'Assigned', 'In Progress', 'Review Complete', 'Waived'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={clsx(
              'px-3 py-1 rounded text-sm border',
              statusFilter === s ? 'bg-primary-blue text-white border-primary-blue' : 'border-border-light hover:border-primary-blue'
            )}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-border-light">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-light bg-bg-gray">
              <th className="text-left p-3 font-medium">Request</th>
              <th className="text-left p-3 font-medium">Domain</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-left p-3 font-medium">Outcome</th>
              <th className="text-left p-3 font-medium">Reviewer</th>
              <th className="text-left p-3 font-medium">Started</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="p-4 text-center text-text-secondary">Loading...</td></tr>
            ) : !data?.data || data.data.length === 0 ? (
              <tr><td colSpan={6} className="p-4 text-center text-text-secondary">No reviews found</td></tr>
            ) : (
              data.data.map((r) => (
                <tr key={r.id} className="border-b border-border-light hover:bg-gray-50">
                  <td className="p-3">
                    <Link href={`/governance/${r.govRequestId || r.requestId}/reviews/${r.domainCode}`} className="text-primary-blue hover:underline">
                      {r.requestId}
                    </Link>
                  </td>
                  <td className="p-3 font-medium">{r.domainName || r.domainCode}</td>
                  <td className="p-3">
                    <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[r.status] || 'bg-gray-400')}>
                      {r.status}
                    </span>
                  </td>
                  <td className="p-3">{r.outcome || '-'}</td>
                  <td className="p-3">{r.reviewerName || r.reviewer || '-'}</td>
                  <td className="p-3 text-text-secondary">{r.startedAt ? new Date(r.startedAt).toLocaleDateString() : '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

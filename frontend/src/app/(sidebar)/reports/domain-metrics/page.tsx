'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import clsx from 'clsx';
import { Tag, Typography } from 'antd';

const { Title } = Typography;

interface DomainReview {
  id: string;
  domainCode: string;
  domainName?: string;
  status: string;
  outcome?: string;
  reviewer?: string;
  reviewerName?: string;
  startedAt?: string;
  completedAt?: string;
  createAt?: string;
}

export default function DomainMetricsPage() {
  const { data, isLoading } = useQuery<{ data: DomainReview[]; total: number }>({
    queryKey: ['all-reviews-metrics'],
    queryFn: () => api.get('/domain-reviews', { pageSize: 500 }),
  });

  const reviews = data?.data || [];

  // Group by domain
  const domainMap = new Map<string, DomainReview[]>();
  reviews.forEach((r) => {
    const list = domainMap.get(r.domainCode) || [];
    list.push(r);
    domainMap.set(r.domainCode, list);
  });

  const domainStats = Array.from(domainMap.entries()).map(([code, items]) => {
    const completed = items.filter((r) => r.status === 'Review Complete');
    const approved = completed.filter((r) => r.outcome === 'Approved' || r.outcome === 'Approved with Conditions');
    const rejected = completed.filter((r) => r.outcome === 'Rejected');
    const inProgress = items.filter((r) => r.status === 'In Progress');
    const pending = items.filter((r) => r.status === 'Pending' || r.status === 'Assigned');

    return {
      domainCode: code,
      domainName: items[0]?.domainName || code,
      total: items.length,
      completed: completed.length,
      approved: approved.length,
      rejected: rejected.length,
      inProgress: inProgress.length,
      pending: pending.length,
      completionRate: items.length > 0 ? Math.round((completed.length / items.length) * 100) : 0,
    };
  });

  return (
    <div>
      <Title level={4} style={{ margin: 0, marginBottom: 24 }}>Domain Metrics</Title>

      {isLoading ? (
        <p className="text-text-secondary">Loading metrics...</p>
      ) : domainStats.length === 0 ? (
        <div className="bg-white rounded-lg border border-border-light p-8 text-center text-text-secondary">
          No domain review data available yet.
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-border-light p-5">
              <p className="text-3xl font-bold text-egm-teal">{reviews.length}</p>
              <p className="text-sm text-text-secondary mt-1">Total Reviews</p>
            </div>
            <div className="bg-white rounded-lg border border-border-light p-5">
              <p className="text-3xl font-bold text-status-in-progress">
                {reviews.filter((r) => r.status === 'In Progress').length}
              </p>
              <p className="text-sm text-text-secondary mt-1">In Progress</p>
            </div>
            <div className="bg-white rounded-lg border border-border-light p-5">
              <p className="text-3xl font-bold text-status-completed">
                {reviews.filter((r) => r.status === 'Review Complete').length}
              </p>
              <p className="text-sm text-text-secondary mt-1">Completed</p>
            </div>
            <div className="bg-white rounded-lg border border-border-light p-5">
              <p className="text-3xl font-bold text-primary-blue">{domainStats.length}</p>
              <p className="text-sm text-text-secondary mt-1">Active Domains</p>
            </div>
          </div>

          {/* Per-domain breakdown */}
          <div className="bg-white rounded-lg border border-border-light overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-gray border-b border-border-light">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Domain</th>
                  <th className="text-center px-4 py-3 font-medium">Total</th>
                  <th className="text-center px-4 py-3 font-medium">Pending</th>
                  <th className="text-center px-4 py-3 font-medium">In Progress</th>
                  <th className="text-center px-4 py-3 font-medium">Completed</th>
                  <th className="text-center px-4 py-3 font-medium">Approved</th>
                  <th className="text-center px-4 py-3 font-medium">Rejected</th>
                  <th className="text-center px-4 py-3 font-medium">Completion %</th>
                </tr>
              </thead>
              <tbody>
                {domainStats.map((d) => (
                  <tr key={d.domainCode} className="border-b border-border-light last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Tag color="purple">{d.domainCode}</Tag>
                        <span>{d.domainName}</span>
                      </div>
                    </td>
                    <td className="text-center px-4 py-3 font-medium">{d.total}</td>
                    <td className="text-center px-4 py-3">{d.pending}</td>
                    <td className="text-center px-4 py-3">{d.inProgress}</td>
                    <td className="text-center px-4 py-3">{d.completed}</td>
                    <td className="text-center px-4 py-3 text-green-600">{d.approved}</td>
                    <td className="text-center px-4 py-3 text-red-500">{d.rejected}</td>
                    <td className="text-center px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-16 bg-gray-100 rounded-full h-2">
                          <div
                            className={clsx('h-2 rounded-full', d.completionRate >= 80 ? 'bg-green-500' : d.completionRate >= 40 ? 'bg-amber-500' : 'bg-gray-300')}
                            style={{ width: `${d.completionRate}%` }}
                          />
                        </div>
                        <span className="text-xs">{d.completionRate}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

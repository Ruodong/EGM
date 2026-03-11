'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface StatusCount {
  status: string;
  count: number;
}

interface VerdictCount {
  verdict: string;
  count: number;
}

interface ReviewCount {
  domainCode: string;
  status: string;
  count: number;
}

interface DashboardStats {
  totalRequests: number;
  byStatus: StatusCount[];
  byVerdict: VerdictCount[];
  reviewCounts: ReviewCount[];
}

function getStatusCount(stats: DashboardStats | undefined, status: string): number {
  return stats?.byStatus?.find((s) => s.status === status)?.count ?? 0;
}

export default function GovernanceDashboardPage() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get('/dashboard/stats'),
  });

  if (isLoading) return <p className="text-text-secondary">Loading dashboard...</p>;

  // Aggregate review counts by domain
  const domainTotals: Record<string, number> = {};
  for (const rc of stats?.reviewCounts ?? []) {
    domainTotals[rc.domainCode] = (domainTotals[rc.domainCode] ?? 0) + rc.count;
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Governance Dashboard</h1>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-border-light p-5">
          <p className="text-3xl font-bold text-egm-teal">{stats?.totalRequests ?? 0}</p>
          <p className="text-sm text-text-secondary mt-1">Total Requests</p>
        </div>
        <div className="bg-white rounded-lg border border-border-light p-5">
          <p className="text-3xl font-bold text-status-in-progress">{getStatusCount(stats, 'In Review')}</p>
          <p className="text-sm text-text-secondary mt-1">In Review</p>
        </div>
        <div className="bg-white rounded-lg border border-border-light p-5">
          <p className="text-3xl font-bold text-status-completed">{getStatusCount(stats, 'Completed')}</p>
          <p className="text-sm text-text-secondary mt-1">Completed</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* By Status */}
        <div className="bg-white rounded-lg border border-border-light p-5">
          <h2 className="text-base font-semibold mb-3">By Status</h2>
          <div className="space-y-2">
            {stats?.byStatus?.map((item) => (
              <div key={item.status} className="flex justify-between text-sm">
                <span>{item.status}</span>
                <span className="font-medium">{item.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* By Verdict */}
        <div className="bg-white rounded-lg border border-border-light p-5">
          <h2 className="text-base font-semibold mb-3">By Verdict</h2>
          <div className="space-y-2">
            {stats?.byVerdict?.length ? stats.byVerdict.map((item) => (
              <div key={item.verdict} className="flex justify-between text-sm">
                <span>{item.verdict}</span>
                <span className="font-medium">{item.count}</span>
              </div>
            )) : (
              <p className="text-sm text-text-secondary">No verdicts recorded yet</p>
            )}
          </div>
        </div>

        {/* By Domain */}
        <div className="bg-white rounded-lg border border-border-light p-5 col-span-2">
          <h2 className="text-base font-semibold mb-3">Reviews by Domain</h2>
          <div className="space-y-2">
            {Object.entries(domainTotals).map(([domain, count]) => (
              <div key={domain} className="flex items-center gap-3 text-sm">
                <span className="w-24 font-medium truncate">{domain}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-4">
                  <div
                    className="bg-egm-teal h-4 rounded-full"
                    style={{ width: `${Math.min(100, (count / (stats?.totalRequests || 1)) * 100)}%` }}
                  />
                </div>
                <span className="w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

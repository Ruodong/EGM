'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Tag, Typography, Spin } from 'antd';

const { Title, Text } = Typography;

interface GovRequest {
  id: string;
  requestId: string;
  title: string;
  status: string;
  priority: string;
  createAt: string;
  completedAt?: string;
}

function daysBetween(start: string, end?: string): number {
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
}

export default function LeadTimePage() {
  const { data, isLoading } = useQuery<{ data: GovRequest[]; total: number }>({
    queryKey: ['requests-lead-time'],
    queryFn: () => api.get('/governance-requests', { pageSize: 500 }),
  });

  const requests = data?.data || [];

  const completedRequests = requests.filter((r) => r.completedAt);
  const activeRequests = requests.filter((r) => !r.completedAt && r.status !== 'Draft');

  const avgLeadTime = completedRequests.length > 0
    ? Math.round(completedRequests.reduce((sum, r) => sum + daysBetween(r.createAt, r.completedAt), 0) / completedRequests.length)
    : 0;

  const avgAge = activeRequests.length > 0
    ? Math.round(activeRequests.reduce((sum, r) => sum + daysBetween(r.createAt), 0) / activeRequests.length)
    : 0;

  return (
    <div>
      <Title level={4} style={{ margin: 0, marginBottom: 24 }}>Lead Time Analysis</Title>

      {isLoading ? (
        <div className="text-center py-4"><Spin /></div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-border-light p-5">
              <p className="text-3xl font-bold text-egm-teal">{requests.length}</p>
              <p className="text-sm text-text-secondary mt-1">Total Requests</p>
            </div>
            <div className="bg-white rounded-lg border border-border-light p-5">
              <p className="text-3xl font-bold text-status-completed">{completedRequests.length}</p>
              <p className="text-sm text-text-secondary mt-1">Completed</p>
            </div>
            <div className="bg-white rounded-lg border border-border-light p-5">
              <p className="text-3xl font-bold text-primary-blue">{avgLeadTime}</p>
              <p className="text-sm text-text-secondary mt-1">Avg Lead Time (days)</p>
            </div>
            <div className="bg-white rounded-lg border border-border-light p-5">
              <p className="text-3xl font-bold text-status-in-progress">{avgAge}</p>
              <p className="text-sm text-text-secondary mt-1">Avg Active Age (days)</p>
            </div>
          </div>

          {/* Request table with lead time */}
          <div className="bg-white rounded-lg border border-border-light overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-gray border-b border-border-light">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Request ID</th>
                  <th className="text-left px-4 py-3 font-medium">Title</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Priority</th>
                  <th className="text-left px-4 py-3 font-medium">Created</th>
                  <th className="text-left px-4 py-3 font-medium">Completed</th>
                  <th className="text-center px-4 py-3 font-medium">Days</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const days = daysBetween(r.createAt, r.completedAt);
                  return (
                    <tr key={r.id} className="border-b border-border-light last:border-0">
                      <td className="px-4 py-3 text-xs">{r.requestId}</td>
                      <td className="px-4 py-3">{r.title}</td>
                      <td className="px-4 py-3">
                        <Tag color="blue">{r.status}</Tag>
                      </td>
                      <td className="px-4 py-3">{r.priority}</td>
                      <td className="px-4 py-3 text-text-secondary">{new Date(r.createAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-text-secondary">
                        {r.completedAt ? new Date(r.completedAt).toLocaleDateString() : '-'}
                      </td>
                      <td className="text-center px-4 py-3">
                        <span className={`font-medium ${days > 30 ? 'text-red-500' : days > 14 ? 'text-amber-500' : 'text-green-600'}`}>
                          {days}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {requests.length === 0 && (
            <div className="bg-white rounded-lg border border-border-light p-8 text-center mt-4">
              <Text type="secondary">No requests available for lead time analysis.</Text>
            </div>
          )}
        </>
      )}
    </div>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PageLayout } from '@/components/layout/PageLayout';
import { FileProtectOutlined, AuditOutlined, CheckCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import Link from 'next/link';

interface HomeStats {
  totalRequests: number;
  inReview: number;
  completed: number;
}

function StatsCard({ label, value, icon, color }: { label: string; value: React.ReactNode; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white rounded-lg border border-border-light p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${color}`} style={{ fontSize: 24, color: '#fff' }}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-text-primary">{value}</p>
        <p className="text-sm text-text-secondary">{label}</p>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const { data: stats } = useQuery<HomeStats>({
    queryKey: ['home-stats'],
    queryFn: () => api.get('/dashboard/home-stats'),
    enabled: !authLoading,
  });

  return (
    <PageLayout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Enterprise Governance Portal</h1>
            <p className="text-text-secondary mt-1">AI Governance Management Dashboard</p>
          </div>
          <Link href="/governance/create">
            <Button type="primary" style={{ background: '#13C2C2', borderColor: '#13C2C2' }} icon={<PlusOutlined />}>
              New Governance Request
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatsCard label="Total Requests" value={stats?.totalRequests ?? 0} icon={<FileProtectOutlined />} color="bg-primary-blue" />
          <StatsCard label="In Progress" value={stats?.inReview ?? 0} icon={<AuditOutlined />} color="bg-status-in-progress" />
          <StatsCard label="Completed" value={stats?.completed ?? 0} icon={<CheckCircleOutlined />} color="bg-status-completed" />
        </div>

        <div className="bg-white rounded-lg border border-border-light p-6">
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="grid grid-cols-3 gap-4">
            <Link href="/governance/create" className="p-4 border border-border-light rounded-lg hover:border-primary-blue transition-colors">
              <h3 className="font-medium">Create New Request</h3>
              <p className="text-sm text-text-secondary mt-1">Submit a new AI governance review request</p>
            </Link>
            <Link href="/requests" className="p-4 border border-border-light rounded-lg hover:border-primary-blue transition-colors">
              <h3 className="font-medium">View All Requests</h3>
              <p className="text-sm text-text-secondary mt-1">Browse and manage governance requests</p>
            </Link>
            <Link href="/reports/governance-dashboard" className="p-4 border border-border-light rounded-lg hover:border-primary-blue transition-colors">
              <h3 className="font-medium">Governance Dashboard</h3>
              <p className="text-sm text-text-secondary mt-1">View governance metrics and KPIs</p>
            </Link>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

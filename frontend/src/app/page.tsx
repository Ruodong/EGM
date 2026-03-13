'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PageLayout } from '@/components/layout/PageLayout';
import { FileCheck, ClipboardCheck, AlertCircle, CheckCircle, Plus } from 'lucide-react';
import Link from 'next/link';

interface HomeStats {
  totalRequests: number;
  inReview: number;
  completed: number;
  openInfoRequests: number;
}

function StatsCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  return (
    <div className="bg-white rounded-lg border border-border-light p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-6 h-6 text-white" />
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
          <Link href="/governance/create" className="btn-teal flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Governance Request
          </Link>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-8">
          <StatsCard label="Total Requests" value={stats?.totalRequests ?? 0} icon={FileCheck} color="bg-primary-blue" />
          <StatsCard label="In Progress" value={stats?.inReview ?? 0} icon={ClipboardCheck} color="bg-status-in-progress" />
          <StatsCard label="Completed" value={stats?.completed ?? 0} icon={CheckCircle} color="bg-status-completed" />
          <StatsCard label="Open Info Requests" value={stats?.openInfoRequests ?? 0} icon={AlertCircle} color="bg-status-info-requested" />
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

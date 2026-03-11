import {
  Home,
  FileCheck,
  ClipboardCheck,
  ListTodo,
  Puzzle,
  BarChart3,
  Settings,
  HelpCircle,
  Shield,
  Users,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: any;
  children?: NavItem[];
  requiredResource?: string;
  requiredScope?: string;
}

export const sidebarNavItems: NavItem[] = [
  { label: 'Home', href: '/', icon: Home },
  { label: 'Governance Requests', href: '/requests', icon: FileCheck },
  {
    label: 'Reviews',
    href: '/reviews',
    icon: ClipboardCheck,
    children: [
      { label: 'All Reviews', href: '/reviews', icon: ClipboardCheck },
      { label: 'Review Actions', href: '/actions', icon: ListTodo },
    ],
  },
  {
    label: 'Domains',
    href: '/domains',
    icon: Puzzle,
    requiredResource: 'domain_registry',
    requiredScope: 'read',
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: BarChart3,
    children: [
      { label: 'Governance Dashboard', href: '/reports/governance-dashboard', icon: BarChart3 },
      { label: 'Domain Metrics', href: '/reports/domain-metrics', icon: BarChart3 },
      { label: 'Lead Time', href: '/reports/lead-time', icon: BarChart3 },
    ],
  },
  {
    label: 'Settings',
    href: '/settings',
    icon: Settings,
    requiredResource: 'intake_template',
    requiredScope: 'write',
    children: [
      { label: 'Scoping Templates', href: '/settings/scoping-templates', icon: Settings },
      { label: 'Questionnaire Templates', href: '/settings/questionnaire-templates', icon: Settings },
      { label: 'Dispatch Rules', href: '/settings/dispatch-rules', icon: Settings },
      { label: 'Domain Management', href: '/settings/domains', icon: Puzzle },
      { label: 'User Authorization', href: '/settings/user-authorization', icon: Users },
      { label: 'Audit Log', href: '/settings/audit-log', icon: Shield },
    ],
  },
  { label: 'Help', href: '/help', icon: HelpCircle },
];

export const statusColors: Record<string, string> = {
  Draft: 'bg-status-draft',
  Submitted: 'bg-status-in-review',
  Scoping: 'bg-primary-blue',
  'In Review': 'bg-status-in-progress',
  'Info Requested': 'bg-status-info-requested',
  Completed: 'bg-status-completed',
  Cancelled: 'bg-status-draft',
  Pending: 'bg-status-pending',
  Assigned: 'bg-primary-blue',
  'In Progress': 'bg-status-in-progress',
  'Review Complete': 'bg-status-completed',
  Waived: 'bg-status-draft',
  Approved: 'bg-status-completed',
  'Approved with Conditions': 'bg-status-in-progress',
  Rejected: 'bg-red-500',
  Deferred: 'bg-status-draft',
};

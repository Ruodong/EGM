export interface NavItem {
  label: string;
  href: string;
  icon: string;
  children?: NavItem[];
  requiredResource?: string;
  requiredScope?: string;
}

export const sidebarNavItems: NavItem[] = [
  { label: 'Home', href: '/', icon: 'Home' },
  { label: 'Governance Requests', href: '/requests', icon: 'FileCheck' },
  {
    label: 'Reviews',
    href: '/reviews',
    icon: 'ClipboardCheck',
    requiredResource: 'domain_review',
    requiredScope: 'write',
    children: [
      { label: 'All Reviews', href: '/reviews', icon: 'ClipboardCheck', requiredResource: 'domain_review', requiredScope: 'write' },
      { label: 'Review Actions', href: '/actions', icon: 'ListTodo', requiredResource: 'review_action', requiredScope: 'write' },
    ],
  },
  {
    label: 'Domains',
    href: '/domains',
    icon: 'Puzzle',
    requiredResource: 'domain_registry',
    requiredScope: 'read',
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: 'BarChart3',
    children: [
      { label: 'Governance Dashboard', href: '/reports/governance-dashboard', icon: 'BarChart3' },
      { label: 'Domain Metrics', href: '/reports/domain-metrics', icon: 'BarChart3' },
      { label: 'Lead Time', href: '/reports/lead-time', icon: 'BarChart3' },
    ],
  },
  {
    label: 'Settings',
    href: '/settings',
    icon: 'Settings',
    children: [
      { label: 'Scoping Templates', href: '/settings/scoping-templates', icon: 'Settings', requiredResource: 'intake_template', requiredScope: 'write' },
      { label: 'Questionnaire Templates', href: '/settings/questionnaire-templates', icon: 'Settings', requiredResource: 'domain_questionnaire', requiredScope: 'read' },
      { label: 'Dispatch Rules', href: '/settings/dispatch-rules', icon: 'Settings', requiredResource: 'dispatch_rule', requiredScope: 'read' },
      { label: 'Domain Management', href: '/settings/domains', icon: 'Puzzle', requiredResource: 'domain_registry', requiredScope: 'write' },
      { label: 'User Authorization', href: '/settings/user-authorization', icon: 'Users', requiredResource: 'user_authorization', requiredScope: 'read' },
      { label: 'Audit Log', href: '/settings/audit-log', icon: 'Shield', requiredResource: 'audit_log', requiredScope: 'read' },
    ],
  },
  { label: 'Help', href: '/help', icon: 'HelpCircle' },
];

/** Maps status/verdict labels → hex background colours. Use with inline style. */
export const statusHex: Record<string, string> = {
  Draft: '#8C8C8C',
  Submitted: '#1890FF',
  'In Progress': '#FA8C16',
  Complete: '#52C41A',
  Cancelled: '#8C8C8C',
  'Waiting for Accept': '#FAAD14',
  'Return for Additional Information': '#EB2F96',
  Accept: '#13C2C2',
  Approved: '#52C41A',
  'Approved with Exception': '#FA8C16',
  'Not Passed': '#EF4444',
  Archived: '#8C8C8C',
  Active: '#52C41A',
};

/**
 * @deprecated Use `statusHex` with inline `style={{ backgroundColor }}` instead.
 * Tailwind class names kept for backward-compat; add them to `safelist` in tailwind.config.ts.
 */
export const statusColors: Record<string, string> = {
  Draft: 'bg-status-draft',
  Submitted: 'bg-status-in-review',
  'In Progress': 'bg-status-in-progress',
  Complete: 'bg-status-completed',
  Cancelled: 'bg-status-draft',
  'Waiting for Accept': 'bg-amber-500',
  'Return for Additional Information': 'bg-pink-500',
  Accept: 'bg-cyan-500',
  Approved: 'bg-status-completed',
  'Approved with Exception': 'bg-status-in-progress',
  'Not Passed': 'bg-red-500',
  Archived: 'bg-status-draft',
  Active: 'bg-status-completed',
};

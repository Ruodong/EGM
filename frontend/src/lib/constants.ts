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
    children: [
      { label: 'All Reviews', href: '/reviews', icon: 'ClipboardCheck' },
      { label: 'Review Actions', href: '/actions', icon: 'ListTodo' },
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
  Completed: '#52C41A',
  Cancelled: '#8C8C8C',
  Pending: '#D9D9D9',
  Assigned: '#4096FF',
  'Review Complete': '#52C41A',
  Waived: '#8C8C8C',
  Approved: '#52C41A',
  'Approved with Conditions': '#FA8C16',
  Rejected: '#EF4444',
  Deferred: '#8C8C8C',
  'Info Requested': '#EB2F96',
  'Waiting for Accept': '#FAAD14',
  'Information Inquiry': '#EB2F96',
  Returned: '#EB2F96',
  Accepted: '#52C41A',
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
  Completed: 'bg-status-completed',
  Cancelled: 'bg-status-draft',
  Pending: 'bg-status-pending',
  Assigned: 'bg-primary-blue',
  'Review Complete': 'bg-status-completed',
  Waived: 'bg-status-draft',
  Approved: 'bg-status-completed',
  'Approved with Conditions': 'bg-status-in-progress',
  Rejected: 'bg-red-500',
  Deferred: 'bg-status-draft',
  'Information Inquiry': 'bg-pink-500',
  Returned: 'bg-pink-500',
  Accepted: 'bg-status-completed',
};

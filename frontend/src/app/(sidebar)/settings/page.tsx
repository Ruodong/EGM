'use client';

import Link from 'next/link';

const settingsItems = [
  { label: 'Scoping Templates', href: '/settings/scoping-templates', description: 'Manage scoping questions used to determine applicable domains' },
  { label: 'Questionnaire Templates', href: '/settings/questionnaire-templates', description: 'Configure common questionnaire sections and questions' },
  { label: 'Dispatch Rules', href: '/settings/dispatch-rules', description: 'Set up rules that map scoping answers to governance domains' },
  { label: 'Domain Management', href: '/settings/domains', description: 'Create, edit and manage governance domain definitions' },
  { label: 'User Authorization', href: '/settings/user-authorization', description: 'Search employees and assign EGM roles for access control' },
  { label: 'Audit Log', href: '/settings/audit-log', description: 'View system activity and change history' },
];

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Settings</h1>
      <div className="grid grid-cols-2 gap-4">
        {settingsItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="bg-white rounded-lg border border-border-light p-5 hover:border-primary-blue transition-colors"
          >
            <h3 className="font-medium">{item.label}</h3>
            <p className="text-sm text-text-secondary mt-1">{item.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

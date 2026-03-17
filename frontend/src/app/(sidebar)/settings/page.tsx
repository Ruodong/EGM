'use client';

import Link from 'next/link';
import { useLocale } from '@/lib/locale-context';

export default function SettingsPage() {
  const { t } = useLocale();

  const settingsItems = [
    { label: t('settings.scopingTemplates'), href: '/settings/scoping-templates', description: t('settings.scopingTemplatesDesc') },
    { label: t('settings.questionnaireTemplates'), href: '/settings/questionnaire-templates', description: t('settings.questionnaireTemplatesDesc') },
    { label: t('settings.dispatchRules'), href: '/settings/dispatch-rules', description: t('settings.dispatchRulesDesc') },
    { label: t('settings.domainManagement'), href: '/settings/domains', description: t('settings.domainManagementDesc') },
    { label: t('settings.userAuthorization'), href: '/settings/user-authorization', description: t('settings.userAuthorizationDesc') },
    { label: t('settings.auditLog'), href: '/settings/audit-log', description: t('settings.auditLogDesc') },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">{t('settings.title')}</h1>
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

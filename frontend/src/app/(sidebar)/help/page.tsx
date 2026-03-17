'use client';

import { useLocale } from '@/lib/locale-context';

export default function HelpPage() {
  const { t } = useLocale();

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">{t('help.title')}</h1>
      <div className="bg-white rounded-lg border border-border-light p-6 space-y-4">
        <div>
          <h2 className="font-semibold mb-2">{t('help.requestFlow')}</h2>
          <ol className="list-decimal list-inside text-sm text-text-secondary space-y-1">
            <li>{t('help.step1')}</li>
            <li>{t('help.step2')}</li>
            <li>{t('help.step3')}</li>
            <li>{t('help.step4')}</li>
            <li>{t('help.step5')}</li>
            <li>{t('help.step6')}</li>
          </ol>
        </div>
        <div>
          <h2 className="font-semibold mb-2">{t('help.domainReviews')}</h2>
          <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
            <li><strong>EA</strong> — Enterprise Architecture (via EAM)</li>
            <li><strong>BIA</strong> — Business Impact Assessment</li>
            <li><strong>RAI</strong> — Responsible AI Review</li>
            <li><strong>DATA_PRIVACY</strong> — Data Privacy & Compliance</li>
          </ul>
        </div>
        <div>
          <h2 className="font-semibold mb-2">{t('help.isrTitle')}</h2>
          <p className="text-sm text-text-secondary">
            {t('help.isrDesc')}
          </p>
        </div>
      </div>
    </div>
  );
}

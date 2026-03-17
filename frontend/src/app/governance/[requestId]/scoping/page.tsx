'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { Button } from 'antd';
import { useLocale } from '@/lib/locale-context';
import clsx from 'clsx';

interface Template {
  id: string;
  sectionType: string;
  section: string;
  questionNo: number;
  questionText: string;
  answerType: string;
  options: string[] | null;
  isRequired: boolean;
  helpText: string | null;
  triggersDomain: string[] | null;
  sortOrder: number;
}

interface Response {
  id: string;
  templateId: string;
  answer: any;
}

export default function ScopingPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const requestId = params.requestId as string;
  const { t } = useLocale();

  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const { data: templates } = useQuery<{ data: Template[] }>({
    queryKey: ['intake-templates', 'scoping'],
    queryFn: () => api.get('/intake/templates', { section_type: 'scoping' }),
  });

  const { data: responses } = useQuery<{ data: Response[] }>({
    queryKey: ['intake-responses', requestId],
    queryFn: () => api.get(`/intake/responses/${requestId}`),
  });

  // Seed answers from saved responses
  useEffect(() => {
    if (responses?.data) {
      const map: Record<string, any> = {};
      for (const r of responses.data) {
        map[r.templateId] = r.answer;
      }
      setAnswers(map);
    }
  }, [responses]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = Object.entries(answers).map(([templateId, answer]) => ({
        templateId,
        answer: typeof answer === 'string' ? answer : JSON.stringify(answer),
      }));
      return api.post('/intake/responses', { requestId, answers: payload });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intake-responses', requestId] });
      toast(t('scoping.answersSaved'), 'success');
    },
    onError: () => toast(t('scoping.failedSave'), 'error'),
  });

  const evaluateMutation = useMutation({
    mutationFn: () => api.post(`/intake/evaluate/${requestId}`, {}),
    onSuccess: (data: any) => {
      toast(`${t('scoping.scopingComplete')}${data.triggeredDomains?.length || 0} ${t('scoping.domainsTriggered')}`, 'success');
      router.push(`/governance/${requestId}/common-questionnaire`);
    },
    onError: () => toast(t('scoping.evaluationFailed'), 'error'),
  });

  const handleSaveAndContinue = async () => {
    setSaving(true);
    try {
      await saveMutation.mutateAsync();
      await evaluateMutation.mutateAsync();
    } finally {
      setSaving(false);
    }
  };

  const grouped = (templates?.data || []).reduce<Record<string, Template[]>>((acc, t) => {
    (acc[t.section] ||= []).push(t);
    return acc;
  }, {});

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-bold mb-2">{t('scoping.title')}</h1>
        <p className="text-sm text-text-secondary mb-6">
          {t('scoping.instruction')}
        </p>

        {Object.entries(grouped).map(([section, questions]) => (
          <div key={section} className="bg-white rounded-lg border border-border-light p-6 mb-4">
            <h2 className="text-base font-semibold mb-4">{section}</h2>
            <div className="space-y-5">
              {questions.map((q) => (
                <div key={q.id}>
                  <label className="block text-sm font-medium mb-1">
                    {q.questionNo}. {q.questionText}
                    {q.isRequired && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  {q.triggersDomain && (
                    <span className="text-xs text-text-secondary">
                      {t('scoping.triggers')}{q.triggersDomain.join(', ')}
                    </span>
                  )}
                  {q.answerType === 'select' && q.options ? (
                    <select
                      className="select-field mt-1"
                      value={answers[q.id] || ''}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    >
                      <option value="">{t('govCreate.selectOption')}</option>
                      {q.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : q.answerType === 'textarea' ? (
                    <textarea
                      className="input-field mt-1 h-20"
                      value={answers[q.id] || ''}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    />
                  ) : (
                    <input
                      className="input-field mt-1"
                      type={q.answerType === 'date' ? 'date' : 'text'}
                      value={answers[q.id] || ''}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex justify-between mt-6">
          <Button type="default" onClick={() => router.push(`/governance/${requestId}`)}>
            {t('common.back')}
          </Button>
          <div className="flex gap-3">
            <Button
              type="default"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {t('scoping.saveDraft')}
            </Button>
            <Button
              type="primary"
              style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
              disabled={saving}
              onClick={handleSaveAndContinue}
            >
              {saving ? t('scoping.processing') : t('scoping.saveContinue')}
            </Button>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

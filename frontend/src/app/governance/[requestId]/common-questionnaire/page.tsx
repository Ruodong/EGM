'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { PageLayout } from '@/components/layout/PageLayout';

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
  sortOrder: number;
}

interface Response {
  id: string;
  templateId: string;
  answer: any;
}

interface ChangeLogEntry {
  id: string;
  templateId: string;
  questionText: string | null;
  section: string | null;
  oldAnswer: any;
  newAnswer: any;
  changeReason: string | null;
  changedBy: string | null;
  changedAt: string | null;
}

export default function CommonQuestionnairePage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const requestId = params.requestId as string;

  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [showChangelog, setShowChangelog] = useState(false);

  const { data: templates } = useQuery<{ data: Template[] }>({
    queryKey: ['intake-templates', 'common'],
    queryFn: () => api.get('/intake/templates', { section_type: 'common' }),
  });

  const { data: responses } = useQuery<{ data: Response[] }>({
    queryKey: ['intake-responses', requestId],
    queryFn: () => api.get(`/intake/responses/${requestId}`),
  });

  const { data: changelog } = useQuery<{ data: ChangeLogEntry[] }>({
    queryKey: ['intake-changelog', requestId],
    queryFn: () => api.get(`/intake/changelog/${requestId}`),
    enabled: showChangelog,
  });

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
      toast('Questionnaire saved', 'success');
    },
    onError: () => toast('Failed to save', 'error'),
  });

  const handleSaveAndContinue = async () => {
    await saveMutation.mutateAsync();
    router.push(`/governance/${requestId}/reviews`);
  };

  const grouped = (templates?.data || []).reduce<Record<string, Template[]>>((acc, t) => {
    (acc[t.section] ||= []).push(t);
    return acc;
  }, {});

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Common Questionnaire</h1>
            <p className="text-sm text-text-secondary mt-1">
              Provide project information shared across all domain reviews.
            </p>
          </div>
          <button
            className="text-sm text-primary-blue hover:underline"
            onClick={() => setShowChangelog(!showChangelog)}
          >
            {showChangelog ? 'Hide' : 'Show'} Change History
          </button>
        </div>

        {showChangelog && changelog?.data && changelog.data.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-semibold mb-2">Change History</h3>
            <div className="space-y-2 text-sm max-h-48 overflow-y-auto">
              {changelog.data.map((c) => (
                <div key={c.id} className="flex justify-between items-start border-b border-yellow-200 pb-2">
                  <div>
                    <span className="font-medium">{c.questionText || c.templateId}</span>
                    <span className="text-text-secondary ml-2">
                      {c.section && `(${c.section})`}
                    </span>
                  </div>
                  <span className="text-text-secondary text-xs">
                    {c.changedBy} — {c.changedAt ? new Date(c.changedAt).toLocaleString() : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {Object.entries(grouped).map(([section, questions]) => (
          <div key={section} className="bg-white rounded-lg border border-border-light p-6 mb-4">
            <h2 className="text-base font-semibold mb-4">{section}</h2>
            <div className="space-y-5">
              {questions.map((q) => (
                <div key={q.id}>
                  <label className="block text-sm font-medium mb-1">
                    {q.questionText}
                    {q.isRequired && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  {q.helpText && (
                    <p className="text-xs text-text-secondary mb-1">{q.helpText}</p>
                  )}
                  {q.answerType === 'select' && q.options ? (
                    <select
                      className="select-field"
                      value={answers[q.id] || ''}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    >
                      <option value="">-- Select --</option>
                      {q.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : q.answerType === 'textarea' ? (
                    <textarea
                      className="input-field h-24"
                      value={answers[q.id] || ''}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    />
                  ) : (
                    <input
                      className="input-field"
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
          <button className="btn-default" onClick={() => router.push(`/governance/${requestId}/scoping`)}>
            Back to Scoping
          </button>
          <div className="flex gap-3">
            <button
              className="btn-default"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              Save Draft
            </button>
            <button
              className="btn-teal"
              disabled={saveMutation.isPending}
              onClick={handleSaveAndContinue}
            >
              {saveMutation.isPending ? 'Saving...' : 'Save & Continue'}
            </button>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

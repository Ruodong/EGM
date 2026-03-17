'use client';

import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useLocale } from '@/lib/locale-context';
import { DownOutlined, RightOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Question {
  id: string;
  section: string | null;
  questionNo: number;
  questionText: string;
  questionDescription: string | null;
  answerType: string;
  options: string[] | null;
  isRequired: boolean;
  sortOrder: number;
  dependency: { questionId: string; answer: string } | null;
  hasDescriptionBox: boolean;
  descriptionBoxTitle: string | null;
  questionTextZh?: string | null;
  questionDescriptionZh?: string | null;
  optionsZh?: string[] | null;
  descriptionBoxTitleZh?: string | null;
  questionImages?: Array<{ url: string; alt?: string; caption?: string }> | null;
}

type Locale = 'en' | 'zh';

/** Resolve bilingual text: prefer the locale's language, fall back to the other */
function bilingualText(locale: Locale, en?: string | null, zh?: string | null): string {
  if (locale === 'zh') return zh || en || '';
  return en || zh || '';
}

interface SavedResponse {
  id: string;
  domainReviewId: string;
  templateId: string;
  answer: { value?: string | string[]; otherText?: string; descriptionText?: string } | null;
}

export interface ReviewerQuestionnairesRef {
  /** Returns count of incomplete required questions */
  getIncompleteCount: () => number;
  /** Flush all pending debounced saves immediately */
  flushPendingSaves: () => Promise<void>;
}

interface ReviewerQuestionnairesProps {
  domainReviewId: string;
  readOnly?: boolean;
}

function isAnswerComplete(answer: SavedResponse['answer']): boolean {
  if (!answer || answer.value === undefined || answer.value === null) return false;
  if (typeof answer.value === 'string') return answer.value.trim().length > 0;
  if (Array.isArray(answer.value)) return answer.value.length > 0;
  return false;
}

/** Check if a question's dependency condition is met */
function isDependencyMet(
  question: Question,
  answers: Record<string, SavedResponse['answer']>,
): boolean {
  if (!question.dependency) return true;
  const depAnswer = answers[question.dependency.questionId];
  if (!depAnswer || depAnswer.value === undefined || depAnswer.value === null) return false;
  const val = depAnswer.value;
  if (typeof val === 'string') return val === question.dependency.answer;
  if (Array.isArray(val)) return val.includes(question.dependency.answer);
  return false;
}

export const ReviewerQuestionnaires = forwardRef<ReviewerQuestionnairesRef, ReviewerQuestionnairesProps>(
  function ReviewerQuestionnaires({ domainReviewId, readOnly = false }, ref) {
    const { locale, t } = useLocale();
    const qc = useQueryClient();
    const [sectionCollapsed, setSectionCollapsed] = useState<Record<string, boolean>>({});
    const [answers, setAnswers] = useState<Record<string, SavedResponse['answer']>>({});
    const pendingSaves = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    // Fetch templates for this domain review
    const { data: templatesData } = useQuery<{ data: Question[] }>({
      queryKey: ['domain-questionnaire-templates', domainReviewId],
      queryFn: () => api.get(`/domain-questionnaire/templates/${domainReviewId}`),
      enabled: !!domainReviewId,
    });

    // Fetch saved responses
    const { data: responsesData } = useQuery<{ data: SavedResponse[] }>({
      queryKey: ['domain-questionnaire', domainReviewId],
      queryFn: () => api.get(`/domain-questionnaire/${domainReviewId}`),
      enabled: !!domainReviewId,
    });

    const saveMutation = useMutation({
      mutationFn: (payload: { responses: { templateId: string; answer: unknown }[] }) =>
        api.post(`/domain-questionnaire/${domainReviewId}`, payload),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['domain-questionnaire', domainReviewId] });
      },
    });

    // Initialize answers from saved responses
    useEffect(() => {
      if (!responsesData?.data) return;
      const initial: Record<string, SavedResponse['answer']> = {};
      for (const r of responsesData.data) {
        initial[r.templateId] = r.answer;
      }
      setAnswers(initial);
    }, [responsesData]);

    const saveAnswer = useCallback(
      (templateId: string, answer: SavedResponse['answer']) => {
        if (pendingSaves.current[templateId]) {
          clearTimeout(pendingSaves.current[templateId]);
        }
        pendingSaves.current[templateId] = setTimeout(() => {
          saveMutation.mutate({
            responses: [{ templateId, answer }],
          });
          delete pendingSaves.current[templateId];
        }, 500);
      },
      [saveMutation],
    );

    const updateAnswer = useCallback(
      (templateId: string, answer: SavedResponse['answer']) => {
        setAnswers((prev) => ({ ...prev, [templateId]: answer }));
        if (!readOnly) {
          saveAnswer(templateId, answer);
        }
      },
      [readOnly, saveAnswer],
    );

    // Expose validation + flush methods to parent
    useImperativeHandle(ref, () => ({
      getIncompleteCount: () => {
        if (!templatesData?.data) return 0;
        return templatesData.data.filter(
          (q) => q.isRequired && isDependencyMet(q, answers) && !isAnswerComplete(answers[q.id]),
        ).length;
      },
      flushPendingSaves: () => {
        const pending = Object.entries(pendingSaves.current);
        if (pending.length === 0) return Promise.resolve();
        // Clear all timers
        for (const [tid, timer] of pending) {
          clearTimeout(timer);
          delete pendingSaves.current[tid];
        }
        // Collect all unsaved answers and batch-save them
        const toSave: { templateId: string; answer: SavedResponse['answer'] }[] = [];
        if (templatesData?.data) {
          for (const q of templatesData.data) {
            if (answers[q.id] !== undefined) {
              toSave.push({ templateId: q.id, answer: answers[q.id] });
            }
          }
        }
        if (toSave.length === 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
          saveMutation.mutate({ responses: toSave }, { onSettled: () => resolve() });
        });
      },
    }));

    const questions = templatesData?.data || [];

    if (questions.length === 0) return null;

    // Group questions by section
    const sections: { name: string | null; questions: Question[] }[] = [];
    for (const q of questions) {
      const sName = q.section || null;
      const last = sections[sections.length - 1];
      if (last && last.name === sName) {
        last.questions.push(q);
      } else {
        sections.push({ name: sName, questions: [q] });
      }
    }
    const hasSections = sections.some((s) => s.name);

    // Progress counts — only visible (dependency-met) required questions
    const visibleRequired = questions.filter(
      (q) => q.isRequired && isDependencyMet(q, answers),
    );
    const total = visibleRequired.length;
    const answered = visibleRequired.filter(
      (q) => isAnswerComplete(answers[q.id]),
    ).length;
    const isComplete = total > 0 && answered === total;

    return (
      <div className="space-y-1">
        {/* Progress summary */}
        {total > 0 && (
          <div className="flex items-center gap-1.5 text-xs px-1 mb-2">
            {isComplete ? (
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircleOutlined style={{ fontSize: 14 }} /> {answered}/{total} {t('domainQ.answered')}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-600">
                <ExclamationCircleOutlined style={{ fontSize: 14 }} /> {answered}/{total} {t('domainQ.answered')}
              </span>
            )}
          </div>
        )}

        {/* Questions grouped by section */}
        {sections.map((sec, si) => {
          const sectionKey = `${domainReviewId}::${sec.name ?? si}`;
          const isSectionCollapsed = sectionCollapsed[sectionKey] ?? false;

          const renderQuestions = (qs: Question[]) =>
            qs.map((q) => {
              if (!isDependencyMet(q, answers)) return null;
              return (
                <QuestionInput
                  key={q.id}
                  question={q}
                  answer={answers[q.id] || null}
                  onChange={(answer) => updateAnswer(q.id, answer)}
                  readOnly={readOnly}
                  locale={locale as Locale}
                />
              );
            });

          if (!hasSections || !sec.name) {
            return (
              <div key={sectionKey} className="space-y-4">
                {renderQuestions(sec.questions)}
              </div>
            );
          }

          return (
            <div key={sectionKey} className="border border-border-light rounded-lg bg-white">
              <button
                type="button"
                onClick={() => setSectionCollapsed((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors rounded-t-lg text-left"
              >
                {isSectionCollapsed ? <RightOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
                <span className="text-sm font-medium text-text-secondary">{sec.name}</span>
                <span className="text-xs text-text-secondary ml-auto">
                  {sec.questions.length} {sec.questions.length !== 1 ? t('domainQ.questions') : t('domainQ.question')}
                </span>
              </button>
              {!isSectionCollapsed && (
                <div className="px-4 pb-4 pt-3 space-y-4">
                  {renderQuestions(sec.questions)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  },
);

function QuestionInput({
  question,
  answer,
  onChange,
  readOnly,
  locale = 'en',
}: {
  question: Question;
  answer: SavedResponse['answer'];
  onChange: (answer: SavedResponse['answer']) => void;
  readOnly: boolean;
  locale?: Locale;
}) {
  const { t } = useLocale();
  const value = answer?.value ?? '';
  const otherText = answer?.otherText ?? '';
  const descriptionText = answer?.descriptionText ?? '';

  // Resolve bilingual text
  const questionText = bilingualText(locale, question.questionText, question.questionTextZh);
  const questionDesc = bilingualText(locale, question.questionDescription, question.questionDescriptionZh);
  const descBoxTitle = bilingualText(locale, question.descriptionBoxTitle, question.descriptionBoxTitleZh) || t('domainQ.justifyAnswer');

  // Options: EN options are always used as stored values; display options follow locale
  const enOptions = question.options || [];
  const zhOptions = question.optionsZh || [];
  const displayOptions = (() => {
    if (locale === 'zh' && zhOptions.length === enOptions.length && zhOptions.length > 0) return zhOptions;
    if (locale === 'en' && enOptions.length > 0) return enOptions;
    return enOptions.length > 0 ? enOptions : zhOptions;
  })();

  const handleRadioChange = (enVal: string) => {
    onChange({ value: enVal, ...(descriptionText ? { descriptionText } : {}) });
  };

  const handleMultiselectChange = (enOption: string, checked: boolean) => {
    const current = Array.isArray(value) ? [...value] : [];
    if (checked) {
      current.push(enOption);
    } else {
      const idx = current.indexOf(enOption);
      if (idx >= 0) current.splice(idx, 1);
    }
    onChange({
      value: current,
      ...(current.includes('Other') ? { otherText } : {}),
      ...(descriptionText ? { descriptionText } : {}),
    });
  };

  const handleOtherText = (text: string) => {
    onChange({ value: value, otherText: text, ...(descriptionText ? { descriptionText } : {}) });
  };

  const handleDescriptionText = (text: string) => {
    onChange({ ...answer, value, descriptionText: text });
  };

  return (
    <div>
      <div className="flex items-start gap-1 mb-1.5">
        <span className="text-sm font-medium">
          {questionText}
          {question.isRequired && <span className="text-red-500 ml-0.5">*</span>}
        </span>
      </div>
      {questionDesc && (
        <div className="text-xs text-text-secondary mb-2 prose prose-xs max-w-none [&_a]:text-blue-600 [&_a]:underline [&_p]:m-0">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{questionDesc}</ReactMarkdown>
        </div>
      )}

      {/* Question images */}
      {question.questionImages && question.questionImages.length > 0 && (
        <div className="mb-2 space-y-2">
          {question.questionImages.map((img, i) => (
            <figure key={i} className="my-0">
              <img src={img.url} alt={img.alt || ''} className="max-w-full max-h-64 rounded border" />
              {img.caption && <figcaption className="text-xs text-text-secondary mt-1">{img.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}

      {/* Radio */}
      {question.answerType === 'radio' && enOptions.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {enOptions.map((enOpt, i) => (
            <label key={enOpt} className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name={`q-${question.id}`}
                checked={value === enOpt}
                onChange={() => handleRadioChange(enOpt)}
                disabled={readOnly}
                className="accent-egm-teal"
              />
              {displayOptions[i] || enOpt}
            </label>
          ))}
        </div>
      )}

      {/* Multiselect */}
      {question.answerType === 'multiselect' && enOptions.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-3">
            {enOptions.map((enOpt, i) => (
              <label key={enOpt} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={Array.isArray(value) && value.includes(enOpt)}
                  onChange={(e) => handleMultiselectChange(enOpt, e.target.checked)}
                  disabled={readOnly}
                  className="rounded accent-egm-teal"
                />
                {displayOptions[i] || enOpt}
              </label>
            ))}
          </div>
          {Array.isArray(value) && value.includes('Other') && (
            <input
              className="input-field w-full mt-1"
              placeholder={t('domainQ.pleaseSpecify')}
              value={otherText}
              onChange={(e) => handleOtherText(e.target.value)}
              disabled={readOnly}
            />
          )}
        </div>
      )}

      {/* Dropdown */}
      {question.answerType === 'dropdown' && enOptions.length > 0 && (
        <div>
          <select
            className="input-field w-full max-w-sm"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange({ value: e.target.value, ...(descriptionText ? { descriptionText } : {}) })}
            disabled={readOnly}
          >
            <option value="">{t('domainQ.select')}</option>
            {enOptions.map((enOpt, i) => (
              <option key={enOpt} value={enOpt}>{displayOptions[i] || enOpt}</option>
            ))}
          </select>
          {typeof value === 'string' && value === 'Other' && (
            <input
              className="input-field w-full max-w-sm mt-2"
              placeholder={t('domainQ.pleaseSpecify')}
              value={otherText}
              onChange={(e) => handleOtherText(e.target.value)}
              disabled={readOnly}
            />
          )}
        </div>
      )}

      {/* Text (single-line) */}
      {question.answerType === 'text' && (
        <input
          type="text"
          className="input-field w-full max-w-lg"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange({ value: e.target.value, ...(descriptionText ? { descriptionText } : {}) })}
          disabled={readOnly}
          placeholder={t('domainQ.enterAnswer')}
        />
      )}

      {/* Textarea */}
      {question.answerType === 'textarea' && (
        <textarea
          className="input-field w-full"
          rows={3}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange({ value: e.target.value, ...(descriptionText ? { descriptionText } : {}) })}
          disabled={readOnly}
          placeholder={t('domainQ.enterAnswer')}
        />
      )}

      {/* Description Box — additional justification/details text area */}
      {question.hasDescriptionBox && (
        <div className="mt-3 border-l-2 border-amber-300 pl-3">
          <label className="block text-xs font-medium text-text-secondary mb-1">
            {descBoxTitle}
          </label>
          <textarea
            className="input-field w-full"
            rows={2}
            value={descriptionText}
            onChange={(e) => handleDescriptionText(e.target.value)}
            disabled={readOnly}
            placeholder={t('domainQ.provideDetails')}
          />
        </div>
      )}
    </div>
  );
}

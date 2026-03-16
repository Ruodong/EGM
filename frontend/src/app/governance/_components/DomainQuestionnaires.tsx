'use client';

import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import clsx from 'clsx';
import { DownOutlined, RightOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { getDomainIcon } from '@/lib/domain-icons';

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
}

interface DomainGroup {
  domainCode: string;
  domainName: string;
  questions: Question[];
}

interface SavedResponse {
  templateId: string;
  domainCode: string;
  answer: { value?: string | string[]; otherText?: string; descriptionText?: string } | null;
}

export interface DomainQuestionnairesRef {
  /** Returns list of domain codes with incomplete required questions */
  getIncompleteDomains: () => string[];
  /** Flush all pending debounced saves immediately */
  flushPendingSaves: () => Promise<void>;
}

interface DomainQuestionnairesProps {
  requestId: string;
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
  if (!question.dependency) return true; // No dependency — always visible
  const depAnswer = answers[question.dependency.questionId];
  if (!depAnswer || depAnswer.value === undefined || depAnswer.value === null) return false;
  const val = depAnswer.value;
  if (typeof val === 'string') return val === question.dependency.answer;
  if (Array.isArray(val)) return val.includes(question.dependency.answer);
  return false;
}

export const DomainQuestionnaires = forwardRef<DomainQuestionnairesRef, DomainQuestionnairesProps>(
  function DomainQuestionnaires({ requestId, readOnly = false }, ref) {
    const qc = useQueryClient();
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [sectionCollapsed, setSectionCollapsed] = useState<Record<string, boolean>>({});
    const [answers, setAnswers] = useState<Record<string, SavedResponse['answer']>>({});
    const pendingSaves = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    // Fetch templates for this request's triggered internal domains
    const { data: templatesData } = useQuery<{ data: DomainGroup[] }>({
      queryKey: ['request-questionnaire-templates', requestId],
      queryFn: () => api.get(`/request-questionnaire/templates/${requestId}`),
      enabled: !!requestId,
    });

    // Fetch saved responses
    const { data: responsesData } = useQuery<{ data: SavedResponse[] }>({
      queryKey: ['request-questionnaire', requestId],
      queryFn: () => api.get(`/request-questionnaire/${requestId}`),
      enabled: !!requestId,
    });

    const saveMutation = useMutation({
      mutationFn: (payload: { responses: { templateId: string; domainCode: string; answer: unknown }[] }) =>
        api.post(`/request-questionnaire/${requestId}`, payload),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['request-questionnaire', requestId] });
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

    // Auto-expand first incomplete domain
    useEffect(() => {
      if (!templatesData?.data) return;
      const groups = templatesData.data;
      const newCollapsed: Record<string, boolean> = {};
      let foundIncomplete = false;
      for (const g of groups) {
        const hasIncomplete = g.questions.some(
          (q) => q.isRequired && isDependencyMet(q, answers) && !isAnswerComplete(answers[q.id]),
        );
        newCollapsed[g.domainCode] = !hasIncomplete || foundIncomplete;
        if (hasIncomplete && !foundIncomplete) foundIncomplete = true;
      }
      if (!foundIncomplete && groups.length > 0) {
        newCollapsed[groups[0].domainCode] = false;
      }
      setCollapsed(newCollapsed);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [templatesData]);

    const saveAnswer = useCallback(
      (templateId: string, domainCode: string, answer: SavedResponse['answer']) => {
        if (pendingSaves.current[templateId]) {
          clearTimeout(pendingSaves.current[templateId]);
        }
        pendingSaves.current[templateId] = setTimeout(() => {
          saveMutation.mutate({
            responses: [{ templateId, domainCode, answer }],
          });
          delete pendingSaves.current[templateId];
        }, 500);
      },
      [saveMutation],
    );

    const updateAnswer = useCallback(
      (templateId: string, domainCode: string, answer: SavedResponse['answer']) => {
        setAnswers((prev) => ({ ...prev, [templateId]: answer }));
        if (!readOnly) {
          saveAnswer(templateId, domainCode, answer);
        }
      },
      [readOnly, saveAnswer],
    );

    // Expose validation + flush methods to parent
    useImperativeHandle(ref, () => ({
      getIncompleteDomains: () => {
        if (!templatesData?.data) return [];
        const incomplete: string[] = [];
        for (const g of templatesData.data) {
          const hasIncomplete = g.questions.some(
            (q) => q.isRequired && isDependencyMet(q, answers) && !isAnswerComplete(answers[q.id]),
          );
          if (hasIncomplete) incomplete.push(g.domainCode);
        }
        return incomplete;
      },
      /** Flush all pending debounced saves immediately. Returns a promise that resolves when saves complete. */
      flushPendingSaves: () => {
        const pending = Object.entries(pendingSaves.current);
        if (pending.length === 0) return Promise.resolve();
        // Clear all timers and fire saves immediately
        for (const [tid, timer] of pending) {
          clearTimeout(timer);
          delete pendingSaves.current[tid];
        }
        // Collect all unsaved answers and batch-save them
        const toSave: { templateId: string; domainCode: string; answer: SavedResponse['answer'] }[] = [];
        if (templatesData?.data) {
          for (const g of templatesData.data) {
            for (const q of g.questions) {
              if (answers[q.id] !== undefined) {
                toSave.push({ templateId: q.id, domainCode: g.domainCode, answer: answers[q.id] });
              }
            }
          }
        }
        if (toSave.length === 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
          saveMutation.mutate({ responses: toSave }, { onSettled: () => resolve() });
        });
      },
    }));

    const groups = templatesData?.data || [];

    if (groups.length === 0) return null;

    return (
      <div className="space-y-3">
        {groups.map((group) => {
          const isCollapsed = collapsed[group.domainCode] ?? false;
          const { Icon, colors } = getDomainIcon(group.domainCode);
          // Only count visible (dependency-met) required questions
          const visibleRequired = group.questions.filter(
            (q) => q.isRequired && isDependencyMet(q, answers),
          );
          const total = visibleRequired.length;
          const answered = visibleRequired.filter(
            (q) => isAnswerComplete(answers[q.id]),
          ).length;
          const isComplete = total > 0 && answered === total;

          return (
            <div key={group.domainCode} className="border border-border-light rounded-lg bg-white">
              {/* Domain header */}
              <button
                type="button"
                onClick={() => setCollapsed((prev) => ({ ...prev, [group.domainCode]: !prev[group.domainCode] }))}
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-50 transition-colors rounded-lg"
              >
                {isCollapsed ? <RightOutlined style={{ fontSize: 12 }} /> : <DownOutlined style={{ fontSize: 12 }} />}
                <span className={clsx('inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0', colors)}>
                  <Icon style={{ fontSize: 15 }} />
                </span>
                <span className="font-medium">{group.domainName}</span>
                <span className="text-xs text-text-secondary">({group.domainCode})</span>
                <span className="ml-auto flex items-center gap-1.5 text-xs">
                  {isComplete ? (
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircleOutlined style={{ fontSize: 14 }} /> {answered}/{total} answered
                    </span>
                  ) : total > 0 ? (
                    <span className="flex items-center gap-1 text-amber-600">
                      <ExclamationCircleOutlined style={{ fontSize: 14 }} /> {answered}/{total} answered
                    </span>
                  ) : (
                    <span className="text-text-secondary">{group.questions.length} question{group.questions.length !== 1 ? 's' : ''}</span>
                  )}
                </span>
              </button>

              {/* Questions — grouped by section */}
              {!isCollapsed && (
                <div className="border-t border-border-light">
                  {(() => {
                    const sections: { name: string | null; questions: Question[] }[] = [];
                    for (const q of group.questions) {
                      const sName = q.section || null;
                      const last = sections[sections.length - 1];
                      if (last && last.name === sName) {
                        last.questions.push(q);
                      } else {
                        sections.push({ name: sName, questions: [q] });
                      }
                    }
                    const hasSections = sections.some(s => s.name);

                    return sections.map((sec, si) => {
                      const sectionKey = `${group.domainCode}::${sec.name ?? si}`;
                      const isSectionCollapsed = sectionCollapsed[sectionKey] ?? false;

                      const renderQuestions = (questions: Question[]) =>
                        questions.map((q) => {
                          // Check dependency — hide if not met
                          if (!isDependencyMet(q, answers)) return null;
                          return (
                            <QuestionInput
                              key={q.id}
                              question={q}
                              domainCode={group.domainCode}
                              answer={answers[q.id] || null}
                              onChange={(answer) => updateAnswer(q.id, group.domainCode, answer)}
                              readOnly={readOnly}
                            />
                          );
                        });

                      if (!hasSections || !sec.name) {
                        return (
                          <div key={sectionKey} className="px-4 pb-4 pt-3 space-y-4">
                            {renderQuestions(sec.questions)}
                          </div>
                        );
                      }

                      return (
                        <div key={sectionKey}>
                          <button
                            type="button"
                            onClick={() => setSectionCollapsed(prev => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}
                            className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors border-t border-border-light first:border-t-0 text-left"
                          >
                            {isSectionCollapsed ? <RightOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
                            <span className="text-sm font-medium text-text-secondary">{sec.name}</span>
                            <span className="text-xs text-text-secondary ml-auto">{sec.questions.length} question{sec.questions.length !== 1 ? 's' : ''}</span>
                          </button>
                          {!isSectionCollapsed && (
                            <div className="px-4 pb-4 pt-3 space-y-4">
                              {renderQuestions(sec.questions)}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
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
  domainCode,
  answer,
  onChange,
  readOnly,
}: {
  question: Question;
  domainCode: string;
  answer: SavedResponse['answer'];
  onChange: (answer: SavedResponse['answer']) => void;
  readOnly: boolean;
}) {
  const value = answer?.value ?? '';
  const otherText = answer?.otherText ?? '';
  const descriptionText = answer?.descriptionText ?? '';

  const handleRadioChange = (val: string) => {
    onChange({ value: val, ...(descriptionText ? { descriptionText } : {}) });
  };

  const handleMultiselectChange = (option: string, checked: boolean) => {
    const current = Array.isArray(value) ? [...value] : [];
    if (checked) {
      current.push(option);
    } else {
      const idx = current.indexOf(option);
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
          {question.questionText}
          {question.isRequired && <span className="text-red-500 ml-0.5">*</span>}
        </span>
      </div>
      {question.questionDescription && (
        <p className="text-xs text-text-secondary mb-2">{question.questionDescription}</p>
      )}

      {/* Radio */}
      {question.answerType === 'radio' && question.options && (
        <div className="flex flex-wrap gap-3">
          {question.options.map((opt) => (
            <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="radio"
                name={`q-${question.id}`}
                checked={value === opt}
                onChange={() => handleRadioChange(opt)}
                disabled={readOnly}
                className="accent-egm-teal"
              />
              {opt}
            </label>
          ))}
        </div>
      )}

      {/* Multiselect */}
      {question.answerType === 'multiselect' && question.options && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-3">
            {question.options.map((opt) => (
              <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={Array.isArray(value) && value.includes(opt)}
                  onChange={(e) => handleMultiselectChange(opt, e.target.checked)}
                  disabled={readOnly}
                  className="rounded accent-egm-teal"
                />
                {opt}
              </label>
            ))}
          </div>
          {Array.isArray(value) && value.includes('Other') && (
            <input
              className="input-field w-full mt-1"
              placeholder="Please specify..."
              value={otherText}
              onChange={(e) => handleOtherText(e.target.value)}
              disabled={readOnly}
            />
          )}
        </div>
      )}

      {/* Dropdown */}
      {question.answerType === 'dropdown' && question.options && (
        <div>
          <select
            className="input-field w-full max-w-sm"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange({ value: e.target.value, ...(descriptionText ? { descriptionText } : {}) })}
            disabled={readOnly}
          >
            <option value="">Select...</option>
            {question.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          {typeof value === 'string' && value === 'Other' && (
            <input
              className="input-field w-full max-w-sm mt-2"
              placeholder="Please specify..."
              value={otherText}
              onChange={(e) => handleOtherText(e.target.value)}
              disabled={readOnly}
            />
          )}
        </div>
      )}

      {/* Textarea */}
      {question.answerType === 'textarea' && (
        <textarea
          className="input-field w-full"
          rows={3}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange({ value: e.target.value, ...(descriptionText ? { descriptionText } : {}) })}
          disabled={readOnly}
          placeholder="Enter your answer..."
        />
      )}

      {/* Description Box — additional justification/details text area */}
      {question.hasDescriptionBox && (
        <div className="mt-3 border-l-2 border-amber-300 pl-3">
          <label className="block text-xs font-medium text-text-secondary mb-1">
            {question.descriptionBoxTitle || 'Justify your answer below'}
          </label>
          <textarea
            className="input-field w-full"
            rows={2}
            value={descriptionText}
            onChange={(e) => handleDescriptionText(e.target.value)}
            disabled={readOnly}
            placeholder="Provide additional details..."
          />
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ui/Toast';
import { useLocale } from '@/lib/locale-context';
import clsx from 'clsx';
import { AutoComplete, Button, Input, Select, Switch } from 'antd';
import { PlusCircleOutlined, EditOutlined, DownOutlined, RightOutlined, CloseOutlined, PlusOutlined, ArrowUpOutlined, ArrowDownOutlined, LinkOutlined, FileTextOutlined } from '@ant-design/icons';
import { getDomainIcon } from '@/lib/domain-icons';

interface Template {
  id: string;
  domainCode: string;
  section: string | null;
  questionNo: number;
  questionText: string;
  questionDescription: string | null;
  answerType: string;
  options: string[] | null;
  isRequired: boolean;
  sortOrder: number;
  isActive: boolean;
  dependency: { questionId: string; answer: string } | null;
  hasDescriptionBox: boolean;
  descriptionBoxTitle: string | null;
  questionTextZh?: string | null;
  questionDescriptionZh?: string | null;
  optionsZh?: string[] | null;
  descriptionBoxTitleZh?: string | null;
  questionImages?: Array<{ url: string; alt?: string; caption?: string }> | null;
  audience: 'requestor' | 'reviewer';
}

interface DomainGroup {
  domainCode: string;
  domainName: string;
  templates: Template[];
}

interface SectionGroup {
  section: string | null;
  audience: 'requestor' | 'reviewer';
  templates: Template[];
  minSortOrder: number;
}

const ANSWER_TYPES = ['radio', 'multiselect', 'dropdown', 'textarea', 'text'] as const;

const emptyForm = {
  domainCode: '',
  section: '',
  questionNo: 1,
  questionText: '',
  questionDescription: '',
  answerType: 'textarea' as string,
  options: [] as string[],
  includeOther: false,
  isRequired: false,
  sortOrder: 0,
  dependencyQuestionId: '' as string,
  dependencyAnswer: '' as string,
  hasDescriptionBox: false,
  descriptionBoxTitle: '',
  questionTextZh: '',
  questionDescriptionZh: '',
  optionsZh: [] as string[],
  descriptionBoxTitleZh: '',
  questionImages: [] as Array<{ url: string; alt: string; caption: string }>,
  audience: 'requestor' as 'requestor' | 'reviewer',
};

/** Group templates by section within a domain */
function groupBySection(templates: Template[]): SectionGroup[] {
  const map = new Map<string, SectionGroup>();
  const sorted = [...templates].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const tmpl of sorted) {
    const key = tmpl.section || '__none__';
    if (!map.has(key)) {
      map.set(key, {
        section: tmpl.section,
        audience: tmpl.audience,
        templates: [],
        minSortOrder: tmpl.sortOrder,
      });
    }
    map.get(key)!.templates.push(tmpl);
  }
  return [...map.values()].sort((a, b) => a.minSortOrder - b.minSortOrder);
}

export default function QuestionnaireTemplatesPage() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canWrite = hasPermission('domain_questionnaire', 'write');
  const [editing, setEditing] = useState<Template | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [collapsedDomains, setCollapsedDomains] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [showInactive, setShowInactive] = useState(false);

  const ANSWER_TYPE_LABELS: Record<string, string> = {
    radio: t('qTemplates.radio'),
    multiselect: t('qTemplates.multiselect'),
    dropdown: t('qTemplates.dropdown'),
    textarea: t('qTemplates.textarea'),
    text: t('qTemplates.text'),
  };

  const { data, isLoading } = useQuery<{ data: DomainGroup[] }>({
    queryKey: ['questionnaire-templates'],
    queryFn: () => api.get('/questionnaire-templates'),
  });

  // Fetch default description box title from system config
  const { data: defaultTitleData } = useQuery<{ key: string; value: string }>({
    queryKey: ['system-config', 'questionnaire.descriptionBoxDefaultTitle'],
    queryFn: () => api.get('/system-config/questionnaire.descriptionBoxDefaultTitle'),
  });
  const defaultDescTitle = defaultTitleData?.value || 'Justify your answer below';

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api.put(`/questionnaire-templates/${editing.id}`, payload)
        : api.post('/questionnaire-templates', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['questionnaire-templates'] });
      toast(editing ? t('qTemplates.questionUpdated') : t('qTemplates.questionCreated'), 'success');
      resetForm();
    },
    onError: () => toast(t('qTemplates.failedSave'), 'error'),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/questionnaire-templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['questionnaire-templates'] });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (orders: { id: string; sortOrder: number }[]) =>
      api.put('/questionnaire-templates/reorder', { orders }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['questionnaire-templates'] });
    },
  });

  const sectionAudienceMutation = useMutation({
    mutationFn: (p: { domainCode: string; section: string | null; audience: string }) =>
      api.put('/questionnaire-templates/section-audience', { domainCode: p.domainCode, section: p.section, audience: p.audience }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['questionnaire-templates'] });
    },
  });

  const toggleRequiredMutation = useMutation({
    mutationFn: (p: { id: string; isRequired: boolean }) =>
      api.put(`/questionnaire-templates/${p.id}`, { isRequired: p.isRequired }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['questionnaire-templates'] });
    },
  });

  function resetForm() {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
  }

  function openEdit(tmpl: Template) {
    const opts = tmpl.options ? [...tmpl.options] : [];
    const hasOther = opts.includes('Other');
    const filteredOpts = opts.filter((o) => o !== 'Other');
    // For ZH options, also remove "Other" if the EN side has it (parallel arrays)
    const optsZh = tmpl.optionsZh ? [...tmpl.optionsZh] : [];
    const filteredOptsZh = hasOther && optsZh.length === opts.length
      ? optsZh.filter((_, i) => opts[i] !== 'Other')
      : optsZh;
    setEditing(tmpl);
    setForm({
      domainCode: tmpl.domainCode,
      section: tmpl.section || '',
      questionNo: tmpl.questionNo,
      questionText: tmpl.questionText,
      questionDescription: tmpl.questionDescription || '',
      answerType: tmpl.answerType,
      options: filteredOpts,
      includeOther: hasOther,
      isRequired: tmpl.isRequired,
      sortOrder: tmpl.sortOrder,
      dependencyQuestionId: tmpl.dependency?.questionId || '',
      dependencyAnswer: tmpl.dependency?.answer || '',
      hasDescriptionBox: tmpl.hasDescriptionBox,
      descriptionBoxTitle: tmpl.descriptionBoxTitle || '',
      questionTextZh: tmpl.questionTextZh || '',
      questionDescriptionZh: tmpl.questionDescriptionZh || '',
      optionsZh: filteredOptsZh,
      descriptionBoxTitleZh: tmpl.descriptionBoxTitleZh || '',
      questionImages: (tmpl.questionImages || []).map(img => ({
        url: img.url || '',
        alt: img.alt || '',
        caption: img.caption || '',
      })),
      audience: tmpl.audience || 'requestor',
    });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.domainCode) {
      toast(t('qTemplates.selectDomainError'), 'error');
      return;
    }
    if (!form.questionText.trim()) {
      toast(t('qTemplates.questionTextRequired'), 'error');
      return;
    }

    const needsOpts = ['radio', 'multiselect', 'dropdown'].includes(form.answerType);
    const allOptions = [...form.options.filter((o) => o.trim())];
    if (form.includeOther && needsOpts) {
      allOptions.push('Other');
    }

    if (needsOpts && allOptions.length === 0) {
      toast(t('qTemplates.addOptionError'), 'error');
      return;
    }

    const dependency = form.dependencyQuestionId && form.dependencyAnswer
      ? { questionId: form.dependencyQuestionId, answer: form.dependencyAnswer }
      : null;

    // Build ZH options (parallel array to EN options, including "Other" if applicable)
    let allOptionsZh: string[] | null = null;
    if (needsOpts && form.optionsZh.some(o => o.trim())) {
      allOptionsZh = [...form.optionsZh.filter((_, i) => form.options[i]?.trim())];
      if (form.includeOther) {
        allOptionsZh.push('Other');
      }
    }

    // Build images array (filter out empty URLs)
    const images = form.questionImages.filter(img => img.url.trim());

    const payload: Record<string, unknown> = {
      domainCode: form.domainCode,
      section: form.section || null,
      questionNo: Number(form.questionNo),
      questionText: form.questionText,
      questionDescription: form.questionDescription || null,
      answerType: form.answerType,
      options: needsOpts ? allOptions : null,
      isRequired: form.isRequired,
      sortOrder: Number(form.sortOrder),
      dependency,
      hasDescriptionBox: form.hasDescriptionBox,
      descriptionBoxTitle: form.descriptionBoxTitle || null,
      questionTextZh: form.questionTextZh || null,
      questionDescriptionZh: form.questionDescriptionZh || null,
      optionsZh: allOptionsZh,
      descriptionBoxTitleZh: form.descriptionBoxTitleZh || null,
      questionImages: images.length > 0 ? images : null,
      audience: form.audience,
    };
    saveMutation.mutate(payload);
  }

  function addOption() {
    setForm({ ...form, options: [...form.options, ''] });
  }

  function removeOption(idx: number) {
    setForm({ ...form, options: form.options.filter((_, i) => i !== idx) });
  }

  function updateOption(idx: number, value: string) {
    const updated = [...form.options];
    updated[idx] = value;
    setForm({ ...form, options: updated });
  }

  function toggleDomain(code: string) {
    setCollapsedDomains((prev) => ({ ...prev, [code]: !prev[code] }));
  }

  function toggleSection(key: string) {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function moveTemplate(id: string, templates: Template[], direction: 'up' | 'down') {
    const sorted = [...templates].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((tmpl) => tmpl.id === id);
    if (idx < 0) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === sorted.length - 1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    const orders = sorted.map((tmpl, i) => {
      let newSort = i;
      if (i === idx) newSort = swapIdx;
      if (i === swapIdx) newSort = idx;
      return { id: tmpl.id, sortOrder: newSort };
    });
    reorderMutation.mutate(orders);
  }

  /** Move an entire section up or down among sections within a domain */
  function moveSectionOrder(
    domainCode: string,
    sectionGroups: SectionGroup[],
    sectionIdx: number,
    direction: 'up' | 'down',
  ) {
    if (direction === 'up' && sectionIdx === 0) return;
    if (direction === 'down' && sectionIdx === sectionGroups.length - 1) return;

    const swapIdx = direction === 'up' ? sectionIdx - 1 : sectionIdx + 1;
    // Collect all templates from both sections and reassign sort orders
    const current = sectionGroups[sectionIdx];
    const swap = sectionGroups[swapIdx];

    // After swap, the "swap" section's templates come first (or second)
    // We rebuild sort orders for both sections' templates
    let orders: { id: string; sortOrder: number }[] = [];
    let sortCounter = Math.min(current.minSortOrder, swap.minSortOrder);

    const first = direction === 'up' ? current : swap;
    const second = direction === 'up' ? swap : current;

    for (const tmpl of first.templates) {
      orders.push({ id: tmpl.id, sortOrder: sortCounter++ });
    }
    for (const tmpl of second.templates) {
      orders.push({ id: tmpl.id, sortOrder: sortCounter++ });
    }

    reorderMutation.mutate(orders);
  }

  const groups = data?.data || [];
  const needsOptions = ['radio', 'multiselect', 'dropdown'].includes(form.answerType);

  // Existing sections for the selected domain (for autocomplete)
  const existingSections = form.domainCode
    ? [...new Set(
        (groups.find(g => g.domainCode === form.domainCode)?.templates || [])
          .map(tmpl => tmpl.section)
          .filter((s): s is string => !!s)
      )].map(s => ({ value: s, label: s }))
    : [];

  // Candidate questions for dependency: same domain + same section, with lower sort order, and has options
  const dependencyCandidates = (form.domainCode && form.section)
    ? (groups.find(g => g.domainCode === form.domainCode)?.templates || [])
        .filter(tmpl =>
          tmpl.section === form.section &&
          tmpl.sortOrder < Number(form.sortOrder) &&
          tmpl.options && tmpl.options.length > 0 &&
          tmpl.id !== editing?.id
        )
        .sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  // Options for the selected dependency question
  const selectedDepQuestion = dependencyCandidates.find(tmpl => tmpl.id === form.dependencyQuestionId);
  const depQuestionOptions = selectedDepQuestion?.options || [];

  // Helper to find question text by ID for display
  function findQuestionText(domainCode: string, questionId: string): string {
    const group = groups.find(g => g.domainCode === domainCode);
    const q = group?.templates.find(tmpl => tmpl.id === questionId);
    return q ? q.questionText : questionId;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">{t('qTemplates.title')}</h1>
          <p className="text-sm text-text-secondary mt-1">{t('qTemplates.subtitle')}</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <Switch size="small" checked={showInactive} onChange={setShowInactive} />
            {t('qTemplates.showInactive')}
          </label>
          {canWrite && (
            <Button
              type="primary"
              style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
              icon={<PlusCircleOutlined />}
              onClick={() => { resetForm(); setShowForm(true); }}
              data-testid="add-question-btn"
            >
              {t('qTemplates.addQuestion')}
            </Button>
          )}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-border-light p-6 mb-6">
          <h2 className="font-medium mb-4">{editing ? t('qTemplates.editQuestion') : t('qTemplates.newQuestion')}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('qTemplates.domain')}</label>
                <Select
                  className={clsx('w-full', editing && 'bg-gray-50 text-text-secondary')}
                  value={form.domainCode || undefined}
                  onChange={(value) => setForm({ ...form, domainCode: value, dependencyQuestionId: '', dependencyAnswer: '' })}
                  disabled={!!editing}
                  placeholder={t('qTemplates.selectDomain')}
                  data-testid="domain-select"
                  options={groups.map((g) => ({
                    label: `${g.domainName} (${g.domainCode})`,
                    value: g.domainCode,
                  }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.section')}</label>
                <AutoComplete
                  className="w-full"
                  value={form.section}
                  onChange={(value) => setForm({ ...form, section: value, dependencyQuestionId: '', dependencyAnswer: '' })}
                  options={existingSections}
                  placeholder={t('qTemplates.selectOrTypeSection')}
                  filterOption={(input, option) =>
                    (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ?? false
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.sortOrder')}</label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                />
              </div>
            </div>

            {/* Question Text — EN / ZH side by side */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('qTemplates.questionTextEn')}</label>
                <Input.TextArea
                  rows={2}
                  value={form.questionText}
                  onChange={(e) => setForm({ ...form, questionText: e.target.value })}
                  placeholder={t('qTemplates.questionTextPlaceholder')}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('qTemplates.questionTextZhLabel')}</label>
                <Input.TextArea
                  rows={2}
                  value={form.questionTextZh}
                  onChange={(e) => setForm({ ...form, questionTextZh: e.target.value })}
                  placeholder={t('qTemplates.questionTextZhPlaceholder')}
                />
              </div>
            </div>

            {/* Question Description — EN / ZH side by side */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('qTemplates.questionDescEn')} <span className="text-xs text-text-secondary font-normal">({t('qTemplates.supportsMarkdown')})</span></label>
                <Input.TextArea
                  rows={2}
                  value={form.questionDescription}
                  onChange={(e) => setForm({ ...form, questionDescription: e.target.value })}
                  placeholder={t('qTemplates.questionDescPlaceholder')}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('qTemplates.questionDescZhLabel')} <span className="text-xs text-text-secondary font-normal">({t('qTemplates.supportsMarkdown')})</span></label>
                <Input.TextArea
                  rows={2}
                  value={form.questionDescriptionZh}
                  onChange={(e) => setForm({ ...form, questionDescriptionZh: e.target.value })}
                  placeholder={t('qTemplates.questionDescZhPlaceholder')}
                />
              </div>
            </div>

            {/* Question Images */}
            <div className="border border-border-light rounded-lg p-4 bg-gray-50">
              <label className="block text-sm font-medium mb-2">{t('qTemplates.questionImagesOptional')}</label>
              <p className="text-xs text-text-secondary mb-3">{t('qTemplates.questionImagesHelp')}</p>
              <div className="space-y-2">
                {form.questionImages.map((img, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <div className="flex-1 space-y-1">
                      <Input
                        value={img.url}
                        onChange={(e) => {
                          const updated = [...form.questionImages];
                          updated[idx] = { ...updated[idx], url: e.target.value };
                          setForm({ ...form, questionImages: updated });
                        }}
                        placeholder={t('qTemplates.imageUrlPlaceholder')}
                        size="small"
                      />
                      <div className="flex gap-2">
                        <Input
                          className="flex-1"
                          value={img.alt}
                          onChange={(e) => {
                            const updated = [...form.questionImages];
                            updated[idx] = { ...updated[idx], alt: e.target.value };
                            setForm({ ...form, questionImages: updated });
                          }}
                          placeholder={t('qTemplates.imageAltPlaceholder')}
                          size="small"
                        />
                        <Input
                          className="flex-1"
                          value={img.caption}
                          onChange={(e) => {
                            const updated = [...form.questionImages];
                            updated[idx] = { ...updated[idx], caption: e.target.value };
                            setForm({ ...form, questionImages: updated });
                          }}
                          placeholder={t('qTemplates.imageCaptionPlaceholder')}
                          size="small"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, questionImages: form.questionImages.filter((_, i) => i !== idx) })}
                      className="text-red-400 hover:text-red-600 p-1 mt-1"
                    >
                      <CloseOutlined />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setForm({ ...form, questionImages: [...form.questionImages, { url: '', alt: '', caption: '' }] })}
                  className="text-primary-blue text-sm flex items-center gap-1 hover:underline"
                >
                  <PlusOutlined /> {t('qTemplates.addImage')}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('qTemplates.answerType')}</label>
                <Select
                  className="w-full"
                  value={form.answerType}
                  onChange={(value) => setForm({ ...form, answerType: value })}
                  data-testid="answer-type-select"
                  options={ANSWER_TYPES.map((at) => ({
                    label: ANSWER_TYPE_LABELS[at],
                    value: at,
                  }))}
                />
              </div>
              <div className="flex items-center gap-4 pt-6">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.isRequired}
                    onChange={(e) => setForm({ ...form, isRequired: e.target.checked })}
                    className="rounded"
                  />
                  {t('common.required')}
                </label>
                {needsOptions && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.includeOther}
                      onChange={(e) => setForm({ ...form, includeOther: e.target.checked })}
                      className="rounded"
                    />
                    {t('qTemplates.includeOther')}
                  </label>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('qTemplates.audience')}</label>
                <Select
                  className="w-full"
                  value={form.audience}
                  onChange={(value: 'requestor' | 'reviewer') => setForm({ ...form, audience: value })}
                  options={[
                    { label: t('qTemplates.requestor'), value: 'requestor' },
                    { label: t('qTemplates.reviewer'), value: 'reviewer' },
                  ]}
                />
              </div>
            </div>

            {/* Options editor */}
            {needsOptions && (
              <div>
                <label className="block text-sm font-medium mb-2">{t('qTemplates.options')}</label>
                <div className="space-y-2">
                  {form.options.map((opt, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        className="flex-1"
                        value={opt}
                        onChange={(e) => updateOption(idx, e.target.value)}
                        placeholder={t('qTemplates.optionEn').replace('{n}', String(idx + 1))}
                      />
                      <Input
                        className="flex-1"
                        value={form.optionsZh[idx] || ''}
                        onChange={(e) => {
                          const updated = [...form.optionsZh];
                          // Ensure array is long enough
                          while (updated.length <= idx) updated.push('');
                          updated[idx] = e.target.value;
                          setForm({ ...form, optionsZh: updated });
                        }}
                        placeholder={t('qTemplates.optionZh').replace('{n}', String(idx + 1))}
                      />
                      <button type="button" onClick={() => {
                        removeOption(idx);
                        setForm(prev => ({
                          ...prev,
                          optionsZh: prev.optionsZh.filter((_, i) => i !== idx),
                        }));
                      }} className="text-red-400 hover:text-red-600 p-1">
                        <CloseOutlined />
                      </button>
                    </div>
                  ))}
                  {form.includeOther && (
                    <div className="flex items-center gap-2">
                      <Input className="flex-1 bg-gray-50 text-text-secondary" value="Other" disabled />
                      <Input className="flex-1 bg-gray-50 text-text-secondary" value="Other" disabled />
                      <span className="text-xs text-text-secondary">{t('qTemplates.auto')}</span>
                    </div>
                  )}
                  <button type="button" onClick={() => {
                    addOption();
                    setForm(prev => ({ ...prev, optionsZh: [...prev.optionsZh, ''] }));
                  }} className="text-primary-blue text-sm flex items-center gap-1 hover:underline">
                    <PlusOutlined /> {t('qTemplates.addOption')}
                  </button>
                </div>
              </div>
            )}

            {/* Dependency selector */}
            {dependencyCandidates.length > 0 && (
              <div className="border border-border-light rounded-lg p-4 bg-gray-50">
                <label className="block text-sm font-medium mb-2">
                  <LinkOutlined className="mr-1" />
                  {t('qTemplates.conditionalDependency')}
                </label>
                <p className="text-xs text-text-secondary mb-3">
                  {t('qTemplates.conditionalDependencyHelp')}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">{t('qTemplates.dependsOnQuestion')}</label>
                    <Select
                      className="w-full"
                      value={form.dependencyQuestionId || undefined}
                      onChange={(value) => setForm({ ...form, dependencyQuestionId: value || '', dependencyAnswer: '' })}
                      placeholder={t('qTemplates.selectQuestion')}
                      allowClear
                      options={dependencyCandidates.map((tmpl) => ({
                        label: `[${tmpl.sortOrder}] ${tmpl.questionText}`,
                        value: tmpl.id,
                      }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">{t('qTemplates.whenAnswerIs')}</label>
                    <Select
                      className="w-full"
                      value={form.dependencyAnswer || undefined}
                      onChange={(value) => setForm({ ...form, dependencyAnswer: value || '' })}
                      placeholder={t('qTemplates.selectAnswer')}
                      disabled={!form.dependencyQuestionId}
                      allowClear
                      options={depQuestionOptions.map((o) => ({ label: o, value: o }))}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Description Box toggle */}
            <div className="border border-border-light rounded-lg p-4 bg-gray-50">
              <label className="flex items-center gap-2 text-sm font-medium mb-2">
                <input
                  type="checkbox"
                  checked={form.hasDescriptionBox}
                  onChange={(e) => setForm({ ...form, hasDescriptionBox: e.target.checked })}
                  className="rounded"
                />
                <FileTextOutlined />
                {t('qTemplates.addDescriptionBox')}
              </label>
              <p className="text-xs text-text-secondary mb-2">
                {t('qTemplates.descriptionBoxHelp')}
              </p>
              {form.hasDescriptionBox && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t('qTemplates.descriptionBoxTitleDefault').replace('{defaultTitle}', defaultDescTitle)}
                    </label>
                    <Input
                      value={form.descriptionBoxTitle}
                      onChange={(e) => setForm({ ...form, descriptionBoxTitle: e.target.value })}
                      placeholder={defaultDescTitle}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      {t('qTemplates.descBoxTitleZh')}
                    </label>
                    <Input
                      value={form.descriptionBoxTitleZh}
                      onChange={(e) => setForm({ ...form, descriptionBoxTitleZh: e.target.value })}
                      placeholder={t('qTemplates.descBoxTitleZhPlaceholder')}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="primary"
                style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
                htmlType="submit"
                disabled={saveMutation.isPending}
                data-testid="save-question-btn"
              >
                {saveMutation.isPending ? t('common.saving') : editing ? t('common.update') : t('common.create')}
              </Button>
              <Button onClick={resetForm}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Domain-grouped list */}
      {isLoading ? (
        <p className="text-text-secondary">{t('common.loading')}</p>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-lg border border-border-light p-8 text-center text-text-secondary">
          {t('qTemplates.noDomainsFound')}
        </div>
      ) : (
        groups.map((group) => {
          const isDomainCollapsed = collapsedDomains[group.domainCode] ?? true;
          const { Icon, colors } = getDomainIcon(group.domainCode);
          const filteredTemplates = showInactive
            ? group.templates
            : group.templates.filter(tmpl => tmpl.isActive);
          const hiddenCount = group.templates.length - filteredTemplates.length;
          const sectionGroups = groupBySection(filteredTemplates);

          return (
            <div key={group.domainCode} className="mb-4">
              {/* Domain header */}
              <button
                onClick={() => toggleDomain(group.domainCode)}
                className="w-full flex items-center gap-2 px-4 py-3 bg-white rounded-t-lg border border-border-light hover:bg-gray-50 transition-colors"
                data-testid={`domain-section-${group.domainCode}`}
              >
                {isDomainCollapsed ? <RightOutlined style={{ fontSize: 12 }} /> : <DownOutlined style={{ fontSize: 12 }} />}
                <span className={clsx('inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0', colors)}>
                  <Icon style={{ fontSize: 15 }} />
                </span>
                <span className="font-medium">{group.domainName}</span>
                <span className="text-xs text-text-secondary ml-1">({group.domainCode})</span>
                <span className="ml-auto text-xs text-text-secondary">
                  {t('qTemplates.questionCount').replace('{count}', String(filteredTemplates.length))}
                  {hiddenCount > 0 && ` ${t('qTemplates.hiddenCount').replace('{count}', String(hiddenCount))}`}
                </span>
              </button>

              {/* Section-grouped content */}
              {!isDomainCollapsed && (
                <div className="bg-white border border-t-0 border-border-light rounded-b-lg overflow-hidden">
                  {filteredTemplates.length === 0 ? (
                    <p className="px-4 py-6 text-center text-text-secondary text-sm">
                      {group.templates.length === 0 ? t('qTemplates.noQuestions') : t('qTemplates.allInactive')}
                    </p>
                  ) : (
                    <div className="divide-y divide-border-light">
                      {sectionGroups.map((sg, sectionIdx) => {
                        const sectionKey = `${group.domainCode}::${sg.section || '__none__'}`;
                        const isSectionCollapsed = collapsedSections[sectionKey] ?? false;
                        const sorted = [...sg.templates].sort((a, b) => a.sortOrder - b.sortOrder);

                        return (
                          <div key={sectionKey}>
                            {/* Section header */}
                            <div className="flex items-center gap-2 pl-8 pr-4 py-2.5 bg-gray-50 border-b border-border-light">
                              <button
                                onClick={() => toggleSection(sectionKey)}
                                className="flex items-center gap-2 flex-1 min-w-0 hover:text-primary-blue transition-colors"
                              >
                                {isSectionCollapsed
                                  ? <RightOutlined style={{ fontSize: 10, color: '#999' }} />
                                  : <DownOutlined style={{ fontSize: 10, color: '#999' }} />
                                }
                                <span className="font-medium text-sm truncate">
                                  {sg.section || t('qTemplates.unsectioned')}
                                </span>
                                <span className="text-xs text-text-secondary flex-shrink-0">
                                  ({sg.templates.length})
                                </span>
                              </button>

                              <div className="flex items-center gap-2 flex-shrink-0">
                                {/* Section audience selector */}
                                {canWrite && (
                                  <Select
                                    size="small"
                                    value={sg.audience}
                                    onChange={(val: string) => sectionAudienceMutation.mutate({
                                      domainCode: group.domainCode,
                                      section: sg.section,
                                      audience: val,
                                    })}
                                    options={[
                                      { label: t('qTemplates.requestor'), value: 'requestor' },
                                      { label: t('qTemplates.reviewer'), value: 'reviewer' },
                                    ]}
                                    style={{ width: 120 }}
                                  />
                                )}
                                {!canWrite && (
                                  <span className={clsx(
                                    'px-2 py-0.5 rounded text-xs',
                                    sg.audience === 'reviewer' ? 'bg-orange-100 text-orange-700' : 'bg-blue-50 text-blue-700',
                                  )}>
                                    {sg.audience === 'reviewer' ? t('qTemplates.reviewer') : t('qTemplates.requestor')}
                                  </span>
                                )}

                                {/* Section reorder buttons */}
                                {canWrite && (
                                  <>
                                    <button
                                      onClick={() => moveSectionOrder(group.domainCode, sectionGroups, sectionIdx, 'up')}
                                      disabled={sectionIdx === 0 || reorderMutation.isPending}
                                      title={t('dispatchRules.moveUp')}
                                      className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                    >
                                      <ArrowUpOutlined style={{ fontSize: 12 }} />
                                    </button>
                                    <button
                                      onClick={() => moveSectionOrder(group.domainCode, sectionGroups, sectionIdx, 'down')}
                                      disabled={sectionIdx === sectionGroups.length - 1 || reorderMutation.isPending}
                                      title={t('dispatchRules.moveDown')}
                                      className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                    >
                                      <ArrowDownOutlined style={{ fontSize: 12 }} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Questions table within section */}
                            {!isSectionCollapsed && (
                              <table className="w-full text-sm">
                                <thead className="bg-bg-gray border-b border-border-light">
                                  <tr>
                                    <th className="text-left pl-10 pr-4 py-2 font-medium">{t('scopingTemplates.question')}</th>
                                    <th className="text-center px-4 py-2 font-medium w-28 whitespace-nowrap">{t('common.type')}</th>
                                    <th className="text-left px-4 py-2 font-medium w-20">{t('common.required')}</th>
                                    <th className="text-left px-4 py-2 font-medium w-20">{t('common.status')}</th>
                                    {canWrite && <th className="text-left px-4 py-2 font-medium w-28">{t('common.operation')}</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {sorted.map((tmpl, idx) => (
                                    <tr key={tmpl.id} className={clsx('border-b border-border-light last:border-0', !tmpl.isActive && 'opacity-50')}>
                                      <td className="pl-10 pr-4 py-2">
                                        <div>
                                          <span>{tmpl.questionText}</span>
                                          {tmpl.questionTextZh && <span className="ml-1.5 text-xs px-1 py-0.5 bg-amber-50 text-amber-700 rounded">ZH</span>}
                                          {tmpl.questionImages && tmpl.questionImages.length > 0 && <span className="ml-1.5 text-xs px-1 py-0.5 bg-purple-50 text-purple-700 rounded">IMG</span>}
                                          {tmpl.questionDescription && (
                                            <p className="text-xs text-text-secondary mt-0.5">{tmpl.questionDescription}</p>
                                          )}
                                        </div>
                                        {tmpl.options && tmpl.options.length > 0 && (
                                          <div className="mt-1 flex flex-wrap gap-1">
                                            {tmpl.options.map((o, i) => (
                                              <span key={i} className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{o}</span>
                                            ))}
                                          </div>
                                        )}
                                        {/* Dependency badge */}
                                        {tmpl.dependency && (
                                          <div className="mt-1 flex items-center gap-1 text-xs text-purple-600">
                                            <LinkOutlined style={{ fontSize: 10 }} />
                                            <span>
                                              {t('qTemplates.dependsOn')} &quot;{findQuestionText(tmpl.domainCode, tmpl.dependency.questionId)}&quot; = {tmpl.dependency.answer}
                                            </span>
                                          </div>
                                        )}
                                        {/* Description box badge */}
                                        {tmpl.hasDescriptionBox && (
                                          <div className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                                            <FileTextOutlined style={{ fontSize: 10 }} />
                                            <span>{t('qTemplates.descriptionBox')} {tmpl.descriptionBoxTitle || defaultDescTitle}</span>
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-4 py-2 text-center">
                                        <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 whitespace-nowrap">
                                          {ANSWER_TYPE_LABELS[tmpl.answerType] || tmpl.answerType}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2">
                                        {canWrite ? (
                                          <Switch
                                            size="small"
                                            checked={tmpl.isRequired}
                                            onChange={() => toggleRequiredMutation.mutate({ id: tmpl.id, isRequired: !tmpl.isRequired })}
                                          />
                                        ) : (
                                          tmpl.isRequired ? '✓' : ''
                                        )}
                                      </td>
                                      <td className="px-4 py-2">
                                        <span className={clsx('px-2 py-0.5 rounded text-xs', tmpl.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                                          {tmpl.isActive ? t('common.active') : t('common.inactive')}
                                        </span>
                                      </td>
                                      {canWrite && (
                                        <td className="px-4 py-2">
                                          <div className="flex items-center gap-1">
                                            <button
                                              onClick={() => moveTemplate(tmpl.id, sg.templates, 'up')}
                                              disabled={idx === 0 || reorderMutation.isPending}
                                              title={t('dispatchRules.moveUp')}
                                              className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                            >
                                              <ArrowUpOutlined />
                                            </button>
                                            <button
                                              onClick={() => moveTemplate(tmpl.id, sg.templates, 'down')}
                                              disabled={idx === sorted.length - 1 || reorderMutation.isPending}
                                              title={t('dispatchRules.moveDown')}
                                              className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                            >
                                              <ArrowDownOutlined />
                                            </button>
                                            <button onClick={() => openEdit(tmpl)} title={t('common.edit')} className="text-primary-blue hover:text-blue-700 p-1">
                                              <EditOutlined />
                                            </button>
                                            <Switch
                                              size="small"
                                              checked={tmpl.isActive}
                                              onChange={() => toggleMutation.mutate(tmpl.id)}
                                            />
                                          </div>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

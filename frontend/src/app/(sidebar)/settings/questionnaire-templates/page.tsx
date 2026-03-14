'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ui/Toast';
import clsx from 'clsx';
import { Button, Input, Select, Switch } from 'antd';
import { PlusCircleOutlined, EditOutlined, DownOutlined, RightOutlined, CloseOutlined, PlusOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
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
}

interface DomainGroup {
  domainCode: string;
  domainName: string;
  templates: Template[];
}

const ANSWER_TYPES = ['radio', 'multiselect', 'dropdown', 'textarea'] as const;

const ANSWER_TYPE_LABELS: Record<string, string> = {
  radio: 'Single Select',
  multiselect: 'Multi Select',
  dropdown: 'Dropdown',
  textarea: 'Long Text',
};

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
};

export default function QuestionnaireTemplatesPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canWrite = hasPermission('domain_questionnaire', 'write');
  const [editing, setEditing] = useState<Template | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery<{ data: DomainGroup[] }>({
    queryKey: ['questionnaire-templates'],
    queryFn: () => api.get('/questionnaire-templates'),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api.put(`/questionnaire-templates/${editing.id}`, payload)
        : api.post('/questionnaire-templates', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['questionnaire-templates'] });
      toast(editing ? 'Question updated' : 'Question created', 'success');
      resetForm();
    },
    onError: () => toast('Failed to save question', 'error'),
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

  function resetForm() {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
  }

  function openEdit(t: Template) {
    const opts = t.options ? [...t.options] : [];
    const hasOther = opts.includes('Other');
    const filteredOpts = opts.filter((o) => o !== 'Other');
    setEditing(t);
    setForm({
      domainCode: t.domainCode,
      section: t.section || '',
      questionNo: t.questionNo,
      questionText: t.questionText,
      questionDescription: t.questionDescription || '',
      answerType: t.answerType,
      options: filteredOpts,
      includeOther: hasOther,
      isRequired: t.isRequired,
      sortOrder: t.sortOrder,
    });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.domainCode) {
      toast('Please select a domain', 'error');
      return;
    }
    if (!form.questionText.trim()) {
      toast('Question text is required', 'error');
      return;
    }

    const needsOptions = ['radio', 'multiselect', 'dropdown'].includes(form.answerType);
    const allOptions = [...form.options.filter((o) => o.trim())];
    if (form.includeOther && needsOptions) {
      allOptions.push('Other');
    }

    if (needsOptions && allOptions.length === 0) {
      toast('Please add at least one option', 'error');
      return;
    }

    const payload: Record<string, unknown> = {
      domainCode: form.domainCode,
      section: form.section || null,
      questionNo: Number(form.questionNo),
      questionText: form.questionText,
      questionDescription: form.questionDescription || null,
      answerType: form.answerType,
      options: needsOptions ? allOptions : null,
      isRequired: form.isRequired,
      sortOrder: Number(form.sortOrder),
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

  function toggleCollapse(code: string) {
    setCollapsed((prev) => ({ ...prev, [code]: !prev[code] }));
  }

  function moveTemplate(id: string, templates: Template[], direction: 'up' | 'down') {
    const sorted = [...templates].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((t) => t.id === id);
    if (idx < 0) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === sorted.length - 1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    const orders = sorted.map((t, i) => {
      let newSort = i;
      if (i === idx) newSort = swapIdx;
      if (i === swapIdx) newSort = idx;
      return { id: t.id, sortOrder: newSort };
    });
    reorderMutation.mutate(orders);
  }

  const groups = data?.data || [];
  const needsOptions = ['radio', 'multiselect', 'dropdown'].includes(form.answerType);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Questionnaire Templates</h1>
          <p className="text-sm text-text-secondary mt-1">Manage domain-specific review questionnaire templates</p>
        </div>
        {canWrite && (
          <Button
            type="primary"
            style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
            icon={<PlusCircleOutlined />}
            onClick={() => { resetForm(); setShowForm(true); }}
            data-testid="add-question-btn"
          >
            Add Question
          </Button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-border-light p-6 mb-6">
          <h2 className="font-medium mb-4">{editing ? 'Edit Question' : 'New Question'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Domain *</label>
                <Select
                  className={clsx('w-full', editing && 'bg-gray-50 text-text-secondary')}
                  value={form.domainCode || undefined}
                  onChange={(value) => setForm({ ...form, domainCode: value })}
                  disabled={!!editing}
                  placeholder="Select domain..."
                  data-testid="domain-select"
                  options={groups.map((g) => ({
                    label: `${g.domainName} (${g.domainCode})`,
                    value: g.domainCode,
                  }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Section</label>
                <Input
                  value={form.section}
                  onChange={(e) => setForm({ ...form, section: e.target.value })}
                  placeholder="e.g. General"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Question #</label>
                <Input
                  type="number"
                  value={form.questionNo}
                  onChange={(e) => setForm({ ...form, questionNo: Number(e.target.value) })}
                  min={1}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Sort Order</label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Question Text *</label>
              <Input.TextArea
                rows={2}
                value={form.questionText}
                onChange={(e) => setForm({ ...form, questionText: e.target.value })}
                required
                placeholder="Enter the question..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Question Description</label>
              <Input.TextArea
                rows={2}
                value={form.questionDescription}
                onChange={(e) => setForm({ ...form, questionDescription: e.target.value })}
                placeholder="Optional description or help text for this question..."
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Answer Type</label>
                <Select
                  className="w-full"
                  value={form.answerType}
                  onChange={(value) => setForm({ ...form, answerType: value })}
                  data-testid="answer-type-select"
                  options={ANSWER_TYPES.map((t) => ({
                    label: ANSWER_TYPE_LABELS[t],
                    value: t,
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
                  Required
                </label>
                {needsOptions && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.includeOther}
                      onChange={(e) => setForm({ ...form, includeOther: e.target.checked })}
                      className="rounded"
                    />
                    Include &quot;Other&quot; (free text)
                  </label>
                )}
              </div>
            </div>

            {/* Options editor */}
            {needsOptions && (
              <div>
                <label className="block text-sm font-medium mb-2">Options</label>
                <div className="space-y-2">
                  {form.options.map((opt, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        className="flex-1"
                        value={opt}
                        onChange={(e) => updateOption(idx, e.target.value)}
                        placeholder={`Option ${idx + 1}`}
                      />
                      <button type="button" onClick={() => removeOption(idx)} className="text-red-400 hover:text-red-600 p-1">
                        <CloseOutlined />
                      </button>
                    </div>
                  ))}
                  {form.includeOther && (
                    <div className="flex items-center gap-2">
                      <Input className="flex-1 bg-gray-50 text-text-secondary" value="Other" disabled />
                      <span className="text-xs text-text-secondary">(auto-added)</span>
                    </div>
                  )}
                  <button type="button" onClick={addOption} className="text-primary-blue text-sm flex items-center gap-1 hover:underline">
                    <PlusOutlined /> Add Option
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="primary"
                style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
                htmlType="submit"
                disabled={saveMutation.isPending}
                data-testid="save-question-btn"
              >
                {saveMutation.isPending ? 'Saving...' : editing ? 'Update' : 'Create'}
              </Button>
              <Button onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Domain-grouped list */}
      {isLoading ? (
        <p className="text-text-secondary">Loading...</p>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-lg border border-border-light p-8 text-center text-text-secondary">
          No internal domains found. Create internal domains first in Domain Management.
        </div>
      ) : (
        groups.map((group) => {
          const isCollapsed = collapsed[group.domainCode];
          const { Icon, colors } = getDomainIcon(group.domainCode);
          return (
            <div key={group.domainCode} className="mb-4">
              {/* Domain header */}
              <button
                onClick={() => toggleCollapse(group.domainCode)}
                className="w-full flex items-center gap-2 px-4 py-3 bg-white rounded-t-lg border border-border-light hover:bg-gray-50 transition-colors"
                data-testid={`domain-section-${group.domainCode}`}
              >
                {isCollapsed ? <RightOutlined style={{ fontSize: 12 }} /> : <DownOutlined style={{ fontSize: 12 }} />}
                <span className={clsx('inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0', colors)}>
                  <Icon style={{ fontSize: 15 }} />
                </span>
                <span className="font-medium">{group.domainName}</span>
                <span className="text-xs text-text-secondary ml-1">({group.domainCode})</span>
                <span className="ml-auto text-xs text-text-secondary">{group.templates.length} question{group.templates.length !== 1 ? 's' : ''}</span>
              </button>

              {/* Templates table */}
              {!isCollapsed && (
                <div className="bg-white border border-t-0 border-border-light rounded-b-lg overflow-hidden">
                  {group.templates.length === 0 ? (
                    <p className="px-4 py-6 text-center text-text-secondary text-sm">
                      No questions yet for this domain.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-bg-gray border-b border-border-light">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium w-12">#</th>
                          <th className="text-left px-4 py-2 font-medium">Question</th>
                          <th className="text-center px-4 py-2 font-medium w-28 whitespace-nowrap">Type</th>
                          <th className="text-left px-4 py-2 font-medium w-20">Required</th>
                          <th className="text-left px-4 py-2 font-medium w-20">Status</th>
                          {canWrite && <th className="text-left px-4 py-2 font-medium w-28">Operation</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const sorted = [...group.templates].sort((a, b) => a.sortOrder - b.sortOrder);
                          return sorted.map((t, idx) => (
                            <tr key={t.id} className={clsx('border-b border-border-light last:border-0', !t.isActive && 'opacity-50')}>
                              <td className="px-4 py-2">{t.questionNo}</td>
                              <td className="px-4 py-2">
                                <div>
                                  <span>{t.questionText}</span>
                                  {t.section && (
                                    <span className="ml-2 text-xs text-text-secondary bg-gray-100 px-1.5 py-0.5 rounded">{t.section}</span>
                                  )}
                                  {t.questionDescription && (
                                    <p className="text-xs text-text-secondary mt-0.5">{t.questionDescription}</p>
                                  )}
                                </div>
                                {t.options && t.options.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {t.options.map((o, i) => (
                                      <span key={i} className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{o}</span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-2 text-center">
                                <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 whitespace-nowrap">
                                  {ANSWER_TYPE_LABELS[t.answerType] || t.answerType}
                                </span>
                              </td>
                              <td className="px-4 py-2">{t.isRequired ? '✓' : ''}</td>
                              <td className="px-4 py-2">
                                <span className={clsx('px-2 py-0.5 rounded text-xs', t.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                                  {t.isActive ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              {canWrite && (
                                <td className="px-4 py-2">
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => moveTemplate(t.id, group.templates, 'up')}
                                      disabled={idx === 0 || reorderMutation.isPending}
                                      title="Move up"
                                      className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                    >
                                      <ArrowUpOutlined />
                                    </button>
                                    <button
                                      onClick={() => moveTemplate(t.id, group.templates, 'down')}
                                      disabled={idx === sorted.length - 1 || reorderMutation.isPending}
                                      title="Move down"
                                      className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                    >
                                      <ArrowDownOutlined />
                                    </button>
                                    <button onClick={() => openEdit(t)} title="Edit" className="text-primary-blue hover:text-blue-700 p-1">
                                      <EditOutlined />
                                    </button>
                                    <Switch
                                      size="small"
                                      checked={t.isActive}
                                      onChange={() => toggleMutation.mutate(t.id)}
                                    />
                                  </div>
                                </td>
                              )}
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
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

'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import clsx from 'clsx';
import { Button, Input, Select } from 'antd';
import { PlusCircleOutlined } from '@ant-design/icons';
import { useLocale } from '@/lib/locale-context';

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
  isActive: boolean;
}

const ANSWER_TYPES = ['text', 'textarea', 'select', 'multiselect', 'boolean', 'date'];

const emptyForm = {
  section: '',
  questionNo: 1,
  questionText: '',
  answerType: 'text',
  options: '',
  isRequired: false,
  helpText: '',
  triggersDomain: '',
  sortOrder: 0,
};

export default function ScopingTemplatesPage() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('intake_template', 'write');
  const [editing, setEditing] = useState<Template | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const { data, isLoading } = useQuery<{ data: Template[] }>({
    queryKey: ['intake-templates-admin', 'scoping'],
    queryFn: () => api.get('/intake/templates/admin?section_type=scoping'),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api.put(`/intake/templates/${editing.id}`, payload)
        : api.post('/intake/templates', { ...payload, sectionType: 'scoping' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['intake-templates-admin'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/intake/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['intake-templates-admin'] }),
  });

  function resetForm() {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
  }

  function openEdit(tmpl: Template) {
    setEditing(tmpl);
    setForm({
      section: tmpl.section,
      questionNo: tmpl.questionNo,
      questionText: tmpl.questionText,
      answerType: tmpl.answerType,
      options: tmpl.options ? tmpl.options.join(', ') : '',
      isRequired: tmpl.isRequired,
      helpText: tmpl.helpText || '',
      triggersDomain: tmpl.triggersDomain ? tmpl.triggersDomain.join(', ') : '',
      sortOrder: tmpl.sortOrder,
    });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      section: form.section,
      questionNo: Number(form.questionNo),
      questionText: form.questionText,
      answerType: form.answerType,
      isRequired: form.isRequired,
      helpText: form.helpText || null,
      sortOrder: Number(form.sortOrder),
    };
    if (form.options.trim()) {
      payload.options = form.options.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (form.triggersDomain.trim()) {
      payload.triggersDomain = form.triggersDomain.split(',').map((s) => s.trim()).filter(Boolean);
    }
    saveMutation.mutate(payload);
  }

  const templates = data?.data || [];
  const sections = [...new Set(templates.map((tmpl) => tmpl.section))];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">{t('scopingTemplates.title')}</h1>
          <p className="text-sm text-text-secondary mt-1">{t('scopingTemplates.subtitle')}</p>
        </div>
        {canWrite && (
          <Button
            type="primary"
            style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
            icon={<PlusCircleOutlined />}
            onClick={() => { resetForm(); setShowForm(true); }}
          >
            {t('scopingTemplates.addQuestion')}
          </Button>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="bg-white rounded-lg border border-border-light p-6 mb-6">
          <h2 className="font-medium mb-4">{editing ? t('scopingTemplates.editQuestion') : t('scopingTemplates.newQuestion')}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.section')}</label>
                <Input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('scopingTemplates.questionNo')}</label>
                <Input type="number" value={form.questionNo} onChange={(e) => setForm({ ...form, questionNo: Number(e.target.value) })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.sortOrder')}</label>
                <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">{t('scopingTemplates.questionText')}</label>
              <Input.TextArea rows={2} value={form.questionText} onChange={(e) => setForm({ ...form, questionText: e.target.value })} required />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('scopingTemplates.answerType')}</label>
                <Select
                  className="w-full"
                  value={form.answerType}
                  onChange={(value) => setForm({ ...form, answerType: value })}
                  options={ANSWER_TYPES.map((at) => ({ label: at, value: at }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('scopingTemplates.optionsLabel')}</label>
                <Input value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} placeholder={t('scopingTemplates.optionsPlaceholder')} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('scopingTemplates.triggersDomain')}</label>
                <Input value={form.triggersDomain} onChange={(e) => setForm({ ...form, triggersDomain: e.target.value })} placeholder={t('scopingTemplates.triggersDomainPlaceholder')} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('scopingTemplates.helpText')}</label>
                <Input value={form.helpText} onChange={(e) => setForm({ ...form, helpText: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input type="checkbox" id="isRequired" checked={form.isRequired} onChange={(e) => setForm({ ...form, isRequired: e.target.checked })} />
                <label htmlFor="isRequired" className="text-sm">{t('common.required')}</label>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                type="primary"
                style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
                htmlType="submit"
                disabled={saveMutation.isPending}
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

      {/* Table */}
      {isLoading ? (
        <p className="text-text-secondary">{t('common.loading')}</p>
      ) : (
        sections.map((section) => (
          <div key={section} className="mb-6">
            <h3 className="text-sm font-semibold text-text-secondary uppercase mb-2">{section}</h3>
            <div className="bg-white rounded-lg border border-border-light overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-bg-gray border-b border-border-light">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">#</th>
                    <th className="text-left px-4 py-2 font-medium">{t('scopingTemplates.question')}</th>
                    <th className="text-left px-4 py-2 font-medium">{t('common.type')}</th>
                    <th className="text-left px-4 py-2 font-medium">{t('common.required')}</th>
                    <th className="text-left px-4 py-2 font-medium">{t('scopingTemplates.triggersCol')}</th>
                    <th className="text-left px-4 py-2 font-medium">{t('common.status')}</th>
                    {canWrite && <th className="text-left px-4 py-2 font-medium">{t('common.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {templates
                    .filter((tmpl) => tmpl.section === section)
                    .sort((a, b) => a.questionNo - b.questionNo)
                    .map((tmpl) => (
                      <tr key={tmpl.id} className={clsx('border-b border-border-light last:border-0', !tmpl.isActive && 'opacity-50')}>
                        <td className="px-4 py-2">{tmpl.questionNo}</td>
                        <td className="px-4 py-2">{tmpl.questionText}</td>
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700">{tmpl.answerType}</span>
                        </td>
                        <td className="px-4 py-2">{tmpl.isRequired ? t('common.yes') : t('common.no')}</td>
                        <td className="px-4 py-2">
                          {tmpl.triggersDomain?.map((d) => (
                            <span key={d} className="px-1.5 py-0.5 rounded text-xs bg-purple-50 text-purple-700 mr-1">{d}</span>
                          ))}
                        </td>
                        <td className="px-4 py-2">
                          <span className={clsx('px-2 py-0.5 rounded text-xs', tmpl.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                            {tmpl.isActive ? t('common.active') : t('common.inactive')}
                          </span>
                        </td>
                        {canWrite && (
                          <td className="px-4 py-2">
                            <button onClick={() => openEdit(tmpl)} className="text-primary-blue hover:underline text-xs mr-2">{t('common.edit')}</button>
                            {tmpl.isActive && (
                              <button onClick={() => deleteMutation.mutate(tmpl.id)} className="text-red-500 hover:underline text-xs">{t('scopingTemplates.deactivate')}</button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {!isLoading && templates.length === 0 && (
        <div className="bg-white rounded-lg border border-border-light p-8 text-center text-text-secondary">
          {t('scopingTemplates.noTemplates')}
        </div>
      )}
    </div>
  );
}

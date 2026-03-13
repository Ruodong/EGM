'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
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

  function openEdit(t: Template) {
    setEditing(t);
    setForm({
      section: t.section,
      questionNo: t.questionNo,
      questionText: t.questionText,
      answerType: t.answerType,
      options: t.options ? t.options.join(', ') : '',
      isRequired: t.isRequired,
      helpText: t.helpText || '',
      triggersDomain: t.triggersDomain ? t.triggersDomain.join(', ') : '',
      sortOrder: t.sortOrder,
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
  const sections = [...new Set(templates.map((t) => t.section))];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Scoping Templates</h1>
          <p className="text-sm text-text-secondary mt-1">Manage scoping questions used to determine applicable domains</p>
        </div>
        {canWrite && (
          <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-teal">
            + Add Question
          </button>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="bg-white rounded-lg border border-border-light p-6 mb-6">
          <h2 className="font-medium mb-4">{editing ? 'Edit Question' : 'New Scoping Question'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Section</label>
                <input className="input-field" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Question #</label>
                <input type="number" className="input-field" value={form.questionNo} onChange={(e) => setForm({ ...form, questionNo: Number(e.target.value) })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Sort Order</label>
                <input type="number" className="input-field" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Question Text</label>
              <textarea className="input-field" rows={2} value={form.questionText} onChange={(e) => setForm({ ...form, questionText: e.target.value })} required />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Answer Type</label>
                <select className="input-field" value={form.answerType} onChange={(e) => setForm({ ...form, answerType: e.target.value })}>
                  {ANSWER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Options (comma-separated)</label>
                <input className="input-field" value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} placeholder="Yes, No" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Triggers Domain (comma-separated)</label>
                <input className="input-field" value={form.triggersDomain} onChange={(e) => setForm({ ...form, triggersDomain: e.target.value })} placeholder="BIA, RAI" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Help Text</label>
                <input className="input-field" value={form.helpText} onChange={(e) => setForm({ ...form, helpText: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input type="checkbox" id="isRequired" checked={form.isRequired} onChange={(e) => setForm({ ...form, isRequired: e.target.checked })} />
                <label htmlFor="isRequired" className="text-sm">Required</label>
              </div>
            </div>

            <div className="flex gap-2">
              <button type="submit" className="btn-teal" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving...' : editing ? 'Update' : 'Create'}
              </button>
              <button type="button" onClick={resetForm} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <p className="text-text-secondary">Loading...</p>
      ) : (
        sections.map((section) => (
          <div key={section} className="mb-6">
            <h3 className="text-sm font-semibold text-text-secondary uppercase mb-2">{section}</h3>
            <div className="bg-white rounded-lg border border-border-light overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-bg-gray border-b border-border-light">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">#</th>
                    <th className="text-left px-4 py-2 font-medium">Question</th>
                    <th className="text-left px-4 py-2 font-medium">Type</th>
                    <th className="text-left px-4 py-2 font-medium">Required</th>
                    <th className="text-left px-4 py-2 font-medium">Triggers Domain</th>
                    <th className="text-left px-4 py-2 font-medium">Status</th>
                    {canWrite && <th className="text-left px-4 py-2 font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {templates
                    .filter((t) => t.section === section)
                    .sort((a, b) => a.questionNo - b.questionNo)
                    .map((t) => (
                      <tr key={t.id} className={clsx('border-b border-border-light last:border-0', !t.isActive && 'opacity-50')}>
                        <td className="px-4 py-2">{t.questionNo}</td>
                        <td className="px-4 py-2">{t.questionText}</td>
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700">{t.answerType}</span>
                        </td>
                        <td className="px-4 py-2">{t.isRequired ? 'Yes' : 'No'}</td>
                        <td className="px-4 py-2">
                          {t.triggersDomain?.map((d) => (
                            <span key={d} className="px-1.5 py-0.5 rounded text-xs bg-purple-50 text-purple-700 mr-1">{d}</span>
                          ))}
                        </td>
                        <td className="px-4 py-2">
                          <span className={clsx('px-2 py-0.5 rounded text-xs', t.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                            {t.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        {canWrite && (
                          <td className="px-4 py-2">
                            <button onClick={() => openEdit(t)} className="text-primary-blue hover:underline text-xs mr-2">Edit</button>
                            {t.isActive && (
                              <button onClick={() => deleteMutation.mutate(t.id)} className="text-red-500 hover:underline text-xs">Deactivate</button>
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
          No scoping templates yet. Click &quot;+ Add Question&quot; to create one.
        </div>
      )}
    </div>
  );
}

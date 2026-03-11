'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import clsx from 'clsx';
import { PlusCircle, Pencil, Trash2 } from 'lucide-react';

interface DispatchRule {
  id: string;
  ruleName: string;
  domainCode: string;
  conditionType: string;
  conditionField: string | null;
  conditionOperator: string | null;
  conditionValue: unknown;
  priority: number;
  isActive: boolean;
}

interface Domain {
  id: string;
  domainCode: string;
  domainName: string;
}

const CONDITION_TYPES = ['always', 'scoping_answer', 'field_value'];
const OPERATORS = ['equals', 'not_equals', 'contains', 'in', 'gt', 'lt'];

const emptyForm = {
  ruleName: '',
  domainCode: '',
  conditionType: 'always',
  conditionField: '',
  conditionOperator: 'equals',
  conditionValue: '',
  priority: 0,
};

export default function DispatchRulesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<DispatchRule | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const { data, isLoading } = useQuery<{ data: DispatchRule[] }>({
    queryKey: ['dispatch-rules'],
    queryFn: () => api.get('/dispatch-rules'),
  });

  const { data: domainsData } = useQuery<{ data: Domain[] }>({
    queryKey: ['domains'],
    queryFn: () => api.get('/domains'),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api.put(`/dispatch-rules/${editing.id}`, payload)
        : api.post('/dispatch-rules', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatch-rules'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/dispatch-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dispatch-rules'] }),
  });

  function resetForm() {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
  }

  function openEdit(r: DispatchRule) {
    setEditing(r);
    setForm({
      ruleName: r.ruleName,
      domainCode: r.domainCode,
      conditionType: r.conditionType,
      conditionField: r.conditionField || '',
      conditionOperator: r.conditionOperator || 'equals',
      conditionValue: r.conditionValue ? JSON.stringify(r.conditionValue) : '',
      priority: r.priority,
    });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      ruleName: form.ruleName,
      domainCode: form.domainCode,
      conditionType: form.conditionType,
      priority: Number(form.priority),
    };
    if (form.conditionType !== 'always') {
      payload.conditionField = form.conditionField || null;
      payload.conditionOperator = form.conditionOperator;
      if (form.conditionValue.trim()) {
        try {
          payload.conditionValue = JSON.parse(form.conditionValue);
        } catch {
          payload.conditionValue = form.conditionValue;
        }
      }
    }
    saveMutation.mutate(payload);
  }

  const rules = data?.data || [];
  const domains = domainsData?.data || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Dispatch Rules</h1>
          <p className="text-sm text-text-secondary mt-1">Set up rules that map scoping answers to governance domains</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-teal flex items-center gap-1.5">
          <PlusCircle size={16} /> Add Rule
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-border-light p-6 mb-6">
          <h2 className="font-medium mb-4">{editing ? 'Edit Rule' : 'New Dispatch Rule'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Rule Name</label>
                <input className="input-field" value={form.ruleName} onChange={(e) => setForm({ ...form, ruleName: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Domain</label>
                <select className="input-field" value={form.domainCode} onChange={(e) => setForm({ ...form, domainCode: e.target.value })} required>
                  <option value="">Select domain...</option>
                  {domains.map((d) => (
                    <option key={d.domainCode} value={d.domainCode}>{d.domainName} ({d.domainCode})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Priority</label>
                <input type="number" className="input-field" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Condition Type</label>
                <select className="input-field" value={form.conditionType} onChange={(e) => setForm({ ...form, conditionType: e.target.value })}>
                  {CONDITION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {form.conditionType !== 'always' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Condition Field</label>
                    <input className="input-field" value={form.conditionField} onChange={(e) => setForm({ ...form, conditionField: e.target.value })} placeholder="template_id or field name" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Operator</label>
                    <select className="input-field" value={form.conditionOperator} onChange={(e) => setForm({ ...form, conditionOperator: e.target.value })}>
                      {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                </>
              )}
            </div>

            {form.conditionType !== 'always' && (
              <div>
                <label className="block text-sm font-medium mb-1">Condition Value (JSON)</label>
                <input className="input-field" value={form.conditionValue} onChange={(e) => setForm({ ...form, conditionValue: e.target.value })} placeholder='"Yes" or ["val1", "val2"]' />
              </div>
            )}

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
        <div className="bg-white rounded-lg border border-border-light overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-gray border-b border-border-light">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Rule Name</th>
                <th className="text-left px-4 py-2 font-medium">Domain</th>
                <th className="text-left px-4 py-2 font-medium">Condition</th>
                <th className="text-left px-4 py-2 font-medium">Priority</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Operation</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className={clsx('border-b border-border-light last:border-0', !r.isActive && 'opacity-50')}>
                  <td className="px-4 py-2 font-medium">{r.ruleName}</td>
                  <td className="px-4 py-2">
                    <span className="px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-700">{r.domainCode}</span>
                  </td>
                  <td className="px-4 py-2 text-text-secondary">
                    {r.conditionType === 'always' ? (
                      <span className="text-xs italic">Always</span>
                    ) : (
                      <span className="text-xs">{r.conditionField} {r.conditionOperator} {JSON.stringify(r.conditionValue)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{r.priority}</td>
                  <td className="px-4 py-2">
                    <span className={clsx('px-2 py-0.5 rounded text-xs', r.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                      {r.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(r)} title="Edit" className="text-primary-blue hover:text-blue-700 p-1">
                        <Pencil size={16} />
                      </button>
                      {r.isActive && (
                        <button onClick={() => deleteMutation.mutate(r.id)} title="Deactivate" className="text-blue-400 hover:text-red-600 p-1">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && rules.length === 0 && (
        <div className="bg-white rounded-lg border border-border-light p-8 text-center text-text-secondary">
          No dispatch rules yet. Click &quot;+ Add Rule&quot; to create one.
        </div>
      )}
    </div>
  );
}

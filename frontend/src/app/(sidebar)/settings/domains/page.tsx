'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import clsx from 'clsx';
import { PlusCircle, Pencil, ToggleLeft, ToggleRight } from 'lucide-react';
import { getDomainIcon } from '@/lib/domain-icons';

interface Domain {
  id: string;
  domainCode: string;
  domainName: string;
  description: string | null;
  integrationType: string;
  externalBaseUrl: string | null;
  icon: string | null;
  isActive: boolean;
  config: unknown;
}

const emptyForm = {
  domainCode: '',
  domainName: '',
  description: '',
  integrationType: 'internal',
  externalBaseUrl: '',
};

export default function DomainManagementPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Domain | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [showInactive, setShowInactive] = useState(false);

  const { data, isLoading } = useQuery<{ data: Domain[] }>({
    queryKey: ['domains-management', showInactive],
    queryFn: () => api.get('/domains', { includeInactive: showInactive }),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api.put(`/domains/${editing.domainCode}`, payload)
        : api.post('/domains', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['domains-management'] });
      resetForm();
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (code: string) => api.delete(`/domains/${code}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains-management'] }),
  });

  function resetForm() {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
  }

  function openEdit(d: Domain) {
    setEditing(d);
    setForm({
      domainCode: d.domainCode,
      domainName: d.domainName,
      description: d.description || '',
      integrationType: d.integrationType,
      externalBaseUrl: d.externalBaseUrl || '',
    });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      domainName: form.domainName,
      description: form.description || null,
      integrationType: form.integrationType,
      externalBaseUrl: form.externalBaseUrl || null,
    };
    if (!editing) {
      payload.domainCode = form.domainCode;
    }
    saveMutation.mutate(payload);
  }

  const domains = data?.data || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Domain Management</h1>
          <p className="text-sm text-text-secondary mt-1">Create, edit and manage governance domain definitions</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="btn-teal flex items-center gap-1.5"
          data-testid="add-domain-btn"
        >
          <PlusCircle size={16} /> Add Domain
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-border-light p-6 mb-6">
          <h2 className="font-medium mb-4">{editing ? 'Edit Domain' : 'New Domain'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Domain Code</label>
                <input
                  className={clsx('input-field w-full', editing && 'bg-gray-50 text-text-secondary')}
                  value={form.domainCode}
                  onChange={(e) => setForm({ ...form, domainCode: e.target.value.toUpperCase() })}
                  disabled={!!editing}
                  required
                  placeholder="e.g. EA, BIA"
                  data-testid="domain-code-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Domain Name</label>
                <input
                  className="input-field w-full"
                  value={form.domainName}
                  onChange={(e) => setForm({ ...form, domainName: e.target.value })}
                  required
                  placeholder="Enterprise Architecture"
                  data-testid="domain-name-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Integration Type</label>
                <select
                  className="input-field w-full"
                  value={form.integrationType}
                  onChange={(e) => setForm({ ...form, integrationType: e.target.value })}
                  data-testid="integration-type-select"
                >
                  <option value="internal">Internal</option>
                  <option value="external">External</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  className="input-field w-full"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  placeholder="Brief description of this governance domain..."
                />
              </div>
              {form.integrationType === 'external' && (
                <div>
                  <label className="block text-sm font-medium mb-1">External Base URL</label>
                  <input
                    className="input-field w-full"
                    value={form.externalBaseUrl}
                    onChange={(e) => setForm({ ...form, externalBaseUrl: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button type="submit" className="btn-teal" disabled={saveMutation.isPending} data-testid="save-domain-btn">
                {saveMutation.isPending ? 'Saving...' : editing ? 'Update' : 'Create'}
              </button>
              <button type="button" onClick={resetForm} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Toggle inactive */}
      <div className="mb-4 flex items-center gap-2">
        <label className="text-sm text-text-secondary flex items-center gap-2">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
            data-testid="show-inactive-toggle"
          />
          Show inactive domains
        </label>
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-text-secondary">Loading...</p>
      ) : (
        <div className="bg-white rounded-lg border border-border-light overflow-hidden">
          <table className="w-full text-sm" data-testid="domains-table">
            <thead className="bg-bg-gray border-b border-border-light">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Code</th>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Operation</th>
              </tr>
            </thead>
            <tbody>
              {domains.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-secondary">
                    No domains found. Click &quot;+ Add Domain&quot; to create one.
                  </td>
                </tr>
              ) : (
                domains.map((d) => {
                  const { Icon, colors } = getDomainIcon(d.domainCode);
                  return (
                    <tr
                      key={d.id}
                      className={clsx('border-b border-border-light last:border-0', !d.isActive && 'opacity-50')}
                    >
                      <td className="px-4 py-2">
                        <span className="px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-700 font-medium font-mono">
                          {d.domainCode}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className={clsx('inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0', colors)}>
                            <Icon size={15} />
                          </span>
                          <span className="font-medium">{d.domainName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span className={clsx(
                          'px-2 py-0.5 rounded text-xs',
                          d.integrationType === 'external' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                        )}>
                          {d.integrationType}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className={clsx(
                          'px-2 py-0.5 rounded text-xs',
                          d.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        )}>
                          {d.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(d)} title="Edit" className="text-primary-blue hover:text-blue-700 p-1">
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => toggleActiveMutation.mutate(d.domainCode)}
                            title={d.isActive ? 'Deactivate' : 'Activate'}
                            className={clsx('p-1', d.isActive ? 'text-green-500 hover:text-red-500' : 'text-gray-400 hover:text-green-600')}
                            data-testid={d.isActive ? `deactivate-${d.domainCode}` : `reactivate-${d.domainCode}`}
                          >
                            {d.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import clsx from 'clsx';
import { Button, Input, Select, Switch } from 'antd';
import { PlusCircleOutlined, EditOutlined } from '@ant-design/icons';
import { getDomainIcon } from '@/lib/domain-icons';
import { useLocale } from '@/lib/locale-context';

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
  const { t } = useLocale();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('domain_registry', 'write');
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
          <h1 className="text-xl font-bold">{t('domainMgmt.title')}</h1>
          <p className="text-sm text-text-secondary mt-1">{t('domainMgmt.subtitle')}</p>
        </div>
        {canWrite && (
          <Button
            type="primary"
            style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
            icon={<PlusCircleOutlined />}
            onClick={() => { resetForm(); setShowForm(true); }}
            data-testid="add-domain-btn"
          >
            {t('domainMgmt.addDomain')}
          </Button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-border-light p-6 mb-6">
          <h2 className="font-medium mb-4">{editing ? t('domainMgmt.editDomain') : t('domainMgmt.newDomain')}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('domainMgmt.domainCode')}</label>
                <Input
                  className={clsx(editing && 'bg-gray-50 text-text-secondary')}
                  value={form.domainCode}
                  onChange={(e) => setForm({ ...form, domainCode: e.target.value.toUpperCase() })}
                  disabled={!!editing}
                  required
                  placeholder={t('domainMgmt.domainCodePlaceholder')}
                  data-testid="domain-code-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('domainMgmt.domainName')}</label>
                <Input
                  value={form.domainName}
                  onChange={(e) => setForm({ ...form, domainName: e.target.value })}
                  required
                  placeholder={t('domainMgmt.domainNamePlaceholder')}
                  data-testid="domain-name-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('domainMgmt.integrationType')}</label>
                <Select
                  className="w-full"
                  value={form.integrationType}
                  onChange={(value) => setForm({ ...form, integrationType: value })}
                  data-testid="integration-type-select"
                  options={[
                    { label: t('domainMgmt.internal'), value: 'internal' },
                    { label: t('domainMgmt.external'), value: 'external' },
                  ]}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.description')}</label>
                <Input.TextArea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  placeholder={t('domainMgmt.descriptionPlaceholder')}
                />
              </div>
              {form.integrationType === 'external' && (
                <div>
                  <label className="block text-sm font-medium mb-1">{t('domainMgmt.externalBaseUrl')}</label>
                  <Input
                    value={form.externalBaseUrl}
                    onChange={(e) => setForm({ ...form, externalBaseUrl: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="primary"
                style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
                htmlType="submit"
                disabled={saveMutation.isPending}
                data-testid="save-domain-btn"
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
          {t('domainMgmt.showInactive')}
        </label>
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-text-secondary">{t('common.loading')}</p>
      ) : (
        <div className="bg-white rounded-lg border border-border-light overflow-hidden">
          <table className="w-full text-sm" data-testid="domains-table">
            <thead className="bg-bg-gray border-b border-border-light">
              <tr>
                <th className="text-left px-4 py-2 font-medium">{t('common.code')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('common.name')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('common.type')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('common.status')}</th>
                {canWrite && <th className="text-left px-4 py-2 font-medium">{t('common.operation')}</th>}
              </tr>
            </thead>
            <tbody>
              {domains.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-secondary">
                    {t('domainMgmt.noDomains')}
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
                        <span className="px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-700 font-medium">
                          {d.domainCode}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className={clsx('inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0', colors)}>
                            <Icon style={{ fontSize: 15 }} />
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
                          {d.isActive ? t('common.active') : t('common.inactive')}
                        </span>
                      </td>
                      {canWrite && (
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1">
                            <button onClick={() => openEdit(d)} title={t('common.edit')} className="text-primary-blue hover:text-blue-700 p-1">
                              <EditOutlined />
                            </button>
                            <Switch
                              size="small"
                              checked={d.isActive}
                              onChange={() => toggleActiveMutation.mutate(d.domainCode)}
                              data-testid={d.isActive ? `deactivate-${d.domainCode}` : `reactivate-${d.domainCode}`}
                            />
                          </div>
                        </td>
                      )}
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

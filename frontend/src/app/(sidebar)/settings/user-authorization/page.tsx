'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import clsx from 'clsx';
import { Button, Input } from 'antd';
import { PlusCircleOutlined, EditOutlined, DeleteOutlined, SafetyCertificateOutlined, WarningOutlined, UserOutlined } from '@ant-design/icons';
import { useLocale } from '@/lib/locale-context';

interface Employee {
  itcode: string;
  name: string | null;
  email: string | null;
  jobRole: string | null;
  workerType: string | null;
  country: string | null;
  tier1Org: string | null;
  tier2Org: string | null;
}

interface RoleEntry {
  id: string;
  role: string;
  domainCodes?: string[];
  assignedBy: string | null;
  assignedByName: string | null;
  assignedAt: string | null;
}

interface UserWithRoles {
  itcode: string;
  name: string | null;
  email: string | null;
  tier1Org: string | null;
  tier2Org: string | null;
  roles: RoleEntry[];
}

interface DomainItem {
  domainCode: string;
  domainName: string;
}

const ROLES = ['admin', 'governance_lead', 'domain_reviewer', 'requestor'] as const;

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700 border border-red-300',
  governance_lead: 'bg-blue-100 text-blue-700 border border-blue-300',
  domain_reviewer: 'bg-purple-100 text-purple-700 border border-purple-300',
  requestor: 'bg-green-100 text-green-700 border border-green-300',
};

export default function UserAuthorizationPage() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('user_authorization', 'write');
  const [showForm, setShowForm] = useState(false);

  const ROLE_LABELS: Record<string, string> = {
    admin: t('userAuth.adminLabel'),
    governance_lead: t('userAuth.govLeadLabel'),
    domain_reviewer: t('userAuth.reviewerLabel'),
    requestor: t('userAuth.requestorLabel'),
  };

  const ROLE_DEFINITIONS: { role: string; icon: typeof WarningOutlined; color: string; description: string }[] = [
    {
      role: 'admin',
      icon: WarningOutlined,
      color: 'border-red-200 bg-red-50',
      description: t('userAuth.adminDesc'),
    },
    {
      role: 'governance_lead',
      icon: SafetyCertificateOutlined,
      color: 'border-blue-200 bg-blue-50',
      description: t('userAuth.govLeadDesc'),
    },
    {
      role: 'domain_reviewer',
      icon: SafetyCertificateOutlined,
      color: 'border-purple-200 bg-purple-50',
      description: t('userAuth.reviewerDesc'),
    },
    {
      role: 'requestor',
      icon: UserOutlined,
      color: 'border-green-200 bg-green-50',
      description: t('userAuth.requestorDesc'),
    },
  ];

  // Employee search state
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const searchRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Inline edit state for domain_reviewer domains
  const [editingUser, setEditingUser] = useState<{
    itcode: string;
    role: string;
    domainCodes: Set<string>;
  } | null>(null);

  // Role list search
  const [roleSearch, setRoleSearch] = useState('');
  const [debouncedRoleSearch, setDebouncedRoleSearch] = useState('');
  const roleSearchRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleRoleSearchChange = useCallback((value: string) => {
    setRoleSearch(value);
    if (roleSearchRef.current) clearTimeout(roleSearchRef.current);
    roleSearchRef.current = setTimeout(() => setDebouncedRoleSearch(value), 300);
  }, []);

  // Employee search query
  const { data: employeeResults } = useQuery<{ data: Employee[] }>({
    queryKey: ['employee-search', debouncedSearch],
    queryFn: () => api.get('/user-authorization/employees', { search: debouncedSearch }),
    enabled: debouncedSearch.length >= 2,
  });

  // Role list query
  const { data: rolesData, isLoading } = useQuery<{ data: UserWithRoles[]; total: number }>({
    queryKey: ['user-roles', debouncedRoleSearch],
    queryFn: () => api.get('/user-authorization/roles', {
      pageSize: 100,
      ...(debouncedRoleSearch && { search: debouncedRoleSearch }),
    }),
  });

  // Domains query (for domain_reviewer assignment)
  const { data: domainsData } = useQuery<{ data: DomainItem[] }>({
    queryKey: ['domains-list'],
    queryFn: () => api.get('/domains'),
  });

  const assignMutation = useMutation({
    mutationFn: async (payload: { itcode: string; roles: string[]; domainCodes: string[] }) => {
      // Assign each role separately
      const results = [];
      for (const role of payload.roles) {
        const body: Record<string, unknown> = { itcode: payload.itcode, role };
        if (role === 'domain_reviewer') {
          body.domainCodes = payload.domainCodes;
        }
        results.push(await api.post('/user-authorization/roles', body));
      }
      return results;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-roles'] });
      resetForm();
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: ({ itcode, role }: { itcode: string; role: string }) =>
      api.delete(`/user-authorization/roles/${itcode}/${role}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-roles'] }),
  });

  const deleteAllMutation = useMutation({
    mutationFn: (itcode: string) => api.delete(`/user-authorization/roles/${itcode}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-roles'] }),
  });

  const updateDomainsMutation = useMutation({
    mutationFn: ({ itcode, role, domainCodes }: { itcode: string; role: string; domainCodes: string[] }) =>
      api.put(`/user-authorization/roles/${itcode}/${role}`, { domainCodes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-roles'] });
      setEditingUser(null);
    },
  });

  function resetForm() {
    setShowForm(false);
    setSelectedEmployee(null);
    setEmployeeSearch('');
    setDebouncedSearch('');
    setSelectedRoles(new Set());
    setSelectedDomains(new Set());
    setShowDropdown(false);
  }

  function handleEmployeeSearchChange(value: string) {
    setEmployeeSearch(value);
    setSelectedEmployee(null);
    setShowDropdown(true);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setDebouncedSearch(value), 300);
  }

  function selectEmployee(emp: Employee) {
    setSelectedEmployee(emp);
    setEmployeeSearch(emp.name ? `${emp.name} (${emp.itcode})` : emp.itcode);
    setShowDropdown(false);
  }

  function toggleRole(role: string) {
    setSelectedRoles(prev => {
      const next = new Set(prev);
      if (next.has(role)) {
        next.delete(role);
        // Clear domains if domain_reviewer is deselected
        if (role === 'domain_reviewer') setSelectedDomains(new Set());
      } else {
        next.add(role);
      }
      return next;
    });
  }

  function toggleDomain(code: string) {
    setSelectedDomains(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEmployee || selectedRoles.size === 0) return;
    if (selectedRoles.has('domain_reviewer') && selectedDomains.size === 0) return;
    assignMutation.mutate({
      itcode: selectedEmployee.itcode,
      roles: Array.from(selectedRoles),
      domainCodes: Array.from(selectedDomains),
    });
  }

  function toggleEditDomain(code: string) {
    if (!editingUser) return;
    setEditingUser(prev => {
      if (!prev) return null;
      const next = new Set(prev.domainCodes);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return { ...prev, domainCodes: next };
    });
  }

  function handleEditSave() {
    if (!editingUser || editingUser.domainCodes.size === 0) return;
    updateDomainsMutation.mutate({
      itcode: editingUser.itcode,
      role: editingUser.role,
      domainCodes: Array.from(editingUser.domainCodes),
    });
  }

  const users = rolesData?.data || [];
  const domains = domainsData?.data || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">{t('userAuth.title')}</h1>
          <p className="text-sm text-text-secondary mt-1">{t('userAuth.subtitle')}</p>
        </div>
        {canWrite && (
          <Button
            type="primary"
            style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
            icon={<PlusCircleOutlined />}
            onClick={() => { resetForm(); setShowForm(true); }}
            data-testid="assign-role-btn"
          >
            {t('userAuth.assignRole')}
          </Button>
        )}
      </div>

      {/* Role Definitions Panel */}
      <div className="grid grid-cols-4 gap-3 mb-6" data-testid="role-definitions">
        {ROLE_DEFINITIONS.map(({ role, icon: RoleIcon, color, description }) => (
          <div key={role} className={clsx('rounded-lg border p-4', color)}>
            <div className="flex items-center gap-2 mb-2">
              <RoleIcon style={{ fontSize: 18 }} />
              <span className="font-semibold text-sm">{ROLE_LABELS[role]}</span>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed">{description}</p>
          </div>
        ))}
      </div>

      {/* Assign Form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-border-light p-6 mb-6">
          <h2 className="font-medium mb-4">{t('userAuth.assignRoles')}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Employee Search */}
            <div className="relative">
              <label className="block text-sm font-medium mb-1">{t('userAuth.employee')}</label>
              <Input
                placeholder={t('userAuth.searchPlaceholder')}
                value={employeeSearch}
                onChange={(e) => handleEmployeeSearchChange(e.target.value)}
                onFocus={() => setShowDropdown(true)}
                data-testid="employee-search"
              />
              {showDropdown && employeeResults?.data && employeeResults.data.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-border-light rounded-lg shadow-lg max-h-60 overflow-auto">
                  {employeeResults.data.map((emp) => (
                    <button
                      key={emp.itcode}
                      type="button"
                      className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm"
                      onClick={() => selectEmployee(emp)}
                    >
                      <span className="font-medium">{emp.name || emp.itcode}</span>
                      <span className="text-text-secondary ml-2">({emp.itcode})</span>
                      {emp.email && <span className="text-text-secondary ml-2">· {emp.email}</span>}
                    </button>
                  ))}
                </div>
              )}
              {selectedEmployee && (
                <p className="text-xs text-text-secondary mt-1">
                  {t('userAuth.selected').replace('{name}', selectedEmployee.name || '').replace('{itcode}', selectedEmployee.itcode)}
                  {selectedEmployee.tier1Org && ` · ${selectedEmployee.tier1Org}`}
                </p>
              )}
            </div>

            {/* Role Checkboxes */}
            <div>
              <label className="block text-sm font-medium mb-2">{t('userAuth.roles')}</label>
              <div className="flex flex-wrap gap-3">
                {ROLES.map((role) => (
                  <label
                    key={role}
                    className={clsx(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors',
                      selectedRoles.has(role)
                        ? ROLE_COLORS[role]
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedRoles.has(role)}
                      onChange={() => toggleRole(role)}
                      className="rounded"
                      data-testid={`role-checkbox-${role}`}
                    />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
            </div>

            {/* Domain Selection (shown when domain_reviewer is selected) */}
            {selectedRoles.has('domain_reviewer') && (
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('userAuth.assignedDomains')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {domains.map((d) => (
                    <label
                      key={d.domainCode}
                      className={clsx(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-sm transition-colors',
                        selectedDomains.has(d.domainCode)
                          ? 'bg-purple-100 text-purple-700 border-purple-300'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedDomains.has(d.domainCode)}
                        onChange={() => toggleDomain(d.domainCode)}
                        className="rounded"
                        data-testid={`domain-checkbox-${d.domainCode}`}
                      />
                      {d.domainName} ({d.domainCode})
                    </label>
                  ))}
                </div>
                {selectedRoles.has('domain_reviewer') && selectedDomains.size === 0 && (
                  <p className="text-xs text-red-500 mt-1">{t('userAuth.selectDomain')}</p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="primary"
                style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
                htmlType="submit"
                disabled={
                  assignMutation.isPending ||
                  !selectedEmployee ||
                  selectedRoles.size === 0 ||
                  (selectedRoles.has('domain_reviewer') && selectedDomains.size === 0)
                }
                data-testid="save-role-btn"
              >
                {assignMutation.isPending ? t('common.saving') : t('userAuth.assign')}
              </Button>
              <Button onClick={resetForm}>
                {t('common.cancel')}
              </Button>
            </div>
            {assignMutation.isError && (
              <p className="text-sm text-red-500">
                {(assignMutation.error as Error)?.message || t('userAuth.failedAssign')}
              </p>
            )}
          </form>
        </div>
      )}

      {/* Role Search */}
      <div className="mb-4">
        <Input
          type="text"
          placeholder={t('userAuth.filterPlaceholder')}
          value={roleSearch}
          onChange={(e) => handleRoleSearchChange(e.target.value)}
          style={{ width: 256 }}
          data-testid="role-search"
        />
      </div>

      {/* Users & Roles Table */}
      {isLoading ? (
        <p className="text-text-secondary">{t('common.loading')}</p>
      ) : (
        <div className="bg-white rounded-lg border border-border-light overflow-hidden">
          <table className="w-full text-sm" data-testid="roles-table">
            <thead className="bg-bg-gray border-b border-border-light">
              <tr>
                <th className="text-left px-4 py-2 font-medium">{t('common.name')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('userAuth.itcode')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('userAuth.roles')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('userAuth.organization')}</th>
                {canWrite && <th className="text-left px-4 py-2 font-medium">{t('common.operation')}</th>}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-secondary">
                    {t('userAuth.noAssignments')}
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <React.Fragment key={u.itcode}>
                  <tr className="border-b border-border-light last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{u.name || '-'}</td>
                    <td className="px-4 py-2 text-text-secondary">{u.itcode}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <div key={r.id} className="flex items-center gap-1">
                            <span className={clsx(
                              'px-2 py-0.5 rounded text-xs inline-block',
                              ROLE_COLORS[r.role] || 'bg-gray-100 text-gray-600 border border-gray-300'
                            )}>
                              {ROLE_LABELS[r.role] || r.role}
                            </span>
                            {r.role === 'domain_reviewer' && r.domainCodes && r.domainCodes.length > 0 && (
                              <span className="text-xs text-purple-600">
                                ({r.domainCodes.join(', ')})
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-text-secondary">{u.tier1Org || '-'}</td>
                    {canWrite && (
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          {u.roles.map((r) => (
                            <div key={r.id} className="flex items-center">
                              {r.role === 'domain_reviewer' && (
                                <button
                                  onClick={() => setEditingUser({
                                    itcode: u.itcode,
                                    role: r.role,
                                    domainCodes: new Set(r.domainCodes || []),
                                  })}
                                  title={t('userAuth.editDomains')}
                                  className="text-blue-400 hover:text-blue-600 p-1"
                                  data-testid={`edit-role-${u.itcode}-${r.role}`}
                                >
                                  <EditOutlined style={{ fontSize: 14 }} />
                                </button>
                              )}
                              <button
                                onClick={() => deleteRoleMutation.mutate({ itcode: u.itcode, role: r.role })}
                                title={`${t('common.remove')} ${ROLE_LABELS[r.role] || r.role}`}
                                className="text-blue-400 hover:text-red-600 p-1"
                                data-testid={`remove-role-${u.itcode}-${r.role}`}
                              >
                                <DeleteOutlined style={{ fontSize: 14 }} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                  {/* Inline domain editor row */}
                  {editingUser && editingUser.itcode === u.itcode && editingUser.role === 'domain_reviewer' && (
                    <tr className="bg-purple-50 border-b border-border-light" data-testid={`edit-row-${u.itcode}`}>
                      <td colSpan={5} className="px-4 py-3">
                        <div className="flex items-start gap-4">
                          <div className="flex-1">
                            <label className="block text-sm font-medium mb-2">
                              {t('userAuth.editDomainsFor').replace('{name}', u.name || u.itcode)}
                            </label>
                            <div className="flex flex-wrap gap-2">
                              {domains.map((d) => (
                                <label
                                  key={d.domainCode}
                                  className={clsx(
                                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-sm transition-colors',
                                    editingUser.domainCodes.has(d.domainCode)
                                      ? 'bg-purple-100 text-purple-700 border-purple-300'
                                      : 'border-gray-200 bg-white hover:bg-gray-50'
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    checked={editingUser.domainCodes.has(d.domainCode)}
                                    onChange={() => toggleEditDomain(d.domainCode)}
                                    className="rounded"
                                    data-testid={`edit-domain-checkbox-${d.domainCode}`}
                                  />
                                  {d.domainName} ({d.domainCode})
                                </label>
                              ))}
                            </div>
                            {editingUser.domainCodes.size === 0 && (
                              <p className="text-xs text-red-500 mt-1">{t('userAuth.selectDomain')}</p>
                            )}
                          </div>
                          <div className="flex gap-2 pt-6">
                            <Button
                              type="primary"
                              style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
                              size="small"
                              onClick={handleEditSave}
                              disabled={updateDomainsMutation.isPending || editingUser.domainCodes.size === 0}
                              data-testid="edit-domains-save"
                            >
                              {updateDomainsMutation.isPending ? t('common.saving') : t('common.save')}
                            </Button>
                            <Button
                              size="small"
                              onClick={() => setEditingUser(null)}
                              data-testid="edit-domains-cancel"
                            >
                              {t('common.cancel')}
                            </Button>
                          </div>
                        </div>
                        {updateDomainsMutation.isError && (
                          <p className="text-sm text-red-500 mt-2">
                            {(updateDomainsMutation.error as Error)?.message || t('userAuth.failedUpdate')}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

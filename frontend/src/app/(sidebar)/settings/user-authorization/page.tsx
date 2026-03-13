'use client';

import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import clsx from 'clsx';
import { PlusCircle, Pencil, Trash2 } from 'lucide-react';

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

interface UserRole {
  id: string;
  itcode: string;
  role: string;
  name: string | null;
  email: string | null;
  tier1Org: string | null;
  tier2Org: string | null;
  assignedBy: string | null;
  assignedByName: string | null;
  assignedAt: string | null;
  updateBy: string | null;
  updateAt: string | null;
}

const ROLES = ['admin', 'governance_lead', 'domain_reviewer', 'requestor', 'viewer'];

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  governance_lead: 'Governance Lead',
  domain_reviewer: 'Domain Reviewer',
  requestor: 'Requestor',
  viewer: 'Viewer',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700 border border-red-300',
  governance_lead: 'bg-blue-100 text-blue-700 border border-blue-300',
  domain_reviewer: 'bg-purple-100 text-purple-700 border border-purple-300',
  requestor: 'bg-green-100 text-green-700 border border-green-300',
  viewer: 'bg-gray-100 text-gray-600 border border-gray-300',
};

export default function UserAuthorizationPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingItcode, setEditingItcode] = useState<string | null>(null);

  // Employee search state
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedRole, setSelectedRole] = useState('viewer');
  const searchRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [debouncedSearch, setDebouncedSearch] = useState('');

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
  const { data: rolesData, isLoading } = useQuery<{ data: UserRole[]; total: number }>({
    queryKey: ['user-roles', debouncedRoleSearch],
    queryFn: () => api.get('/user-authorization/roles', {
      pageSize: 100,
      ...(debouncedRoleSearch && { search: debouncedRoleSearch }),
    }),
  });

  const assignMutation = useMutation({
    mutationFn: (payload: { itcode: string; role: string }) =>
      editingItcode
        ? api.put(`/user-authorization/roles/${editingItcode}`, { role: payload.role })
        : api.post('/user-authorization/roles', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-roles'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (itcode: string) => api.delete(`/user-authorization/roles/${itcode}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-roles'] }),
  });

  function resetForm() {
    setShowForm(false);
    setEditingItcode(null);
    setSelectedEmployee(null);
    setEmployeeSearch('');
    setDebouncedSearch('');
    setSelectedRole('viewer');
    setShowDropdown(false);
  }

  function openEdit(role: UserRole) {
    setEditingItcode(role.itcode);
    setSelectedEmployee({ itcode: role.itcode, name: role.name, email: role.email, jobRole: null, workerType: null, country: null, tier1Org: role.tier1Org, tier2Org: role.tier2Org });
    setSelectedRole(role.role);
    setEmployeeSearch(role.name || role.itcode);
    setShowForm(true);
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const itcode = editingItcode || selectedEmployee?.itcode;
    if (!itcode || !selectedRole) return;
    assignMutation.mutate({ itcode, role: selectedRole });
  }

  const roles = rolesData?.data || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">User Authorization</h1>
          <p className="text-sm text-text-secondary mt-1">Search employees and assign EGM roles</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="btn-teal flex items-center gap-1.5"
          data-testid="assign-role-btn"
        >
          <PlusCircle size={16} /> Assign Role
        </button>
      </div>

      {/* Assign / Edit Form */}
      {showForm && (
        <div className="bg-white rounded-lg border border-border-light p-6 mb-6">
          <h2 className="font-medium mb-4">{editingItcode ? 'Edit Role' : 'Assign Role'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Employee Search */}
              <div className="relative">
                <label className="block text-sm font-medium mb-1">Employee</label>
                {editingItcode ? (
                  <div className="input-field bg-gray-50 text-text-secondary">
                    {selectedEmployee?.name || editingItcode} ({editingItcode})
                  </div>
                ) : (
                  <>
                    <input
                      className="input-field w-full"
                      placeholder="Search by name, itcode, or email..."
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
                        Selected: {selectedEmployee.name} ({selectedEmployee.itcode})
                        {selectedEmployee.tier1Org && ` · ${selectedEmployee.tier1Org}`}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Role Selection */}
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <select
                  className="input-field w-full"
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  data-testid="role-select"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                className="btn-teal"
                disabled={assignMutation.isPending || (!editingItcode && !selectedEmployee)}
                data-testid="save-role-btn"
              >
                {assignMutation.isPending ? 'Saving...' : editingItcode ? 'Update' : 'Assign'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Role Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Filter roles by name or itcode..."
          value={roleSearch}
          onChange={(e) => handleRoleSearchChange(e.target.value)}
          className="input-field w-64"
          data-testid="role-search"
        />
      </div>

      {/* Roles Table */}
      {isLoading ? (
        <p className="text-text-secondary">Loading...</p>
      ) : (
        <div className="bg-white rounded-lg border border-border-light overflow-hidden">
          <table className="w-full text-sm" data-testid="roles-table">
            <thead className="bg-bg-gray border-b border-border-light">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">ITCode</th>
                <th className="text-left px-4 py-2 font-medium">Role</th>
                <th className="text-left px-4 py-2 font-medium">Organization</th>
                <th className="text-left px-4 py-2 font-medium">Assigned By</th>
                <th className="text-left px-4 py-2 font-medium">Operation</th>
              </tr>
            </thead>
            <tbody>
              {roles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-secondary">
                    No role assignments yet. Click &quot;+ Assign Role&quot; to get started.
                  </td>
                </tr>
              ) : (
                roles.map((r) => (
                  <tr key={r.id} className="border-b border-border-light last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{r.name || '-'}</td>
                    <td className="px-4 py-2 text-text-secondary">{r.itcode}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={clsx('px-2 py-0.5 rounded text-xs inline-block min-w-[80px]', ROLE_COLORS[r.role] || 'bg-gray-100 text-gray-600 border border-gray-300')}>
                        {ROLE_LABELS[r.role] || r.role}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-text-secondary">{r.tier1Org || '-'}</td>
                    <td className="px-4 py-2 text-text-secondary">{r.assignedByName || r.assignedBy || '-'}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(r)} title="Edit" className="text-primary-blue hover:text-blue-700 p-1">
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => deleteMutation.mutate(r.itcode)}
                          title="Remove"
                          className="text-blue-400 hover:text-red-600 p-1"
                          data-testid={`remove-role-${r.itcode}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

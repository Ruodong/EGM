'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import clsx from 'clsx';
import { PlusCircle, Pencil, ToggleLeft, ToggleRight, Save, ChevronRight, ChevronDown, ArrowUp, ArrowDown, Plus } from 'lucide-react';

interface DispatchRule {
  id: string;
  ruleCode: string;
  ruleName: string;
  description: string | null;
  parentRuleCode: string | null;
  sortOrder: number;
  isActive: boolean;
  isMandatory: boolean;
  createBy: string | null;
  createAt: string | null;
  updateBy: string | null;
  updateAt: string | null;
  domains?: { domainCode: string; relationship: string }[];
}

interface MatrixRule {
  ruleCode: string;
  ruleName: string;
  description?: string | null;
  parentRuleCode: string | null;
  isMandatory?: boolean;
}

interface MatrixData {
  rules: MatrixRule[];
  domains: { domainCode: string; domainName: string }[];
  matrix: Record<string, Record<string, string>>;
  exclusions?: Record<string, string[]>;
}

interface FormData {
  ruleCode: string;
  ruleName: string;
  description: string;
  sortOrder: number;
  parentRuleCode: string;
  isMandatory: boolean;
}

export default function DispatchRulesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({ ruleCode: '', ruleName: '', description: '', sortOrder: 0, parentRuleCode: '', isMandatory: false });
  const [localMatrix, setLocalMatrix] = useState<Record<string, Record<string, string>> | null>(null);
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [localExclusions, setLocalExclusions] = useState<Record<string, string[]> | null>(null);
  const [exclusionsDirty, setExclusionsDirty] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());

  // ── Rule list query ──────────────────────────────────────────
  const { data: rulesData, isLoading: rulesLoading } = useQuery<{ data: DispatchRule[] }>({
    queryKey: ['dispatch-rules', showInactive],
    queryFn: () => api.get('/dispatch-rules/', { includeInactive: showInactive }),
  });

  // ── Matrix query ─────────────────────────────────────────────
  const { data: matrixData, isLoading: matrixLoading } = useQuery<MatrixData>({
    queryKey: ['dispatch-rules-matrix'],
    queryFn: () => api.get('/dispatch-rules/matrix'),
  });

  // ── Mutations ────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: ({ editCode, ...payload }: FormData & { editCode: string | null }) =>
      editCode
        ? api.put(`/dispatch-rules/${editCode}`, payload)
        : api.post('/dispatch-rules/', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatch-rules'] });
      qc.invalidateQueries({ queryKey: ['dispatch-rules-matrix'] });
      resetForm();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (code: string) => api.delete(`/dispatch-rules/${code}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatch-rules'] });
      qc.invalidateQueries({ queryKey: ['dispatch-rules-matrix'] });
    },
  });

  const matrixMutation = useMutation({
    mutationFn: (matrix: Record<string, Record<string, string>>) =>
      api.put('/dispatch-rules/matrix', { matrix }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatch-rules-matrix'] });
      qc.invalidateQueries({ queryKey: ['dispatch-rules'] });
      setMatrixDirty(false);
      setLocalMatrix(null);
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (orders: { ruleCode: string; sortOrder: number }[]) =>
      api.put('/dispatch-rules/reorder', { orders }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatch-rules'] });
      qc.invalidateQueries({ queryKey: ['dispatch-rules-matrix'] });
    },
  });

  const exclusionsMutation = useMutation({
    mutationFn: (exclusions: { ruleCode: string; excludedRuleCode: string }[]) =>
      api.put('/dispatch-rules/exclusions', { exclusions }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatch-rules-matrix'] });
      qc.invalidateQueries({ queryKey: ['dispatch-rules'] });
      setExclusionsDirty(false);
      setLocalExclusions(null);
    },
  });

  function resetForm() {
    setShowForm(false);
    setEditingCode(null);
    setFormData({ ruleCode: '', ruleName: '', description: '', sortOrder: 0, parentRuleCode: '', isMandatory: false });
  }

  function openEdit(rule: DispatchRule) {
    setEditingCode(rule.ruleCode);
    setFormData({
      ruleCode: rule.ruleCode,
      ruleName: rule.ruleName,
      description: rule.description || '',
      sortOrder: rule.sortOrder,
      parentRuleCode: rule.parentRuleCode || '',
      isMandatory: rule.isMandatory,
    });
    setShowForm(true);
  }

  function openAddChild(parentCode: string) {
    resetForm();
    const existingChildren = rules.filter((r) => r.parentRuleCode === parentCode);
    const maxSort = existingChildren.reduce((max, r) => Math.max(max, r.sortOrder), 0);
    setFormData({ ruleCode: '', ruleName: '', description: '', sortOrder: maxSort + 1, parentRuleCode: parentCode });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({ ...formData, editCode: editingCode });
  }

  // ── Matrix helpers ───────────────────────────────────────────
  const currentMatrix = localMatrix || matrixData?.matrix || {};

  const toggleCell = useCallback((ruleCode: string, domainCode: string) => {
    const base = localMatrix || matrixData?.matrix || {};
    const updated = { ...base };
    updated[ruleCode] = { ...updated[ruleCode] };
    updated[ruleCode][domainCode] = updated[ruleCode][domainCode] === 'in' ? 'out' : 'in';
    setLocalMatrix(updated);
    setMatrixDirty(true);
  }, [localMatrix, matrixData]);

  function saveMatrix() {
    if (localMatrix) {
      matrixMutation.mutate(localMatrix);
    }
  }

  // ── Exclusion helpers ────────────────────────────────────────
  const currentExclusions = localExclusions || matrixData?.exclusions || {};

  const toggleExclusion = useCallback((ruleCode: string, excludedCode: string, checked: boolean) => {
    const base = { ...(localExclusions || matrixData?.exclusions || {}) };
    const list = [...(base[ruleCode] || [])];
    const reverseList = [...(base[excludedCode] || [])];

    if (checked) {
      if (!list.includes(excludedCode)) list.push(excludedCode);
      if (!reverseList.includes(ruleCode)) reverseList.push(ruleCode);
    } else {
      const idx = list.indexOf(excludedCode);
      if (idx >= 0) list.splice(idx, 1);
      const rIdx = reverseList.indexOf(ruleCode);
      if (rIdx >= 0) reverseList.splice(rIdx, 1);
    }

    base[ruleCode] = list;
    base[excludedCode] = reverseList;
    setLocalExclusions(base);
    setExclusionsDirty(true);
  }, [localExclusions, matrixData]);

  function saveExclusions() {
    if (!localExclusions) return;
    // Build deduped pair list (only one direction needed; backend inserts both)
    const seen = new Set<string>();
    const pairs: { ruleCode: string; excludedRuleCode: string }[] = [];
    for (const [code, excList] of Object.entries(localExclusions)) {
      for (const ex of excList) {
        const key = [code, ex].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push({ ruleCode: code, excludedRuleCode: ex });
        }
      }
    }
    exclusionsMutation.mutate(pairs);
  }

  const rules = rulesData?.data || [];

  // ── Hierarchy helpers ────────────────────────────────────────
  const parentRules = useMemo(() => rules.filter((r) => r.parentRuleCode === null), [rules]);
  const childRulesByParent = useMemo(() => {
    const map: Record<string, DispatchRule[]> = {};
    for (const r of rules) {
      if (r.parentRuleCode) {
        if (!map[r.parentRuleCode]) map[r.parentRuleCode] = [];
        map[r.parentRuleCode].push(r);
      }
    }
    return map;
  }, [rules]);

  // For the form: determine if editing rule has children (cannot set parent)
  const editingRuleHasChildren = editingCode ? (childRulesByParent[editingCode]?.length ?? 0) > 0 : false;

  // ── Move up/down ─────────────────────────────────────────────
  function moveRule(ruleCode: string, direction: 'up' | 'down') {
    const rule = rules.find((r) => r.ruleCode === ruleCode);
    if (!rule) return;

    // Get siblings (rules with same parentRuleCode)
    const siblings = rules
      .filter((r) => r.parentRuleCode === rule.parentRuleCode)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const idx = siblings.findIndex((r) => r.ruleCode === ruleCode);
    if (idx < 0) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === siblings.length - 1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    const orders = siblings.map((r, i) => {
      let newSort = i;
      if (i === idx) newSort = swapIdx;
      if (i === swapIdx) newSort = idx;
      return { ruleCode: r.ruleCode, sortOrder: newSort };
    });

    reorderMutation.mutate(orders);
  }

  // ── Collapse/Expand ──────────────────────────────────────────
  function toggleCollapse(parentCode: string) {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentCode)) next.delete(parentCode);
      else next.add(parentCode);
      return next;
    });
  }

  // Matrix: group rules by parent for column headers
  const matrixRuleGroups = useMemo(() => {
    if (!matrixData) return [];
    const groups: { parent: MatrixRule | null; children: MatrixRule[] }[] = [];
    const parentMap = new Map<string, MatrixRule[]>();

    for (const r of matrixData.rules) {
      if (!r.parentRuleCode) {
        if (!parentMap.has(r.ruleCode)) parentMap.set(r.ruleCode, []);
      }
    }
    for (const r of matrixData.rules) {
      if (r.parentRuleCode && parentMap.has(r.parentRuleCode)) {
        parentMap.get(r.parentRuleCode)!.push(r);
      }
    }

    for (const r of matrixData.rules) {
      if (!r.parentRuleCode) {
        const children = parentMap.get(r.ruleCode) || [];
        groups.push({ parent: r, children });
      }
    }

    // Orphan rules (level-2 with missing parent)
    for (const r of matrixData.rules) {
      if (r.parentRuleCode && !parentMap.has(r.parentRuleCode)) {
        groups.push({ parent: null, children: [r] });
      }
    }

    return groups;
  }, [matrixData]);

  // Flat ordered list of all matrix rules for rendering cells
  const matrixRulesFlat = useMemo(() => {
    const flat: MatrixRule[] = [];
    for (const g of matrixRuleGroups) {
      if (g.parent) flat.push(g.parent);
      flat.push(...g.children);
    }
    return flat;
  }, [matrixRuleGroups]);

  // ── Exclusion groups: Level-1 rules + Level-2 grouped by parent ──
  const exclusionGroups = useMemo(() => {
    if (!matrixData) return [];
    const level1 = matrixData.rules.filter((r) => !r.parentRuleCode);
    const childMap: Record<string, MatrixRule[]> = {};
    for (const r of matrixData.rules) {
      if (r.parentRuleCode) {
        if (!childMap[r.parentRuleCode]) childMap[r.parentRuleCode] = [];
        childMap[r.parentRuleCode].push(r);
      }
    }
    return { level1, childMap };
  }, [matrixData]);

  // Build a flat display list for the rules table
  const displayRows = useMemo(() => {
    const rows: { rule: DispatchRule; isChild: boolean; isParent: boolean; childCount: number; siblingIdx: number; siblingTotal: number }[] = [];
    for (const p of parentRules) {
      const children = childRulesByParent[p.ruleCode] || [];
      const pSiblings = parentRules;
      const pIdx = pSiblings.findIndex((r) => r.ruleCode === p.ruleCode);
      rows.push({ rule: p, isChild: false, isParent: true, childCount: children.length, siblingIdx: pIdx, siblingTotal: pSiblings.length });
      if (!collapsedParents.has(p.ruleCode)) {
        children.forEach((c, ci) => {
          rows.push({ rule: c, isChild: true, isParent: false, childCount: 0, siblingIdx: ci, siblingTotal: children.length });
        });
      }
    }
    return rows;
  }, [parentRules, childRulesByParent, collapsedParents]);

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Dispatch Rules</h1>
          <p className="text-sm text-text-secondary mt-1">
            Manage project characteristic tags and Rule-Domain dispatch matrix
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="btn-teal flex items-center gap-1.5"
          data-testid="add-rule-btn"
        >
          <PlusCircle size={16} /> Add Rule
        </button>
      </div>

      {/* ── Create / Edit Form ─────────────────────────────── */}
      {showForm && (
        <div className="bg-white rounded-lg border border-border-light p-6 mb-6">
          <h2 className="font-medium mb-4">{editingCode ? 'Edit Rule' : 'Add Rule'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Rule Code</label>
                <input
                  className="input-field w-full"
                  placeholder="e.g. INTERNAL"
                  value={formData.ruleCode}
                  onChange={(e) => setFormData({ ...formData, ruleCode: e.target.value })}
                  disabled={!!editingCode}
                  data-testid="rule-code-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Rule Name</label>
                <input
                  className="input-field w-full"
                  placeholder="e.g. 内部项目"
                  value={formData.ruleName}
                  onChange={(e) => setFormData({ ...formData, ruleName: e.target.value })}
                  data-testid="rule-name-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Parent Rule</label>
                <select
                  className="input-field w-full"
                  value={formData.parentRuleCode}
                  onChange={(e) => setFormData({ ...formData, parentRuleCode: e.target.value })}
                  disabled={editingRuleHasChildren}
                  data-testid="parent-rule-select"
                >
                  <option value="">— None (Level 1) —</option>
                  {parentRules.filter((p) => p.ruleCode !== editingCode).map((p) => (
                    <option key={p.ruleCode} value={p.ruleCode}>
                      {p.ruleName} ({p.ruleCode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Sort Order</label>
                <input
                  type="number"
                  className="input-field w-full"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1">Description</label>
                <input
                  className="input-field w-full"
                  placeholder="Optional description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  data-testid="rule-desc-input"
                />
              </div>
              <div className="pt-5">
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded text-red-600"
                    checked={formData.isMandatory}
                    onChange={(e) => setFormData({ ...formData, isMandatory: e.target.checked })}
                    data-testid="rule-mandatory-toggle"
                  />
                  <span className="font-medium text-red-600">Mandatory</span>
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="btn-teal"
                disabled={createMutation.isPending || !formData.ruleCode || !formData.ruleName}
                data-testid="save-rule-btn"
              >
                {createMutation.isPending ? 'Saving...' : editingCode ? 'Update' : 'Create'}
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

      {/* ── Toggle inactive ────────────────────────────────── */}
      <div className="mb-4 flex items-center gap-2">
        <label className="text-sm text-text-secondary flex items-center gap-2">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
            data-testid="show-inactive-toggle"
          />
          Show inactive rules
        </label>
      </div>

      {/* ── Rule List Table (Hierarchical) ───────────────────── */}
      {rulesLoading ? (
        <p className="text-text-secondary">Loading...</p>
      ) : (
        <div className="bg-white rounded-lg border border-border-light overflow-hidden mb-8">
          <table className="w-full text-sm" data-testid="rules-table">
            <thead className="bg-bg-gray border-b border-border-light">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Code</th>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Description</th>
                <th className="text-left px-4 py-2 font-medium">Operation</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-text-secondary">
                    No dispatch rules yet. Click &quot;+ Add Rule&quot; to get started.
                  </td>
                </tr>
              ) : (
                displayRows.map(({ rule: r, isChild, isParent, childCount, siblingIdx, siblingTotal }) => {
                  const hasChildren = childCount > 0;
                  const isCollapsed = collapsedParents.has(r.ruleCode);
                  return (
                    <tr
                      key={r.id}
                      className={clsx(
                        'border-b border-border-light last:border-0',
                        !r.isActive && 'opacity-50',
                        isParent && 'bg-gray-50/60',
                      )}
                      data-testid={isChild ? `child-rule-${r.ruleCode}` : `parent-rule-${r.ruleCode}`}
                    >
                      <td className="px-4 py-2 font-mono text-xs">
                        <span className={clsx('inline-flex items-center gap-1', isChild && 'ml-6')}>
                          {isParent && hasChildren && (
                            <button
                              onClick={() => toggleCollapse(r.ruleCode)}
                              className="text-gray-400 hover:text-gray-600 -ml-1"
                              data-testid={`collapse-${r.ruleCode}`}
                            >
                              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            </button>
                          )}
                          {isChild && <ChevronRight size={12} className="text-gray-400" />}
                          {r.ruleCode}
                        </span>
                      </td>
                      <td className={clsx('px-4 py-2', isParent ? 'font-semibold' : 'font-medium')}>
                        {r.ruleName}
                        {isParent && hasChildren && (
                          <span className="text-xs text-text-secondary ml-2">({childCount})</span>
                        )}
                        {r.isMandatory && (
                          <span className="ml-2 text-xs font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded" data-testid={`mandatory-label-${r.ruleCode}`}>
                            Mandatory
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-text-secondary">{r.description || '-'}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          {/* Move up */}
                          <button
                            onClick={() => moveRule(r.ruleCode, 'up')}
                            disabled={siblingIdx === 0 || reorderMutation.isPending}
                            title="Move up"
                            className={clsx(
                              'p-1 rounded transition-colors',
                              siblingIdx === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50',
                            )}
                            data-testid={`move-up-${r.ruleCode}`}
                          >
                            <ArrowUp size={14} />
                          </button>
                          {/* Move down */}
                          <button
                            onClick={() => moveRule(r.ruleCode, 'down')}
                            disabled={siblingIdx === siblingTotal - 1 || reorderMutation.isPending}
                            title="Move down"
                            className={clsx(
                              'p-1 rounded transition-colors',
                              siblingIdx === siblingTotal - 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50',
                            )}
                            data-testid={`move-down-${r.ruleCode}`}
                          >
                            <ArrowDown size={14} />
                          </button>
                          {/* Add child (only for level-1 rules) */}
                          {isParent && (
                            <button
                              onClick={() => openAddChild(r.ruleCode)}
                              title="Add child rule"
                              className="text-teal-600 hover:text-teal-700 p-1 rounded hover:bg-teal-50"
                              data-testid={`add-child-${r.ruleCode}`}
                            >
                              <Plus size={14} />
                            </button>
                          )}
                          {/* Edit */}
                          <button
                            onClick={() => openEdit(r)}
                            title="Edit"
                            className="text-primary-blue hover:text-blue-700 p-1"
                          >
                            <Pencil size={14} />
                          </button>
                          {/* Toggle active */}
                          <button
                            onClick={() => toggleMutation.mutate(r.ruleCode)}
                            title={r.isActive ? 'Deactivate' : 'Activate'}
                            className={clsx('p-1', r.isActive ? 'text-green-500 hover:text-red-500' : 'text-gray-400 hover:text-green-600')}
                            data-testid={r.isActive ? `deactivate-${r.ruleCode}` : `reactivate-${r.ruleCode}`}
                          >
                            {r.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
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

      {/* ── Rule-Domain Matrix ─────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold">Rule-Domain Matrix</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Click cells to toggle in/out. Save when done.
          </p>
        </div>
        <button
          onClick={saveMatrix}
          disabled={!matrixDirty || matrixMutation.isPending}
          className={clsx(
            'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium',
            matrixDirty
              ? 'btn-teal'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          )}
          data-testid="save-matrix-btn"
        >
          <Save size={16} />
          {matrixMutation.isPending ? 'Saving...' : 'Save Matrix'}
        </button>
      </div>

      {matrixLoading ? (
        <p className="text-text-secondary">Loading matrix...</p>
      ) : matrixData && matrixRulesFlat.length > 0 ? (
        <div className="bg-white rounded-lg border border-border-light overflow-auto">
          <table className="w-full text-sm" data-testid="matrix-table">
            <thead className="bg-bg-gray border-b border-border-light">
              <tr>
                <th className="text-left px-4 py-2 font-medium sticky left-0 bg-bg-gray z-10 border-r border-border-light">
                  Rule
                </th>
                {matrixData.domains.map((domain) => (
                  <th
                    key={domain.domainCode}
                    className="text-center px-2 py-1.5 min-w-[90px] border-l border-border-light"
                  >
                    <div className="text-[10px] font-mono">{domain.domainCode}</div>
                    <div className="text-[9px] text-text-secondary font-normal truncate max-w-[100px]">
                      {domain.domainName}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixRulesFlat.map((rule) => {
                const isChild = !!rule.parentRuleCode;
                return (
                  <tr key={rule.ruleCode} className={clsx('border-b border-border-light last:border-0', !isChild && 'bg-gray-50/40')}>
                    <td className="px-4 py-2 font-medium sticky left-0 bg-white z-10 border-r border-border-light whitespace-nowrap">
                      <span className={clsx('inline-flex items-center gap-1', isChild && 'ml-4')}>
                        {isChild && <ChevronRight size={12} className="text-gray-400" />}
                        {rule.ruleName}
                        <span className="text-text-secondary text-xs ml-1">({rule.ruleCode})</span>
                      </span>
                    </td>
                    {matrixData.domains.map((domain) => {
                      const rel = currentMatrix[rule.ruleCode]?.[domain.domainCode] || 'out';
                      const isIn = rel === 'in';
                      return (
                        <td key={domain.domainCode} className="text-center px-2 py-2 border-l border-border-light">
                          <button
                            onClick={() => toggleCell(rule.ruleCode, domain.domainCode)}
                            className={clsx(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors border',
                              isIn
                                ? 'bg-green-50 text-green-700 border-green-300 hover:bg-green-100'
                                : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                            )}
                            data-testid={`matrix-${rule.ruleCode}-${domain.domainCode}`}
                          >
                            <span className={clsx(
                              'w-1.5 h-1.5 rounded-full',
                              isIn ? 'bg-green-500' : 'bg-gray-300'
                            )} />
                            {isIn ? 'in' : 'out'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ── Rule Exclusions ──────────────────────────────────── */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold">Rule Exclusions</h2>
            <p className="text-sm text-text-secondary mt-0.5">
              Configure mutually exclusive rules. Level-1 rules exclude other Level-1 rules; Level-2 rules exclude siblings under the same parent.
            </p>
          </div>
          <button
            onClick={saveExclusions}
            disabled={!exclusionsDirty || exclusionsMutation.isPending}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium',
              exclusionsDirty
                ? 'btn-teal'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            )}
            data-testid="save-exclusions-btn"
          >
            <Save size={16} />
            {exclusionsMutation.isPending ? 'Saving...' : 'Save Exclusions'}
          </button>
        </div>

        {matrixData && exclusionGroups.level1 && (
          <div className="bg-white rounded-lg border border-border-light overflow-hidden" data-testid="exclusions-section">
            <table className="w-full text-sm">
              <thead className="bg-bg-gray border-b border-border-light">
                <tr>
                  <th className="text-left px-4 py-2 font-medium w-1/3">Rule</th>
                  <th className="text-left px-4 py-2 font-medium">Excludes</th>
                </tr>
              </thead>
              <tbody>
                {/* Level-1 exclusions */}
                <tr className="border-b border-border-light bg-gray-50/40">
                  <td colSpan={2} className="px-4 py-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                    Level 1 — Cross-rule exclusions
                  </td>
                </tr>
                {exclusionGroups.level1.map((rule) => {
                  const others = exclusionGroups.level1.filter((r) => r.ruleCode !== rule.ruleCode);
                  const excList = currentExclusions[rule.ruleCode] || [];
                  return (
                    <tr key={rule.ruleCode} className="border-b border-border-light" data-testid={`excl-row-${rule.ruleCode}`}>
                      <td className="px-4 py-2 font-medium">
                        {rule.ruleName}
                        <span className="text-text-secondary text-xs ml-1">({rule.ruleCode})</span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-2">
                          {others.map((other) => {
                            const checked = excList.includes(other.ruleCode);
                            return (
                              <label
                                key={other.ruleCode}
                                className={clsx(
                                  'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs cursor-pointer transition-colors',
                                  checked
                                    ? 'bg-red-50 border-red-200 text-red-700'
                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                )}
                              >
                                <input
                                  type="checkbox"
                                  className="rounded text-red-600"
                                  checked={checked}
                                  onChange={(e) => toggleExclusion(rule.ruleCode, other.ruleCode, e.target.checked)}
                                  data-testid={`excl-${rule.ruleCode}-${other.ruleCode}`}
                                />
                                {other.ruleName}
                              </label>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* Level-2 exclusions per parent */}
                {exclusionGroups.level1
                  .filter((p) => (exclusionGroups.childMap[p.ruleCode]?.length ?? 0) > 1)
                  .map((parent) => {
                    const children = exclusionGroups.childMap[parent.ruleCode] || [];
                    return (
                      <React.Fragment key={`l2-${parent.ruleCode}`}>
                        <tr className="border-b border-border-light bg-gray-50/40">
                          <td colSpan={2} className="px-4 py-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                            Level 2 — Under {parent.ruleName} ({parent.ruleCode})
                          </td>
                        </tr>
                        {children.map((rule) => {
                          const siblings = children.filter((c) => c.ruleCode !== rule.ruleCode);
                          const excList = currentExclusions[rule.ruleCode] || [];
                          return (
                            <tr key={rule.ruleCode} className="border-b border-border-light" data-testid={`excl-row-${rule.ruleCode}`}>
                              <td className="px-4 py-2 font-medium pl-8">
                                {rule.ruleName}
                                <span className="text-text-secondary text-xs ml-1">({rule.ruleCode})</span>
                              </td>
                              <td className="px-4 py-2">
                                <div className="flex flex-wrap gap-2">
                                  {siblings.map((sib) => {
                                    const checked = excList.includes(sib.ruleCode);
                                    return (
                                      <label
                                        key={sib.ruleCode}
                                        className={clsx(
                                          'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs cursor-pointer transition-colors',
                                          checked
                                            ? 'bg-red-50 border-red-200 text-red-700'
                                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                        )}
                                      >
                                        <input
                                          type="checkbox"
                                          className="rounded text-red-600"
                                          checked={checked}
                                          onChange={(e) => toggleExclusion(rule.ruleCode, sib.ruleCode, e.target.checked)}
                                          data-testid={`excl-${rule.ruleCode}-${sib.ruleCode}`}
                                        />
                                        {sib.ruleName}
                                      </label>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

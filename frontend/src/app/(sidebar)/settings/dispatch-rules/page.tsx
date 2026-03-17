'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import clsx from 'clsx';
import { Button, Input, Switch } from 'antd';
import { PlusCircleOutlined, EditOutlined, SaveOutlined, RightOutlined, DownOutlined, ArrowUpOutlined, ArrowDownOutlined, PlusOutlined } from '@ant-design/icons';
import { useLocale } from '@/lib/locale-context';

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
  dependencies?: Record<string, string[]>;
}

interface FormData {
  ruleCode: string;
  ruleName: string;
  description: string;
  sortOrder: number;
  parentRuleCode: string;
  isMandatory: boolean;
}

type ConfigTab = 'matrix' | 'exclusions' | 'dependencies';

export default function DispatchRulesPage() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('dispatch_rule', 'write');
  const [showForm, setShowForm] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({ ruleCode: '', ruleName: '', description: '', sortOrder: 0, parentRuleCode: '', isMandatory: false });
  const [localMatrix, setLocalMatrix] = useState<Record<string, Record<string, string>> | null>(null);
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [localExclusions, setLocalExclusions] = useState<Record<string, string[]> | null>(null);
  const [exclusionsDirty, setExclusionsDirty] = useState(false);
  const [localDependencies, setLocalDependencies] = useState<Record<string, string[]> | null>(null);
  const [dependenciesDirty, setDependenciesDirty] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<ConfigTab>('matrix');

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

  const dependenciesMutation = useMutation({
    mutationFn: (dependencies: { ruleCode: string; requiredRuleCode: string }[]) =>
      api.put('/dispatch-rules/dependencies', { dependencies }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatch-rules-matrix'] });
      qc.invalidateQueries({ queryKey: ['dispatch-rules'] });
      setDependenciesDirty(false);
      setLocalDependencies(null);
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
    setFormData({ ruleCode: '', ruleName: '', description: '', sortOrder: maxSort + 1, parentRuleCode: parentCode, isMandatory: false });
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

  // ── Dependency helpers ─────────────────────────────────────
  const currentDependencies = localDependencies || matrixData?.dependencies || {};

  const toggleDependency = useCallback((ruleCode: string, requiredCode: string, checked: boolean) => {
    const base = { ...(localDependencies || matrixData?.dependencies || {}) };
    const list = [...(base[ruleCode] || [])];

    if (checked) {
      if (!list.includes(requiredCode)) list.push(requiredCode);
    } else {
      const idx = list.indexOf(requiredCode);
      if (idx >= 0) list.splice(idx, 1);
    }

    base[ruleCode] = list;
    setLocalDependencies(base);
    setDependenciesDirty(true);
  }, [localDependencies, matrixData]);

  function saveDependencies() {
    if (!localDependencies) return;
    const pairs: { ruleCode: string; requiredRuleCode: string }[] = [];
    for (const [code, depList] of Object.entries(localDependencies)) {
      for (const req of depList) {
        pairs.push({ ruleCode: code, requiredRuleCode: req });
      }
    }
    dependenciesMutation.mutate(pairs);
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
    if (!matrixData) return { level1: [] as MatrixRule[], childMap: {} as Record<string, MatrixRule[]> };
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
          <h1 className="text-xl font-bold">{t('dispatchRules.title')}</h1>
          <p className="text-sm text-text-secondary mt-1">
            {t('dispatchRules.subtitle')}
          </p>
        </div>
        {canWrite && (
          <Button
            type="primary"
            style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
            icon={<PlusCircleOutlined />}
            onClick={() => { resetForm(); setShowForm(true); }}
            data-testid="add-rule-btn"
          >
            {t('dispatchRules.addRule')}
          </Button>
        )}
      </div>

      {/* ── Create / Edit Form ─────────────────────────────── */}
      {showForm && (
        <div className="bg-white rounded-lg border border-border-light p-6 mb-6">
          <h2 className="font-medium mb-4">{editingCode ? t('dispatchRules.editRule') : t('dispatchRules.addRule')}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('dispatchRules.ruleCode')}</label>
                <Input
                  placeholder={t('dispatchRules.ruleCodePlaceholder')}
                  value={formData.ruleCode}
                  onChange={(e) => setFormData({ ...formData, ruleCode: e.target.value })}
                  disabled={!!editingCode}
                  data-testid="rule-code-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('dispatchRules.ruleName')}</label>
                <Input
                  placeholder="e.g. 内部项目"
                  value={formData.ruleName}
                  onChange={(e) => setFormData({ ...formData, ruleName: e.target.value })}
                  data-testid="rule-name-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('dispatchRules.parentRule')}</label>
                <select
                  className="ant-input w-full"
                  style={{ height: 32, borderRadius: 6, border: '1px solid #d9d9d9', padding: '0 8px' }}
                  value={formData.parentRuleCode}
                  onChange={(e) => setFormData({ ...formData, parentRuleCode: e.target.value })}
                  disabled={editingRuleHasChildren}
                  data-testid="parent-rule-select"
                >
                  <option value="">{t('dispatchRules.noneLevel1')}</option>
                  {parentRules.filter((p) => p.ruleCode !== editingCode).map((p) => (
                    <option key={p.ruleCode} value={p.ruleCode}>
                      {p.ruleName} ({p.ruleCode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.sortOrder')}</label>
                <Input
                  type="number"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1">{t('common.description')}</label>
                <Input
                  placeholder={t('dispatchRules.optionalDescription')}
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
                  <span className="font-medium text-red-600">{t('dispatchRules.mandatory')}</span>
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="primary"
                style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
                htmlType="submit"
                disabled={createMutation.isPending || !formData.ruleCode || !formData.ruleName}
                data-testid="save-rule-btn"
              >
                {createMutation.isPending ? t('common.saving') : editingCode ? t('common.update') : t('common.create')}
              </Button>
              <Button onClick={resetForm}>
                {t('common.cancel')}
              </Button>
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
          {t('dispatchRules.showInactive')}
        </label>
      </div>

      {/* ── Rule List Table (Hierarchical) ───────────────────── */}
      {rulesLoading ? (
        <p className="text-text-secondary">{t('common.loading')}</p>
      ) : (
        <div className="bg-white rounded-lg border border-border-light overflow-hidden mb-8">
          <table className="w-full text-sm" data-testid="rules-table">
            <thead className="bg-bg-gray border-b border-border-light">
              <tr>
                <th className="text-left px-4 py-2 font-medium">{t('common.code')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('common.name')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('common.description')}</th>
                {canWrite && <th className="text-left px-4 py-2 font-medium">{t('common.operation')}</th>}
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-text-secondary">
                    {t('dispatchRules.noRules')}
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
                      <td className="px-4 py-2 text-xs font-semibold">
                        <span className={clsx('inline-flex items-center gap-1', isChild && 'ml-6')}>
                          {isParent && hasChildren && (
                            <button
                              onClick={() => toggleCollapse(r.ruleCode)}
                              className="text-gray-400 hover:text-gray-600 -ml-1"
                              data-testid={`collapse-${r.ruleCode}`}
                            >
                              {isCollapsed ? <RightOutlined style={{ fontSize: 12 }} /> : <DownOutlined style={{ fontSize: 12 }} />}
                            </button>
                          )}
                          {isChild && <RightOutlined style={{ fontSize: 10, color: '#9ca3af' }} />}
                          {r.ruleCode}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-normal">
                        {r.ruleName}
                        {isParent && hasChildren && (
                          <span className="text-xs text-text-secondary ml-2">({childCount})</span>
                        )}
                        {r.isMandatory && (
                          <span className="ml-2 text-xs font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded" data-testid={`mandatory-label-${r.ruleCode}`}>
                            {t('dispatchRules.mandatory')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-text-secondary">{r.description || '-'}</td>
                      {canWrite && (
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1">
                            {/* Move up */}
                            <button
                              onClick={() => moveRule(r.ruleCode, 'up')}
                              disabled={siblingIdx === 0 || reorderMutation.isPending}
                              title={t('dispatchRules.moveUp')}
                              className={clsx(
                                'p-1 rounded transition-colors',
                                siblingIdx === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50',
                              )}
                              data-testid={`move-up-${r.ruleCode}`}
                            >
                              <ArrowUpOutlined style={{ fontSize: 14 }} />
                            </button>
                            {/* Move down */}
                            <button
                              onClick={() => moveRule(r.ruleCode, 'down')}
                              disabled={siblingIdx === siblingTotal - 1 || reorderMutation.isPending}
                              title={t('dispatchRules.moveDown')}
                              className={clsx(
                                'p-1 rounded transition-colors',
                                siblingIdx === siblingTotal - 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50',
                              )}
                              data-testid={`move-down-${r.ruleCode}`}
                            >
                              <ArrowDownOutlined style={{ fontSize: 14 }} />
                            </button>
                            {/* Add child (only for level-1 rules) */}
                            {isParent && (
                              <button
                                onClick={() => openAddChild(r.ruleCode)}
                                title={t('dispatchRules.addChild')}
                                className="text-teal-600 hover:text-teal-700 p-1 rounded hover:bg-teal-50"
                                data-testid={`add-child-${r.ruleCode}`}
                              >
                                <PlusOutlined style={{ fontSize: 14 }} />
                              </button>
                            )}
                            {/* Edit */}
                            <button
                              onClick={() => openEdit(r)}
                              title={t('common.edit')}
                              className="text-primary-blue hover:text-blue-700 p-1"
                            >
                              <EditOutlined style={{ fontSize: 14 }} />
                            </button>
                            {/* Toggle active */}
                            <Switch
                              size="small"
                              checked={r.isActive}
                              onChange={() => toggleMutation.mutate(r.ruleCode)}
                              data-testid={r.isActive ? `deactivate-${r.ruleCode}` : `reactivate-${r.ruleCode}`}
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

      {/* ── Configuration Tabs ─────────────────────────────── */}
      <div className="border-b border-border-light mb-6">
        <nav className="flex gap-0 -mb-px" data-testid="config-tabs">
          {([
            { key: 'matrix' as ConfigTab, label: t('dispatchRules.ruleDomainMatrix'), dirty: matrixDirty },
            { key: 'exclusions' as ConfigTab, label: t('dispatchRules.ruleExclusions'), dirty: exclusionsDirty },
            { key: 'dependencies' as ConfigTab, label: t('dispatchRules.ruleDependencies'), dirty: dependenciesDirty },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === tab.key
                  ? 'border-primary-blue text-primary-blue'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:border-gray-300',
              )}
              data-testid={`tab-${tab.key}`}
            >
              {tab.label}
              {tab.dirty && (
                <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-orange-400" title={t('dispatchRules.unsavedChanges')} />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Tab: Rule-Domain Matrix ──────────────────────────── */}
      {activeTab === 'matrix' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-text-secondary">
              {t('dispatchRules.matrixInstruction')}
            </p>
            {canWrite && (
              <Button
                type="primary"
                style={matrixDirty ? { background: '#13C2C2', borderColor: '#13C2C2' } : undefined}
                icon={<SaveOutlined />}
                onClick={saveMatrix}
                disabled={!matrixDirty || matrixMutation.isPending}
                data-testid="save-matrix-btn"
              >
                {matrixMutation.isPending ? t('common.saving') : t('dispatchRules.saveMatrix')}
              </Button>
            )}
          </div>

          {matrixLoading ? (
            <p className="text-text-secondary">{t('dispatchRules.loadingMatrix')}</p>
          ) : matrixData && matrixRulesFlat.length > 0 ? (
            <div className="bg-white rounded-lg border border-border-light overflow-auto">
              <table className="w-full text-sm" data-testid="matrix-table">
                <thead className="bg-bg-gray border-b border-border-light">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium sticky left-0 bg-bg-gray z-10 border-r border-border-light">
                      {t('dispatchRules.rule')}
                    </th>
                    {matrixData.domains.map((domain) => (
                      <th
                        key={domain.domainCode}
                        className="text-center px-2 py-1.5 min-w-[90px] border-l border-border-light"
                      >
                        <div className="text-[10px]">{domain.domainCode}</div>
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
                            {isChild && <RightOutlined style={{ fontSize: 10, color: '#9ca3af' }} />}
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
        </>
      )}

      {/* ── Tab: Rule Exclusions ─────────────────────────────── */}
      {activeTab === 'exclusions' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-text-secondary">
              {t('dispatchRules.exclusionInstruction')}
            </p>
            {canWrite && (
              <Button
                type="primary"
                style={exclusionsDirty ? { background: '#13C2C2', borderColor: '#13C2C2' } : undefined}
                icon={<SaveOutlined />}
                onClick={saveExclusions}
                disabled={!exclusionsDirty || exclusionsMutation.isPending}
                data-testid="save-exclusions-btn"
              >
                {exclusionsMutation.isPending ? t('common.saving') : t('dispatchRules.saveExclusions')}
              </Button>
            )}
          </div>

          {matrixData && exclusionGroups.level1 && (
            <div className="bg-white rounded-lg border border-border-light overflow-hidden" data-testid="exclusions-section">
              <table className="w-full text-sm">
                <thead className="bg-bg-gray border-b border-border-light">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium w-1/3">{t('dispatchRules.rule')}</th>
                    <th className="text-left px-4 py-2 font-medium">{t('dispatchRules.excludes')}</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Level-1 exclusions */}
                  <tr className="border-b border-border-light bg-gray-50/40">
                    <td colSpan={2} className="px-4 py-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                      {t('dispatchRules.level1Exclusions')}
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
        </>
      )}

      {/* ── Tab: Rule Dependencies ───────────────────────────── */}
      {activeTab === 'dependencies' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-text-secondary">
              {t('dispatchRules.dependencyInstruction')}
            </p>
            {canWrite && (
              <Button
                type="primary"
                style={dependenciesDirty ? { background: '#13C2C2', borderColor: '#13C2C2' } : undefined}
                icon={<SaveOutlined />}
                onClick={saveDependencies}
                disabled={!dependenciesDirty || dependenciesMutation.isPending}
                data-testid="save-dependencies-btn"
              >
                {dependenciesMutation.isPending ? t('common.saving') : t('dispatchRules.saveDependencies')}
              </Button>
            )}
          </div>

          {matrixData && matrixData.rules.length > 0 && (
            <div className="bg-white rounded-lg border border-border-light overflow-hidden" data-testid="dependencies-section">
              <table className="w-full text-sm">
                <thead className="bg-bg-gray border-b border-border-light">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium w-1/3">{t('dispatchRules.rule')}</th>
                    <th className="text-left px-4 py-2 font-medium">{t('dispatchRules.requiresAnyOf')}</th>
                  </tr>
                </thead>
                <tbody>
                  {matrixData.rules.map((rule) => {
                    const others = matrixData.rules.filter((r) => r.ruleCode !== rule.ruleCode);
                    const depList = currentDependencies[rule.ruleCode] || [];
                    return (
                      <tr key={rule.ruleCode} className="border-b border-border-light" data-testid={`dep-row-${rule.ruleCode}`}>
                        <td className="px-4 py-2 font-medium">
                          <span className={clsx(rule.parentRuleCode && 'ml-4')}>
                            {rule.parentRuleCode && <RightOutlined style={{ fontSize: 10, color: '#9ca3af', marginRight: 4 }} />}
                            {rule.ruleName}
                            <span className="text-text-secondary text-xs ml-1">({rule.ruleCode})</span>
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-2">
                            {others.map((other) => {
                              const checked = depList.includes(other.ruleCode);
                              return (
                                <label
                                  key={other.ruleCode}
                                  className={clsx(
                                    'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs cursor-pointer transition-colors',
                                    checked
                                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    className="rounded text-blue-600"
                                    checked={checked}
                                    onChange={(e) => toggleDependency(rule.ruleCode, other.ruleCode, e.target.checked)}
                                    data-testid={`dep-${rule.ruleCode}-${other.ruleCode}`}
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
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

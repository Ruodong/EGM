'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DomainPreviewChip } from './DomainPreviewChip';
import clsx from 'clsx';

interface MatrixRule {
  ruleCode: string;
  ruleName: string;
  description: string | null;
  parentRuleCode: string | null;
  isMandatory: boolean;
}

interface MatrixDomain {
  domainCode: string;
  domainName: string;
}

interface MatrixData {
  rules: MatrixRule[];
  domains: MatrixDomain[];
  matrix: Record<string, Record<string, string>>; // { ruleCode: { domainCode: 'in' | 'out' } }
  exclusions?: Record<string, string[]>; // { ruleCode: [excludedRuleCode, ...] }
}

interface GovernanceScopeDeterminationProps {
  selectedRules: string[];
  onRulesChange: (rules: string[]) => void;
}

function RuleToggle({
  rule,
  isSelected,
  onToggle,
  indented,
  disabled,
  disabledReason,
}: {
  rule: MatrixRule;
  isSelected: boolean;
  onToggle: (ruleCode: string, value: boolean) => void;
  indented?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div
      className={clsx(
        'flex items-center justify-between px-4 py-3 rounded-lg border transition-colors',
        indented && 'ml-4',
        disabled
          ? 'bg-gray-50 border-gray-200 opacity-60'
          : isSelected
            ? 'bg-purple-50 border-purple-200'
            : 'bg-white border-border-light',
      )}
      title={disabled ? disabledReason : undefined}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={clsx('text-sm font-medium', disabled && 'text-gray-400')}>
            {rule.ruleName}
          </span>
          <span className="text-xs text-text-secondary">({rule.ruleCode})</span>
          {rule.isMandatory && (
            <span className="text-xs font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded" data-testid={`mandatory-badge-${rule.ruleCode}`}>
              Required
            </span>
          )}
        </div>
        {disabled && disabledReason ? (
          <div className="text-xs text-orange-500 mt-0.5">{disabledReason}</div>
        ) : (
          rule.description && (
            <div className="text-xs text-text-secondary mt-0.5">{rule.description}</div>
          )
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => !disabled && onToggle(rule.ruleCode, true)}
          disabled={disabled}
          className={clsx(
            'px-3 py-1 text-xs font-medium rounded-l-md border transition-colors',
            disabled
              ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
              : isSelected
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-text-secondary border-border-light hover:bg-gray-50',
          )}
          data-testid={`rule-toggle-${rule.ruleCode}-yes`}
        >
          YES
        </button>
        <button
          type="button"
          onClick={() => !disabled && onToggle(rule.ruleCode, false)}
          disabled={disabled}
          className={clsx(
            'px-3 py-1 text-xs font-medium rounded-r-md border transition-colors',
            disabled
              ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
              : !isSelected
                ? 'bg-gray-200 text-gray-700 border-gray-300'
                : 'bg-white text-text-secondary border-border-light hover:bg-gray-50',
          )}
          data-testid={`rule-toggle-${rule.ruleCode}-no`}
        >
          NO
        </button>
      </div>
    </div>
  );
}

export function GovernanceScopeDetermination({
  selectedRules,
  onRulesChange,
}: GovernanceScopeDeterminationProps) {
  const { data: matrixData, isLoading } = useQuery<MatrixData>({
    queryKey: ['dispatch-rules-matrix'],
    queryFn: () => api.get('/dispatch-rules/matrix'),
  });

  const toggleRule = (ruleCode: string, value: boolean) => {
    if (value) {
      // Auto-remove any rules that conflict with the newly selected rule
      const conflicting = new Set(matrixData?.exclusions?.[ruleCode] || []);
      const cleaned = selectedRules.filter((c) => !conflicting.has(c));
      onRulesChange([...cleaned, ruleCode]);
    } else {
      onRulesChange(selectedRules.filter((c) => c !== ruleCode));
    }
  };

  // Group rules by parent for hierarchical display
  const ruleGroups = useMemo(() => {
    if (!matrixData) return [];
    const parents = matrixData.rules.filter((r) => !r.parentRuleCode);
    const childMap: Record<string, MatrixRule[]> = {};
    for (const r of matrixData.rules) {
      if (r.parentRuleCode) {
        if (!childMap[r.parentRuleCode]) childMap[r.parentRuleCode] = [];
        childMap[r.parentRuleCode].push(r);
      }
    }
    return parents.map((p) => ({ parent: p, children: childMap[p.ruleCode] || [] }));
  }, [matrixData]);

  // Compute auto-aggregated parent codes from selected children
  const autoParentCodes = useMemo(() => {
    if (!matrixData) return new Set<string>();
    const parentCodes = new Set<string>();
    for (const ruleCode of selectedRules) {
      const rule = matrixData.rules.find((r) => r.ruleCode === ruleCode);
      if (rule?.parentRuleCode) {
        parentCodes.add(rule.parentRuleCode);
      }
    }
    return parentCodes;
  }, [selectedRules, matrixData]);

  // Compute which rules are excluded (disabled) based on current selections
  const excludedRulesMap = useMemo(() => {
    if (!matrixData?.exclusions) return new Map<string, string>();
    const excluded = new Map<string, string>(); // ruleCode -> reason (excluder ruleName)

    // Direct exclusions from selected rules
    for (const code of selectedRules) {
      const excList = matrixData.exclusions[code] || [];
      const ruleName = matrixData.rules.find((r) => r.ruleCode === code)?.ruleName || code;
      for (const ex of excList) {
        excluded.set(ex, ruleName);
      }
    }

    // Exclusions from auto-aggregated parents
    for (const parentCode of autoParentCodes) {
      const excList = matrixData.exclusions[parentCode] || [];
      const parentName = matrixData.rules.find((r) => r.ruleCode === parentCode)?.ruleName || parentCode;
      for (const ex of excList) {
        excluded.set(ex, parentName);
        // Also disable excluded parent's children
        for (const r of matrixData.rules) {
          if (r.parentRuleCode === ex) {
            excluded.set(r.ruleCode, parentName);
          }
        }
      }
    }

    return excluded;
  }, [selectedRules, autoParentCodes, matrixData]);

  // Compute triggered domains from selected rules + auto-aggregated parents
  const triggeredDomains = useMemo(() => {
    if (!matrixData) return [];
    const domainSet = new Set<string>();

    // Domains from selected rules (level-1 or level-2)
    for (const ruleCode of selectedRules) {
      const ruleMatrix = matrixData.matrix[ruleCode];
      if (!ruleMatrix) continue;
      for (const [domainCode, relationship] of Object.entries(ruleMatrix)) {
        if (relationship === 'in') {
          domainSet.add(domainCode);
        }
      }
    }

    // Domains from auto-aggregated level-1 parents (when child is selected)
    for (const parentCode of autoParentCodes) {
      const parentMatrix = matrixData.matrix[parentCode];
      if (!parentMatrix) continue;
      for (const [domainCode, relationship] of Object.entries(parentMatrix)) {
        if (relationship === 'in') {
          domainSet.add(domainCode);
        }
      }
    }

    return matrixData.domains.filter((d) => domainSet.has(d.domainCode));
  }, [selectedRules, autoParentCodes, matrixData]);

  if (isLoading) {
    return <div className="text-sm text-text-secondary py-2">Loading rules...</div>;
  }

  if (!matrixData || matrixData.rules.length === 0) {
    return <div className="text-sm text-text-secondary py-2">No dispatch rules configured.</div>;
  }

  return (
    <div className="space-y-4">
      {/* Rule YES/NO toggles — hierarchical */}
      <div className="space-y-3" data-testid="dispatch-rules-section">
        {ruleGroups.map((group) => {
          const hasChildren = group.children.length > 0;
          const parentSelected = autoParentCodes.has(group.parent.ruleCode);

          // Level-1 rule WITHOUT children → render as a direct toggle
          if (!hasChildren) {
            const reason = excludedRulesMap.get(group.parent.ruleCode);
            return (
              <RuleToggle
                key={group.parent.ruleCode}
                rule={group.parent}
                isSelected={selectedRules.includes(group.parent.ruleCode)}
                onToggle={toggleRule}
                disabled={!!reason}
                disabledReason={reason ? `Excluded by ${reason}` : undefined}
              />
            );
          }

          // Level-1 rule WITH children → group header + child toggles
          return (
            <div key={group.parent.ruleCode} className="space-y-1">
              {/* Parent header */}
              <div
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-t-lg border transition-colors',
                  parentSelected
                    ? 'bg-purple-50 border-purple-200'
                    : 'bg-gray-50 border-border-light',
                )}
                data-testid={`rule-group-${group.parent.ruleCode}`}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold">{group.parent.ruleName}</span>
                  <span className="text-xs text-text-secondary ml-2">({group.parent.ruleCode})</span>
                  {group.parent.isMandatory && (
                    <span className="text-xs font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded ml-2" data-testid={`mandatory-badge-${group.parent.ruleCode}`}>
                      Required
                    </span>
                  )}
                  {group.parent.description && (
                    <span className="text-xs text-text-secondary ml-2">{group.parent.description}</span>
                  )}
                </div>
                {parentSelected && (
                  <span className="text-xs text-purple-600 font-medium" data-testid={`parent-auto-${group.parent.ruleCode}`}>
                    Auto
                  </span>
                )}
              </div>

              {/* Children toggles */}
              {group.children.map((rule) => {
                const reason = excludedRulesMap.get(rule.ruleCode);
                return (
                  <RuleToggle
                    key={rule.ruleCode}
                    rule={rule}
                    isSelected={selectedRules.includes(rule.ruleCode)}
                    onToggle={toggleRule}
                    indented
                    disabled={!!reason}
                    disabledReason={reason ? `Excluded by ${reason}` : undefined}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Triggered Domains preview */}
      <div data-testid="triggered-domains-section" className="pt-2">
        <label className="block text-sm font-medium mb-2 text-text-secondary">
          Triggered Domains
        </label>
        {triggeredDomains.length === 0 ? (
          <p className="text-xs text-text-secondary italic">
            Select rules above to see triggered domains
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {triggeredDomains.map((domain) => (
              <DomainPreviewChip
                key={domain.domainCode}
                domainCode={domain.domainCode}
                domainName={domain.domainName}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

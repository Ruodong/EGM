'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { SectionCard } from './SectionCard';
import { Button, Select, Tag, Tooltip, Collapse, Skeleton } from 'antd';
import {
  ExperimentOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  HistoryOutlined,
  SafetyCertificateOutlined,
  FileSearchOutlined,
  SwapOutlined,
  FileTextOutlined,
  AimOutlined,
} from '@ant-design/icons';

interface AIAnalysis {
  id: string;
  domainReviewId: string;
  version: number;
  triggerEvent: string;
  triggerBy: string | null;
  status: string;
  contentHash: string | null;
  changedDimensions: string[] | null;
  riskAssessment: RiskAssessment | null;
  referenceCases: ReferenceCases | null;
  consistencyAnalysis: ConsistencyAnalysis | null;
  completenessAnalysis: CompletenessAnalysis | null;
  accuracyAnalysis: AccuracyAnalysis | null;
  overallScore: number | null;
  summary: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createAt: string | null;
}

interface RiskAssessment {
  riskLevel: string;
  riskFactors: string[];
  recommendedDepth: string;
  estimatedEffort: string;
  projectTypeNote?: string;
}

interface ReferenceCases {
  suggestedOutcome: string | null;
  confidence: number;
  similarCases: {
    index?: number;
    requestId?: string;
    projectName?: string;
    outcome?: string;
    similarity?: number;
    keyDifference?: string;
  }[];
  keyDifferences: string[];
  attentionPoints: string[];
  note?: string;
}

interface ConsistencyAnalysis {
  contradictions: {
    type: string;
    severity: string;
    questionRefs: string[];
    description: string;
    suggestedClarification: string;
  }[];
  overallScore: number;
}

interface CompletenessAnalysis {
  perQuestion: {
    questionNo: string;
    quality: string;
    missingDetails: string[];
    suggestedFollowup: string;
  }[];
  informationGaps: {
    topic: string;
    importance: string;
    reason: string;
    suggestedQuestion: string;
  }[];
  completenessScore: number;
}

interface AccuracyAnalysis {
  factualIssues: {
    questionNo?: string;
    claim: string;
    issue: string;
    severity: string;
    type: string;
  }[];
  plausibilityConcerns: {
    description: string;
    type: string;
  }[];
}

interface VersionItem {
  id: string;
  version: number;
  triggerEvent: string;
  status: string;
  completedAt: string | null;
  overallScore: number | null;
  changedDimensions: string[] | null;
}

function SeverityTag({ severity }: { severity: string }) {
  const upper = severity?.toUpperCase();
  if (upper === 'HIGH') return <Tag color="red">HIGH</Tag>;
  if (upper === 'MEDIUM') return <Tag color="orange">MEDIUM</Tag>;
  if (upper === 'LOW') return <Tag color="green">LOW</Tag>;
  return <Tag>{severity}</Tag>;
}

function RiskLevelBadge({ level }: { level: string }) {
  const upper = level?.toUpperCase();
  const colors: Record<string, string> = {
    HIGH: 'bg-red-100 text-red-800 border-red-200',
    MEDIUM: 'bg-orange-100 text-orange-800 border-orange-200',
    LOW: 'bg-green-100 text-green-800 border-green-200',
  };
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${colors[upper] || 'bg-gray-100'}`}>
      {upper || level}
    </span>
  );
}

function ScoreBar({ score, label }: { score: number | null | undefined; label?: string }) {
  if (score == null) return null;
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : pct >= 40 ? 'bg-orange-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-text-secondary w-20">{label}</span>}
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium w-10 text-right">{score.toFixed(2)}</span>
    </div>
  );
}

function DimensionBadge({ dimension, changed }: { dimension: string; changed: boolean }) {
  if (changed) {
    return <Tag color="blue" className="text-xs">Updated</Tag>;
  }
  return <Tag className="text-xs">Carried forward</Tag>;
}

// ── Sub-sections ─────────────────────────────────────────────────────────────

function RiskAssessmentPanel({ data, changed }: { data: RiskAssessment | null; changed: boolean }) {
  if (!data) return <p className="text-sm text-text-secondary italic">No risk assessment available.</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <RiskLevelBadge level={data.riskLevel} />
        <DimensionBadge dimension="risk_assessment" changed={changed} />
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <label className="text-xs text-text-secondary">Recommended Review Depth</label>
          <div className="font-medium">{data.recommendedDepth}</div>
        </div>
        <div>
          <label className="text-xs text-text-secondary">Estimated Effort</label>
          <div className="font-medium">{data.estimatedEffort}</div>
        </div>
      </div>
      {data.projectTypeNote && (
        <p className="text-sm text-text-secondary">{data.projectTypeNote}</p>
      )}
      {data.riskFactors?.length > 0 && (
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Risk Factors</label>
          <ul className="list-disc list-inside text-sm space-y-1">
            {data.riskFactors.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function ReferenceCasesPanel({ data, changed }: { data: ReferenceCases | null; changed: boolean }) {
  if (!data) return <p className="text-sm text-text-secondary italic">No reference cases available.</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {data.suggestedOutcome ? (
          <Tag color={data.suggestedOutcome === 'Approved' ? 'green' : data.suggestedOutcome === 'Not Passed' ? 'red' : 'orange'}>
            Suggested: {data.suggestedOutcome}
          </Tag>
        ) : (
          <Tag>No suggestion (insufficient data)</Tag>
        )}
        {data.confidence > 0 && (
          <span className="text-sm text-text-secondary">Confidence: {Math.round(data.confidence * 100)}%</span>
        )}
        <DimensionBadge dimension="reference_cases" changed={changed} />
      </div>
      {data.note && <p className="text-sm text-text-secondary italic">{data.note}</p>}
      {data.similarCases?.length > 0 && (
        <div className="space-y-2">
          {data.similarCases.map((c, i) => (
            <div key={i} className="bg-gray-50 rounded-lg p-3 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">{c.requestId || `Case #${c.index || i + 1}`}</span>
                {c.similarity != null && (
                  <Tag color="blue">{Math.round(c.similarity * 100)}% match</Tag>
                )}
                {c.outcome && <Tag>{c.outcome}</Tag>}
              </div>
              {c.projectName && <div className="text-text-secondary">{c.projectName}</div>}
              {c.keyDifference && (
                <div className="mt-1 text-xs text-text-secondary">
                  <span className="font-medium">Key difference:</span> {c.keyDifference}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {data.attentionPoints?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="flex items-center gap-1 mb-1 text-amber-800">
            <WarningOutlined className="text-xs" />
            <span className="text-xs font-medium">Attention Points</span>
          </div>
          <ul className="list-disc list-inside text-sm text-amber-700 space-y-1">
            {data.attentionPoints.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function ConsistencyPanel({ data, changed }: { data: ConsistencyAnalysis | null; changed: boolean }) {
  if (!data) return <p className="text-sm text-text-secondary italic">No consistency analysis available.</p>;
  const hasIssues = data.contradictions?.length > 0;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <ScoreBar score={data.overallScore} label="Score" />
        <DimensionBadge dimension="consistency_analysis" changed={changed} />
      </div>
      {!hasIssues ? (
        <div className="flex items-center gap-2 text-green-700 text-sm">
          <CheckCircleOutlined /> No contradictions found
        </div>
      ) : (
        <div className="space-y-2">
          {data.contradictions.map((c, i) => (
            <div key={i} className={`border rounded-lg p-3 ${c.severity === 'HIGH' ? 'border-red-200 bg-red-50' : c.severity === 'MEDIUM' ? 'border-orange-200 bg-orange-50' : 'border-gray-200 bg-gray-50'}`}>
              <div className="flex items-center gap-2 mb-1">
                <SeverityTag severity={c.severity} />
                <span className="text-xs text-text-secondary">{c.type?.replace('_', '-')}</span>
                {c.questionRefs?.length > 0 && (
                  <span className="text-xs font-mono text-text-secondary">{c.questionRefs.join(' ↔ ')}</span>
                )}
              </div>
              <p className="text-sm">{c.description}</p>
              {c.suggestedClarification && (
                <p className="text-xs text-text-secondary mt-1 italic">
                  Suggested clarification: {c.suggestedClarification}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CompletenessPanel({ data, changed }: { data: CompletenessAnalysis | null; changed: boolean }) {
  if (!data) return <p className="text-sm text-text-secondary italic">No completeness analysis available.</p>;
  const hasGaps = (data.informationGaps?.length > 0) || (data.perQuestion?.length > 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <ScoreBar score={data.completenessScore} label="Score" />
        <DimensionBadge dimension="completeness_analysis" changed={changed} />
      </div>
      {!hasGaps ? (
        <div className="flex items-center gap-2 text-green-700 text-sm">
          <CheckCircleOutlined /> Information appears complete
        </div>
      ) : (
        <>
          {data.perQuestion?.length > 0 && (
            <div>
              <label className="text-xs text-text-secondary mb-1 block font-medium">Brief/Inadequate Answers</label>
              <div className="space-y-2">
                {data.perQuestion.map((q, i) => (
                  <div key={i} className="bg-gray-50 rounded-lg p-3 text-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs">{q.questionNo}</span>
                      <Tag color={q.quality === 'INADEQUATE' ? 'red' : 'orange'}>{q.quality}</Tag>
                    </div>
                    {q.missingDetails?.length > 0 && (
                      <p className="text-xs text-text-secondary">Missing: {q.missingDetails.join(', ')}</p>
                    )}
                    {q.suggestedFollowup && (
                      <p className="text-xs text-text-secondary mt-1 italic">{q.suggestedFollowup}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.informationGaps?.length > 0 && (
            <div>
              <label className="text-xs text-text-secondary mb-1 block font-medium">Information Gaps</label>
              <div className="space-y-2">
                {data.informationGaps.map((g, i) => (
                  <div key={i} className={`border rounded-lg p-3 text-sm ${g.importance === 'HIGH' ? 'border-red-200 bg-red-50' : g.importance === 'MEDIUM' ? 'border-orange-200 bg-orange-50' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <SeverityTag severity={g.importance} />
                      <span className="font-medium">{g.topic}</span>
                    </div>
                    <p className="text-xs text-text-secondary">{g.reason}</p>
                    {g.suggestedQuestion && (
                      <p className="text-xs mt-1 italic text-text-secondary">
                        Suggested: &quot;{g.suggestedQuestion}&quot;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AccuracyPanel({ data, changed }: { data: AccuracyAnalysis | null; changed: boolean }) {
  if (!data) return <p className="text-sm text-text-secondary italic">No accuracy analysis available.</p>;
  const hasIssues = (data.factualIssues?.length > 0) || (data.plausibilityConcerns?.length > 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <DimensionBadge dimension="accuracy_analysis" changed={changed} />
      </div>
      {!hasIssues ? (
        <div className="flex items-center gap-2 text-green-700 text-sm">
          <CheckCircleOutlined /> No factual issues detected
        </div>
      ) : (
        <>
          {data.factualIssues?.length > 0 && (
            <div className="space-y-2">
              {data.factualIssues.map((issue, i) => (
                <div key={i} className="border border-red-200 bg-red-50 rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <CloseCircleOutlined className="text-red-500" />
                    <SeverityTag severity={issue.severity} />
                    {issue.questionNo && <span className="font-mono text-xs">{issue.questionNo}</span>}
                    <Tag className="text-xs">{issue.type?.replace('_', ' ')}</Tag>
                  </div>
                  <p className="text-sm"><strong>Claim:</strong> {issue.claim}</p>
                  <p className="text-sm text-red-700"><strong>Issue:</strong> {issue.issue}</p>
                </div>
              ))}
            </div>
          )}
          {data.plausibilityConcerns?.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs text-text-secondary font-medium">Plausibility Concerns</label>
              {data.plausibilityConcerns.map((c, i) => (
                <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <WarningOutlined className="text-amber-500" />
                    <Tag color="orange" className="text-xs">{c.type?.replace('_', ' ')}</Tag>
                  </div>
                  <p>{c.description}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface AIAnalysisSectionProps {
  domainReviewId: string;
  isReadOnly?: boolean;
}

export function AIAnalysisSection({ domainReviewId, isReadOnly = false }: AIAnalysisSectionProps) {
  const queryClient = useQueryClient();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  // Fetch latest analysis
  const { data: latestAnalysis, isLoading } = useQuery<AIAnalysis>({
    queryKey: ['review-analysis', domainReviewId],
    queryFn: () => api.get(`/review-analysis/${domainReviewId}`),
    refetchInterval: (query) => {
      const d = query.state.data as AIAnalysis | undefined;
      // Poll while running
      if (d?.status === 'running' || d?.status === 'pending') return 3000;
      return false;
    },
  });

  // Fetch all versions
  const { data: versionsData } = useQuery<{ data: VersionItem[] }>({
    queryKey: ['review-analysis-versions', domainReviewId],
    queryFn: () => api.get(`/review-analysis/${domainReviewId}/versions`),
  });

  // Fetch specific version if selected
  const { data: selectedAnalysis } = useQuery<AIAnalysis>({
    queryKey: ['review-analysis-version', domainReviewId, selectedVersion],
    queryFn: () => api.get(`/review-analysis/${domainReviewId}/versions/${selectedVersion}`),
    enabled: selectedVersion !== null && selectedVersion !== latestAnalysis?.version,
  });

  // Trigger mutation
  const triggerMutation = useMutation({
    mutationFn: () =>
      api.post(`/review-analysis/${domainReviewId}/trigger`, {
        triggerEvent: 'manual',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-analysis', domainReviewId] });
      queryClient.invalidateQueries({ queryKey: ['review-analysis-versions', domainReviewId] });
    },
  });

  const analysis: AIAnalysis | undefined =
    selectedVersion !== null && selectedVersion !== latestAnalysis?.version
      ? selectedAnalysis
      : latestAnalysis;

  const versions = versionsData?.data || [];

  const isChanged = (dim: string) => {
    if (!analysis?.changedDimensions) return true; // v1 or all changed
    return analysis.changedDimensions.includes(dim);
  };

  // No analysis and not loading — show placeholder
  if (!isLoading && (!analysis || !analysis.id)) {
    return (
      <SectionCard
        title="AI Analysis"
        subtitle="Automated review intelligence"
        defaultOpen={false}
      >
        <div className="text-center py-8">
          <ExperimentOutlined className="text-3xl text-text-secondary mb-2" />
          <p className="text-sm text-text-secondary mb-3">
            AI analysis will be generated after submission.
          </p>
          {!isReadOnly && (
            <Button
              type="primary"
              icon={<ExperimentOutlined />}
              onClick={() => triggerMutation.mutate()}
              loading={triggerMutation.isPending}
            >
              Run Analysis
            </Button>
          )}
        </div>
      </SectionCard>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <SectionCard title="AI Analysis" subtitle="Loading..." defaultOpen>
        <Skeleton active paragraph={{ rows: 4 }} />
      </SectionCard>
    );
  }

  // Running/pending state
  if (analysis?.status === 'running' || analysis?.status === 'pending') {
    return (
      <SectionCard title="AI Analysis" subtitle="Analyzing..." defaultOpen>
        <div className="text-center py-8">
          <div className="animate-spin text-2xl mb-2">
            <ExperimentOutlined />
          </div>
          <p className="text-sm text-text-secondary">
            AI is analyzing {analysis.status === 'running' ? 'the review...' : 'queued...'}
          </p>
        </div>
      </SectionCard>
    );
  }

  // Failed state
  if (analysis?.status === 'failed') {
    return (
      <SectionCard title="AI Analysis" subtitle="Analysis failed" defaultOpen>
        <div className="text-center py-6">
          <CloseCircleOutlined className="text-2xl text-red-500 mb-2" />
          <p className="text-sm text-red-600 mb-1">Analysis failed</p>
          {analysis.errorMessage && (
            <p className="text-xs text-text-secondary mb-3">{analysis.errorMessage}</p>
          )}
          {!isReadOnly && (
            <Button
              icon={<ReloadOutlined />}
              onClick={() => triggerMutation.mutate()}
              loading={triggerMutation.isPending}
            >
              Re-run Analysis
            </Button>
          )}
        </div>
      </SectionCard>
    );
  }

  // Completed — show full results
  const triggerLabels: Record<string, string> = {
    submit: 'Submit',
    resubmit: 'Resubmit',
    manual: 'Manual',
  };

  const collapseItems = [
    {
      key: 'risk',
      label: (
        <div className="flex items-center gap-2">
          <SafetyCertificateOutlined />
          <span>Risk Assessment</span>
          {analysis?.riskAssessment && (
            <RiskLevelBadge level={analysis.riskAssessment.riskLevel} />
          )}
        </div>
      ),
      children: <RiskAssessmentPanel data={analysis?.riskAssessment || null} changed={isChanged('risk_assessment')} />,
    },
    {
      key: 'reference',
      label: (
        <div className="flex items-center gap-2">
          <FileSearchOutlined />
          <span>Reference Cases</span>
          {analysis?.referenceCases?.suggestedOutcome && (
            <Tag color="blue" className="text-xs">
              Suggested: {analysis.referenceCases.suggestedOutcome}
            </Tag>
          )}
        </div>
      ),
      children: <ReferenceCasesPanel data={analysis?.referenceCases || null} changed={isChanged('reference_cases')} />,
    },
    {
      key: 'consistency',
      label: (
        <div className="flex items-center gap-2">
          <SwapOutlined />
          <span>Consistency Analysis</span>
          {analysis?.consistencyAnalysis && (
            analysis.consistencyAnalysis.contradictions?.length > 0
              ? <Tag color="red">{analysis.consistencyAnalysis.contradictions.length} issue(s)</Tag>
              : <Tag color="green">Consistent</Tag>
          )}
        </div>
      ),
      children: <ConsistencyPanel data={analysis?.consistencyAnalysis || null} changed={isChanged('consistency_analysis')} />,
    },
    {
      key: 'completeness',
      label: (
        <div className="flex items-center gap-2">
          <FileTextOutlined />
          <span>Completeness Analysis</span>
          {analysis?.completenessAnalysis && (
            <span className="text-xs text-text-secondary">
              Score: {analysis.completenessAnalysis.completenessScore?.toFixed(2)}
            </span>
          )}
        </div>
      ),
      children: <CompletenessPanel data={analysis?.completenessAnalysis || null} changed={isChanged('completeness_analysis')} />,
    },
    {
      key: 'accuracy',
      label: (
        <div className="flex items-center gap-2">
          <AimOutlined />
          <span>Accuracy Analysis</span>
          {analysis?.accuracyAnalysis && (
            analysis.accuracyAnalysis.factualIssues?.length > 0
              ? <Tag color="red">{analysis.accuracyAnalysis.factualIssues.length} issue(s)</Tag>
              : <Tag color="green">No issues</Tag>
          )}
        </div>
      ),
      children: <AccuracyPanel data={analysis?.accuracyAnalysis || null} changed={isChanged('accuracy_analysis')} />,
    },
  ];

  return (
    <SectionCard
      title="AI Analysis"
      subtitle={analysis ? `Version ${analysis.version} · ${triggerLabels[analysis.triggerEvent] || analysis.triggerEvent} · ${analysis.completedAt ? new Date(analysis.completedAt).toLocaleString() : ''}` : ''}
      defaultOpen
    >
      {/* Header with score and version selector */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          {analysis?.overallScore != null && (
            <div className="w-48">
              <ScoreBar score={analysis.overallScore} label="Overall" />
            </div>
          )}
          {analysis?.summary && (
            <Tooltip title={analysis.summary}>
              <InfoCircleOutlined className="text-text-secondary cursor-pointer" />
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-2">
          {versions.length > 1 && (
            <Select
              size="small"
              value={selectedVersion ?? analysis?.version}
              onChange={(v) => setSelectedVersion(v)}
              style={{ width: 180 }}
              options={versions.map((v) => ({
                value: v.version,
                label: `v${v.version} · ${triggerLabels[v.triggerEvent] || v.triggerEvent}${v.status === 'failed' ? ' (failed)' : ''}`,
              }))}
              prefix={<HistoryOutlined />}
            />
          )}
          {!isReadOnly && (
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => triggerMutation.mutate()}
              loading={triggerMutation.isPending}
            >
              Re-run
            </Button>
          )}
        </div>
      </div>

      {/* 5 collapsible dimension sections */}
      <Collapse
        items={collapseItems}
        defaultActiveKey={['risk', 'reference', 'consistency', 'completeness', 'accuracy']}
        className="bg-white"
        size="small"
      />
    </SectionCard>
  );
}

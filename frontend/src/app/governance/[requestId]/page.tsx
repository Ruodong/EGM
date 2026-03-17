'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageLayout } from '@/components/layout/PageLayout';
import { useToast } from '@/components/ui/Toast';
import { statusColors } from '@/lib/constants';
import { ArrowLeftOutlined, CopyOutlined, InboxOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/lib/locale-context';
import { SectionCard } from '../_components/SectionCard';
import { GovernanceScopeDetermination } from '../_components/GovernanceScopeDetermination';
import { DomainPreviewChip } from '../_components/DomainPreviewChip';
import { FileUpload } from '../_components/FileUpload';
import { ProcessingLogStepper } from '../_components/ProcessingLogStepper';
import { ChangeHighlight, ChangeEntry } from '../_components/ChangeHighlight';
import { DomainQuestionnaires, DomainQuestionnairesRef } from '../_components/DomainQuestionnaires';
import { GovernanceDomainActions } from '../_components/GovernanceDomainActions';
import projectTypes from '@/config/project-types.json';
import businessUnits from '@/config/business-units.json';
import clsx from 'clsx';

interface Project {
  projectId: string;
  projectName: string;
  type: string;
  status: string;
  pm: string;
  pmItcode: string;
  dtLead: string;
  dtLeadItcode: string;
  itLead: string;
  itLeadItcode: string;
  startDate: string;
  goLiveDate: string;
  endDate: string;
  aiRelated: string;
}

interface Employee {
  itcode: string;
  name: string;
  email: string;
}

interface Attachment {
  id: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  createBy: string;
  createAt: string;
}

interface GovRequest {
  id: string;
  requestId: string;
  title: string;
  description: string;
  govProjectType: string | null;
  businessUnit: string | null;
  status: string;
  lifecycleStatus: string;
  requestor: string;
  requestorName: string;
  productSoftwareType: string | null;
  productSoftwareTypeOther: string | null;
  productEndUser: string[];
  userRegion: string[];
  thirdPartyVendor: string | null;
  projectId: string | null;
  projectType: string | null;
  projectCode: string | null;
  projectName: string | null;
  projectProjType: string | null;
  projectStatus: string | null;
  projectDescription: string | null;
  projectPm: string | null;
  projectPmItcode: string | null;
  projectDtLead: string | null;
  projectDtLeadItcode: string | null;
  projectItLead: string | null;
  projectItLeadItcode: string | null;
  projectStartDate: string | null;
  projectGoLiveDate: string | null;
  projectEndDate: string | null;
  projectAiRelated: string | null;
  requestorEmail: string | null;
  requestorManagerName: string | null;
  requestorTier1Org: string | null;
  requestorTier2Org: string | null;
  createAt: string;
  ruleCodes: string[];
}

interface ProgressData {
  totalDomains: number;
  completedDomains: number;
  progressPercent: number;
  openInfoRequests: number;
  domains: { reviewId: string; domainCode: string; status: string; outcome: string | null; reviewer: string | null }[];
}

interface ActivityLogEntry {
  id: string;
  action: string;
  entityType: string;
  domainCode: string | null;
  performedBy: string;
  performerName: string | null;
  performedAt: string | null;
  details: string;
}

export default function RequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = params.requestId as string;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, hasRole } = useAuth();
  const { t } = useLocale();

  // --- Data fetching ---
  const { data: request, isLoading } = useQuery<GovRequest>({
    queryKey: ['governance-request', requestId],
    queryFn: () => api.get(`/governance-requests/${requestId}`),
  });

  const { data: changelogData } = useQuery<{ data: ChangeEntry[] }>({
    queryKey: ['changelog', requestId],
    queryFn: () => api.get(`/governance-requests/${requestId}/changelog`),
    enabled: !!request,
  });

  const { data: activityLogData } = useQuery<{ data: ActivityLogEntry[] }>({
    queryKey: ['activity-log', requestId],
    queryFn: () => api.get(`/governance-requests/${requestId}/activity-log`),
    enabled: !!request && request.status !== 'Draft',
  });

  const activityLog: ActivityLogEntry[] = activityLogData?.data ?? [];

  const { data: progress } = useQuery<ProgressData>({
    queryKey: ['progress', requestId],
    queryFn: () => api.get(`/progress/${requestId}`),
    enabled: !!request && request.status !== 'Draft',
  });

  const { data: attachmentsData } = useQuery<{ data: Attachment[] }>({
    queryKey: ['attachments', requestId],
    queryFn: () => api.get(`/governance-requests/${requestId}/attachments`),
    enabled: !!request,
  });

  const changelog: ChangeEntry[] = changelogData?.data ?? [];

  // --- Edit state ---
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const [govProjectType, setGovProjectType] = useState('');
  const [businessUnit, setBusinessUnit] = useState('');
  const [productSoftwareType, setProductSoftwareType] = useState('');
  const [productSoftwareTypeOther, setProductSoftwareTypeOther] = useState('');
  const [productEndUser, setProductEndUser] = useState<string[]>([]);
  const [userRegion, setUserRegion] = useState<string[]>([]);
  const [thirdPartyVendor, setThirdPartyVendor] = useState('');
  const [projectType, setProjectType] = useState<'mspo' | 'non_mspo'>('mspo');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectSearch, setProjectSearch] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [nonMspo, setNonMspo] = useState({
    projectCode: '',
    projectName: '',
    projectDescription: '',
    projectPm: '',
    projectPmItcode: '',
    projectStartDate: '',
    projectGoLiveDate: '',
    projectEndDate: '',
  });

  const [pmSearch, setPmSearch] = useState('');
  const [pmResults, setPmResults] = useState<Employee[]>([]);
  const [showPmDropdown, setShowPmDropdown] = useState(false);
  const [pmLoading, setPmLoading] = useState(false);
  const pmDropdownRef = useRef<HTMLDivElement>(null);
  const pmDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [attachments, setAttachments] = useState<File[]>([]);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // --- Initialize form from fetched data ---
  useEffect(() => {
    if (!request || initialized) return;
    setSelectedRules(request.ruleCodes || []);
    setGovProjectType(request.govProjectType || '');
    setBusinessUnit(request.businessUnit || '');
    setProductSoftwareType(request.productSoftwareType || '');
    setProductSoftwareTypeOther(request.productSoftwareTypeOther || '');
    setProductEndUser(request.productEndUser || []);
    setUserRegion(request.userRegion || []);
    setThirdPartyVendor(request.thirdPartyVendor || '');

    if (request.projectType === 'non_mspo') {
      setProjectType('non_mspo');
      setNonMspo({
        projectCode: request.projectCode || '',
        projectName: request.projectName || '',
        projectDescription: request.projectDescription || '',
        projectPm: request.projectPm || '',
        projectPmItcode: request.projectPmItcode || '',
        projectStartDate: request.projectStartDate || '',
        projectGoLiveDate: request.projectGoLiveDate || '',
        projectEndDate: request.projectEndDate || '',
      });
    } else if (request.projectType === 'mspo' && request.projectId) {
      setProjectType('mspo');
      setSelectedProject({
        projectId: request.projectId,
        projectName: request.projectName || '',
        type: request.projectProjType || '',
        status: request.projectStatus || '',
        pm: request.projectPm || '',
        pmItcode: request.projectPmItcode || '',
        dtLead: request.projectDtLead || '',
        dtLeadItcode: request.projectDtLeadItcode || '',
        itLead: request.projectItLead || '',
        itLeadItcode: request.projectItLeadItcode || '',
        startDate: request.projectStartDate || '',
        goLiveDate: request.projectGoLiveDate || '',
        endDate: request.projectEndDate || '',
        aiRelated: request.projectAiRelated || '',
      });
    }
    setInitialized(true);
  }, [request, initialized]);

  // Close dropdowns on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false);
      if (pmDropdownRef.current && !pmDropdownRef.current.contains(e.target as Node)) setShowPmDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isOwner = !!user && !!request && user.id === request.requestor;
  const isReadOnly = request?.status === 'Complete' || !isOwner;
  const isEditable = !isReadOnly;
  const isScopeReadOnly = request?.status !== 'Draft' || !isOwner;  // Lock rules after submit or for non-owners
  const triggeredDomainsRef = useRef<{ domainCode: string; domainName: string }[]>([]);
  const questionnaireRef = useRef<DomainQuestionnairesRef>(null);

  // Per-domain read-only: lock domains in terminal statuses
  const TERMINAL_STATUSES = ['Approved', 'Approved with Exception', 'Not Passed'];
  const domainEditabilityMap = useMemo(() => {
    if (!progress?.domains) return {};
    const map: Record<string, boolean> = {};
    for (const d of progress.domains) {
      map[d.domainCode] = TERMINAL_STATUSES.includes(d.status);
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  // Wizard mode — only for Draft status
  const initialStep = searchParams.get('step') === '2' ? 2 : 1;
  const [wizardStep, setWizardStep] = useState<1 | 2>(initialStep as 1 | 2);
  const isDraft = request?.status === 'Draft';
  const showWizard = isDraft && isEditable;

  // Force re-render when triggered domains change (since ref doesn't trigger re-render)
  const [triggeredDomainsCount, setTriggeredDomainsCount] = useState(0);

  // Step 1 validation: domains determined + all required fields filled
  const isStep1Complete = useMemo(() => {
    if (!showWizard) return false;
    const hasDomains = triggeredDomainsRef.current.length > 0;
    const hasProjectType = !!govProjectType;
    const hasBusinessUnit = !!businessUnit;
    const hasProductType = !!productSoftwareType && (productSoftwareType !== 'Other' || !!productSoftwareTypeOther.trim());
    const hasEndUser = productEndUser.length > 0;
    const hasRegion = userRegion.length > 0;
    const hasProject = projectType === 'mspo'
      ? !!selectedProject
      : (!!nonMspo.projectCode && !!nonMspo.projectName && !!nonMspo.projectPm && !!nonMspo.projectStartDate && !!nonMspo.projectGoLiveDate);
    return hasDomains && hasProjectType && hasBusinessUnit && hasProductType && hasEndUser && hasRegion && hasProject;
  }, [showWizard, govProjectType, businessUnit, productSoftwareType, productSoftwareTypeOther, productEndUser, userRegion, projectType, selectedProject, nonMspo, triggeredDomainsCount]);

  // --- Project search ---
  const searchProjects = useCallback(async (query: string) => {
    if (!query.trim()) { setProjects([]); return; }
    setProjectLoading(true);
    try {
      const res = await api.get<{ data: Project[] }>('/projects', { search: query, pageSize: 10 });
      setProjects(res.data);
    } catch { setProjects([]); } finally { setProjectLoading(false); }
  }, []);

  const handleProjectSearchChange = (value: string) => {
    setProjectSearch(value);
    setShowDropdown(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchProjects(value), 300);
  };

  const selectProject = (p: Project) => { setSelectedProject(p); setProjectSearch(''); setShowDropdown(false); };
  const clearProject = () => { setSelectedProject(null); setProjectSearch(''); };

  // --- PM search ---
  const searchEmployees = useCallback(async (query: string) => {
    if (!query.trim()) { setPmResults([]); return; }
    setPmLoading(true);
    try {
      const res = await api.get<{ data: Employee[] }>('/employees/search', { q: query });
      setPmResults(res.data);
    } catch { setPmResults([]); } finally { setPmLoading(false); }
  }, []);

  const handlePmSearchChange = (value: string) => {
    setPmSearch(value);
    setShowPmDropdown(true);
    if (pmDebounceRef.current) clearTimeout(pmDebounceRef.current);
    pmDebounceRef.current = setTimeout(() => searchEmployees(value), 300);
  };

  const selectPm = (emp: Employee) => {
    setNonMspo((prev) => ({ ...prev, projectPm: emp.name, projectPmItcode: emp.itcode }));
    setPmSearch(''); setShowPmDropdown(false);
  };

  const clearPm = () => {
    setNonMspo((prev) => ({ ...prev, projectPm: '', projectPmItcode: '' }));
    setPmSearch('');
  };

  // --- Submit ---
  const submitMutation = useMutation({
    mutationFn: () => api.put(`/governance-requests/${requestId}/submit`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-request', requestId] });
      queryClient.invalidateQueries({ queryKey: ['changelog', requestId] });
      queryClient.invalidateQueries({ queryKey: ['activity-log', requestId] });
      toast(t('govDetail.requestSubmitted'), 'success');
    },
    onError: (err: unknown) => {
      const detail = (err as { detail?: string })?.detail;
      toast(detail || t('govDetail.failedSubmit'), 'error');
    },
  });

  // --- Copy ---
  const copyMutation = useMutation({
    mutationFn: () => api.post<{ requestId: string }>(`/governance-requests/${requestId}/copy`, {}),
    onSuccess: (res) => {
      toast(`${t('govDetail.requestCopied')} ${res.requestId}`, 'success');
      router.push(`/governance/${res.requestId}`);
    },
    onError: () => toast(t('govDetail.failedCopy'), 'error'),
  });

  // --- Cancel (Draft only, owner) ---
  const cancelMutation = useMutation({
    mutationFn: () => api.put(`/governance-requests/${requestId}/cancel`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-request', requestId] });
      toast(t('govDetail.requestCancelled'), 'success');
      router.push('/requests');
    },
    onError: (err: unknown) => {
      const detail = (err as { detail?: string })?.detail;
      toast(detail || t('govDetail.failedCancel'), 'error');
    },
  });

  // --- Archive (Completed only, admin/governance_lead) ---
  const archiveMutation = useMutation({
    mutationFn: () => api.put(`/governance-requests/${requestId}/archive`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-request', requestId] });
      toast(t('govDetail.requestArchived'), 'success');
    },
    onError: (err: unknown) => {
      const detail = (err as { detail?: string })?.detail;
      toast(detail || t('govDetail.failedArchive'), 'error');
    },
  });

  // --- Resubmit (Return for Additional Information → Waiting for Accept) ---
  const resubmitMutation = useMutation({
    mutationFn: async () => {
      // Resubmit all domain reviews that are in "Return for Additional Information" status
      const returnedDomains = progress?.domains.filter(d => d.status === 'Return for Additional Information') || [];
      if (returnedDomains.length === 0) throw new Error('No returned domains to resubmit');
      await Promise.all(returnedDomains.map(d => api.put(`/domain-reviews/${d.reviewId}/resubmit`, {})));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-request', requestId] });
      queryClient.invalidateQueries({ queryKey: ['progress', requestId] });
      queryClient.invalidateQueries({ queryKey: ['changelog', requestId] });
      queryClient.invalidateQueries({ queryKey: ['activity-log', requestId] });
      toast(t('govDetail.resubmitted'), 'success');
    },
    onError: (err: unknown) => {
      const detail = (err as { detail?: string })?.detail;
      toast(detail || t('govDetail.failedResubmit'), 'error');
    },
  });

  // --- Save ---
  const handleSave = async (validate = true): Promise<boolean> => {
    // Flush any pending questionnaire saves before validation/submit
    if (questionnaireRef.current) {
      await questionnaireRef.current.flushPendingSaves();
    }
    // Validate required fields only when explicitly requested (Submit / Save Changes)
    if (validate) {
      const errors: Record<string, string> = {};
      if (!govProjectType) errors.govProjectType = t('govDetail.projectTypeRequired');
      if (!businessUnit) errors.businessUnit = t('govDetail.businessUnitRequired');
      if (projectType === 'mspo' && !selectedProject) {
        errors.projectId = t('govDetail.selectMspoProject');
      }
      if (projectType === 'non_mspo') {
        if (!nonMspo.projectCode) errors.projectCode = t('govDetail.projectCodeRequired');
        if (!nonMspo.projectName) errors.projectName = t('govDetail.projectNameRequired');
        if (!nonMspo.projectPm) errors.projectPm = t('govDetail.projectPmRequired');
        if (!nonMspo.projectStartDate) errors.projectStartDate = t('govDetail.startDateRequired');
        if (!nonMspo.projectGoLiveDate) errors.projectGoLiveDate = t('govDetail.goLiveDateRequired');
      }
      if (!productSoftwareType) errors.productSoftwareType = t('govDetail.productTypeRequired');
      if (productSoftwareType === 'Other' && !productSoftwareTypeOther.trim()) errors.productSoftwareTypeOther = t('govDetail.specifyType');
      if (productEndUser.length === 0) errors.productEndUser = t('govDetail.endUserRequired');
      if (userRegion.length === 0) errors.userRegion = t('govDetail.regionRequired');
      if (request?.status === 'Draft' && triggeredDomainsRef.current.length === 0 && selectedRules.length === 0) errors.domains = t('govDetail.domainsRequired');
      // Validate domain questionnaires completion
      if (request?.status === 'Draft' && questionnaireRef.current) {
        const incomplete = questionnaireRef.current.getIncompleteDomains();
        if (incomplete.length > 0) errors.questionnaires = `${t('govDetail.incompleteQuestionnaires')} ${incomplete.join(', ')}`;
      }
      if (Object.keys(errors).length > 0) { setValidationErrors(errors); toast(t('govDetail.fillRequired'), 'error'); return false; }
      setValidationErrors({});
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ...(request?.status === 'Draft' ? { ruleCodes: selectedRules } : {}),
        govProjectType: govProjectType || undefined,
        businessUnit: businessUnit || undefined,
        productSoftwareType,
        productSoftwareTypeOther: productSoftwareType === 'Other' ? productSoftwareTypeOther : undefined,
        productEndUser,
        userRegion,
        thirdPartyVendor: thirdPartyVendor.trim() || undefined,
      };

      if (projectType === 'mspo' && selectedProject) {
        payload.projectType = 'mspo';
        payload.projectId = selectedProject.projectId;
      } else if (projectType === 'non_mspo' && (nonMspo.projectCode || nonMspo.projectName)) {
        payload.projectType = 'non_mspo';
        payload.projectCode = nonMspo.projectCode;
        payload.projectName = nonMspo.projectName;
        payload.projectDescription = nonMspo.projectDescription;
        payload.projectPm = nonMspo.projectPm;
        payload.projectPmItcode = nonMspo.projectPmItcode || undefined;
        payload.projectStartDate = nonMspo.projectStartDate;
        payload.projectGoLiveDate = nonMspo.projectGoLiveDate;
        payload.projectEndDate = nonMspo.projectEndDate;
      }

      await api.put(`/governance-requests/${requestId}`, payload);

      // Upload new attachments
      for (const file of attachments) {
        const formData = new FormData();
        formData.append('file', file);
        try {
          await api.upload(`/governance-requests/${requestId}/attachments`, formData);
        } catch {
          toast(`${t('govDetail.failedUpload')} ${file.name}`, 'error');
        }
      }
      setAttachments([]);

      queryClient.invalidateQueries({ queryKey: ['governance-request', requestId] });
      queryClient.invalidateQueries({ queryKey: ['changelog', requestId] });
      queryClient.invalidateQueries({ queryKey: ['activity-log', requestId] });
      queryClient.invalidateQueries({ queryKey: ['attachments', requestId] });
      toast(t('govDetail.changesSaved'), 'success');
      return true;
    } catch {
      toast(t('govDetail.failedSave'), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

  if (isLoading) return <PageLayout><p>{t('common.loading')}</p></PageLayout>;
  if (!request) return <PageLayout><p>{t('govDetail.requestNotFound')}</p></PageLayout>;

  return (
    <PageLayout>
      <div className="max-w-2xl mx-auto">
        {/* Back button */}
        <button
          type="button"
          onClick={() => router.push('/requests')}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary-blue mb-4 transition-colors"
          data-testid="back-to-list-btn"
        >
          <ArrowLeftOutlined />
          {t('govDetail.backToRequests')}
        </button>

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-xl font-bold">
              {request.requestId}
              {request.projectName && <span className="text-text-secondary font-normal"> · {request.projectName}</span>}
            </h1>
            <div className="flex items-center gap-3 mt-2">
              <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[request.status] || 'bg-gray-400')}>
                {request.status}
              </span>
              {request.govProjectType && (
                <span className="px-2 py-0.5 rounded text-xs text-white" style={{ backgroundColor: '#722ED1' }}>
                  {projectTypes.find((pt) => pt.value === request.govProjectType)?.label || request.govProjectType}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Processing Log Stepper */}
        <div className="bg-white rounded-lg border border-border-light p-4 mb-4">
          <ProcessingLogStepper
            currentStatus={request.status}
          />
        </div>

        {/* Request Activity Log — shown after submit */}
        {request.status !== 'Draft' && activityLog.length > 0 && (
          <div className="bg-white rounded-lg border border-border-light p-4 mb-4" data-testid="request-activity-log-section">
            <label className="block text-sm font-medium mb-3 text-text-secondary">{t('govDetail.requestActivityLog')}</label>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-light text-left text-text-secondary">
                    <th className="pb-2 pr-4 font-medium">{t('domainReview.actionCol')}</th>
                    <th className="pb-2 pr-4 font-medium">{t('domainReview.userCol')}</th>
                    <th className="pb-2 pr-4 font-medium">{t('domainReview.timeCol')}</th>
                    <th className="pb-2 font-medium">{t('domainReview.detailsCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activityLog.map((entry) => (
                    <tr key={entry.id} className="border-b border-border-light last:border-0">
                      <td className="py-2 pr-4 whitespace-nowrap">
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                          {entry.action}
                        </span>
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">{entry.performerName || entry.performedBy || '-'}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-text-secondary">
                        {entry.performedAt ? new Date(entry.performedAt).toLocaleString() : '-'}
                      </td>
                      <td className="py-2 text-text-secondary max-w-xs truncate">
                        {entry.details || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Applicable Governance Domains — shown after submit */}
        {request.status !== 'Draft' && (
          <div className="bg-white rounded-lg border border-border-light p-4 mb-4" data-testid="applicable-domains-section">
            <label className="block text-sm font-medium mb-2 text-text-secondary">{t('govDetail.applicableGovernanceDomains')}</label>
            <ApplicableDomainsDisplay ruleCodes={request.ruleCodes} />
          </div>
        )}

        {/* Wizard Step Indicator — only for Draft wizard mode */}
        {showWizard && (
          <div className="flex items-center gap-3 mb-4" data-testid="wizard-steps">
            <div className={clsx('flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium',
              wizardStep === 1 ? 'bg-egm-teal text-white' : 'bg-gray-100 text-text-secondary'
            )}>
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">1</span>
              {t('govCreate.projectInfo')}
            </div>
            <div className="text-text-secondary">→</div>
            <div className={clsx('flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium',
              wizardStep === 2 ? 'bg-egm-teal text-white' : 'bg-gray-100 text-text-secondary'
            )}>
              <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">2</span>
              {t('govCreate.domainQuestionnaires')}
            </div>
          </div>
        )}

        {/* Form sections */}
        <div className="space-y-4">
          {/* === WIZARD STEP 1 (or non-wizard: always show) === */}
          {(!showWizard || wizardStep === 1) && (<>
          {/* Section 1: Governance Scope Determination */}
          <SectionCard title={t('govCreate.scopeDetermination')} subtitle={t('govCreate.scopeSubtitle')}>
            {isScopeReadOnly ? (
              <div data-testid="rules-readonly">
                <ReadOnlyRulesDisplay ruleCodes={request.ruleCodes || []} />
              </div>
            ) : (
              <ChangeHighlight fieldName="ruleCodes" changelog={changelog}>
                <GovernanceScopeDetermination
                  selectedRules={selectedRules}
                  onRulesChange={(rules) => { setSelectedRules(rules); setValidationErrors(prev => { const n = {...prev}; delete n.domains; return n; }); }}
                  onTriggeredDomainsChange={(domains) => { triggeredDomainsRef.current = domains; setTriggeredDomainsCount(domains.length); }}
                />
                {validationErrors.domains && <p className="text-red-500 text-xs mt-2">{validationErrors.domains}</p>}
              </ChangeHighlight>
            )}
          </SectionCard>

          {/* Section: Requestor Information (read-only, from employee_info) */}
          <SectionCard title={t('domainReview.requestorInfo')} defaultOpen>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-text-secondary">{t('domainReview.itCode')}</label>
                <div className="px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">{request.requestor || '-'}</div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-text-secondary">{t('common.name')}</label>
                <div className="px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">{request.requestorName || '-'}</div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-text-secondary">{t('domainReview.emailAddress')}</label>
                <div className="px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">{request.requestorEmail || '-'}</div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-text-secondary">{t('domainReview.lineManager')}</label>
                <div className="px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">{request.requestorManagerName || '-'}</div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-text-secondary">{t('domainReview.t1Org')}</label>
                <div className="px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">{request.requestorTier1Org || '-'}</div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-text-secondary">{t('domainReview.t2Org')}</label>
                <div className="px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">{request.requestorTier2Org || '-'}</div>
              </div>
            </div>
          </SectionCard>

          {/* Section 2: Project Information */}
          <SectionCard title={t('govCreate.projectInfo')}>
            <div className="space-y-4">
              {/* Request ID */}
              <div>
                <label className="block text-sm font-medium mb-1">{t('col.requestId')}</label>
                <div className="px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm text-text-secondary" data-testid="request-id-value">
                  {request.requestId}
                </div>
              </div>

              {/* Project Type + Business Unit */}
              <div className="grid grid-cols-2 gap-4">
                <ChangeHighlight fieldName="govProjectType" changelog={changelog}>
                  <div>
                    <label className="block text-sm font-medium mb-1">{t('govCreate.projectType')} <span className="text-red-500">*</span></label>
                    {isReadOnly ? (
                      <div className="px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">{govProjectType || '-'}</div>
                    ) : (
                      <>
                        <select
                          className={`select-field ${validationErrors.govProjectType ? 'border-red-400' : ''}`}
                          value={govProjectType}
                          onChange={(e) => { setGovProjectType(e.target.value); setValidationErrors((v) => { const { govProjectType: _, ...rest } = v; return rest; }); }}
                          data-testid="select-gov-project-type"
                        >
                          <option value="">{t('govCreate.selectProjectType')}</option>
                          {projectTypes.map((pt) => (
                            <option key={pt.value} value={pt.value}>{pt.label}</option>
                          ))}
                        </select>
                        {validationErrors.govProjectType && <p className="text-xs text-red-500 mt-1">{validationErrors.govProjectType}</p>}
                      </>
                    )}
                  </div>
                </ChangeHighlight>
                <ChangeHighlight fieldName="businessUnit" changelog={changelog}>
                  <div>
                    <label className="block text-sm font-medium mb-1">{t('govCreate.businessUnit')} <span className="text-red-500">*</span></label>
                    {isReadOnly ? (
                      <div className="px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">{businessUnit || '-'}</div>
                    ) : (
                      <>
                        <select
                          className={`select-field ${validationErrors.businessUnit ? 'border-red-400' : ''}`}
                          value={businessUnit}
                          onChange={(e) => { setBusinessUnit(e.target.value); setValidationErrors((v) => { const { businessUnit: _, ...rest } = v; return rest; }); }}
                          data-testid="select-business-unit"
                        >
                          <option value="">{t('govCreate.selectBusinessUnit')}</option>
                          {businessUnits.map((bu) => (
                            <option key={bu.value} value={bu.value}>{bu.label}</option>
                          ))}
                        </select>
                        {validationErrors.businessUnit && <p className="text-xs text-red-500 mt-1">{validationErrors.businessUnit}</p>}
                      </>
                    )}
                  </div>
                </ChangeHighlight>
              </div>

              {/* Project Type Toggle */}
              {isReadOnly ? (
                <div>
                  <label className="block text-sm font-medium mb-2">{t('govCreate.project')}</label>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-text-secondary">
                    {request.projectType === 'mspo' ? 'MSPO' : 'Non-MSPO'}
                  </span>
                  <div className="grid grid-cols-2 gap-3 p-3 mt-2 bg-gray-50 rounded-lg border border-border-light">
                    {request.projectCode && <ReadOnlyField label={t('govCreate.projectCode')} value={request.projectCode} />}
                    {request.projectName && <ReadOnlyField label={t('col.projectName')} value={request.projectName} />}
                    {request.projectProjType && <ReadOnlyField label={t('common.type')} value={request.projectProjType} />}
                    {request.projectStatus && <ReadOnlyField label={t('common.status')} value={request.projectStatus} />}
                    {request.projectPm && <ReadOnlyField label="PM" value={`${request.projectPm}${request.projectPmItcode ? ` (${request.projectPmItcode})` : ''}`} />}
                    {request.projectDtLead && <ReadOnlyField label="DT Lead" value={request.projectDtLead} />}
                    {request.projectItLead && <ReadOnlyField label="IT Lead" value={request.projectItLead} />}
                    {request.projectStartDate && <ReadOnlyField label={t('govCreate.startDate')} value={request.projectStartDate} />}
                    {request.projectGoLiveDate && <ReadOnlyField label={t('govCreate.goLiveDate')} value={request.projectGoLiveDate} />}
                    {request.projectEndDate && <ReadOnlyField label={t('govCreate.endDate')} value={request.projectEndDate} />}
                    {request.projectAiRelated && <ReadOnlyField label="AI Related" value={request.projectAiRelated} />}
                    {request.projectDescription && (
                      <div className="col-span-2"><ReadOnlyField label={t('common.description')} value={request.projectDescription} /></div>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-2">{t('govCreate.project')} <span className="text-red-500">*</span></label>
                  <div className="flex gap-2 mb-3" data-testid="project-type-toggle">
                    <button
                      type="button"
                      onClick={() => setProjectType('mspo')}
                      className={clsx('px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                        projectType === 'mspo' ? 'bg-egm-teal text-white' : 'bg-gray-100 text-text-secondary hover:bg-gray-200'
                      )}
                      data-testid="btn-mspo"
                    >
                      {t('govCreate.mspoProject')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setProjectType('non_mspo')}
                      className={clsx('px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                        projectType === 'non_mspo' ? 'bg-egm-teal text-white' : 'bg-gray-100 text-text-secondary hover:bg-gray-200'
                      )}
                      data-testid="btn-non-mspo"
                    >
                      {t('govCreate.nonMspoProject')}
                    </button>
                  </div>

                  {projectType === 'mspo' ? (
                    <div className="space-y-3">
                      <div ref={dropdownRef} className="relative">
                        {selectedProject ? (
                          <div className="flex items-center gap-2">
                            <span className="flex-1 px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">
                              {selectedProject.projectId} — {selectedProject.projectName || 'Untitled'}
                            </span>
                            <button type="button" onClick={clearProject} className="text-sm text-red-500 hover:text-red-700">{t('domainReview.clear')}</button>
                          </div>
                        ) : (
                          <input
                            className={`input-field ${validationErrors.projectId ? 'border-red-400' : ''}`}
                            placeholder={t('govCreate.searchProject')}
                            value={projectSearch}
                            onChange={(e) => { handleProjectSearchChange(e.target.value); setValidationErrors(prev => { const { projectId: _, ...rest } = prev; return rest; }); }}
                            onFocus={() => { if (projectSearch.trim()) setShowDropdown(true); }}
                            data-testid="input-project-search"
                          />
                        )}
                        {showDropdown && (
                          <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-border-light rounded-lg shadow-lg max-h-60 overflow-y-auto">
                            {projectLoading && <div className="px-3 py-2 text-sm text-text-secondary">{t('govCreate.searching')}</div>}
                            {!projectLoading && projects.length === 0 && projectSearch.trim() && <div className="px-3 py-2 text-sm text-text-secondary">{t('govCreate.noProjects')}</div>}
                            {projects.map((p) => (
                              <button key={p.projectId} type="button" onClick={() => selectProject(p)} className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-border-light last:border-0">
                                <div className="text-sm font-medium">{p.projectId}</div>
                                <div className="text-xs text-text-secondary">{p.projectName || 'Untitled'} {p.pm ? `· PM: ${p.pm}` : ''}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {validationErrors.projectId && <p className="text-xs text-red-500 mt-1">{validationErrors.projectId}</p>}
                      {selectedProject && (
                        <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg border border-border-light" data-testid="mspo-project-details">
                          <ReadOnlyField label={t('govCreate.projectCode')} value={selectedProject.projectId} />
                          <ReadOnlyField label={t('col.projectName')} value={selectedProject.projectName} />
                          <ReadOnlyField label={t('common.type')} value={selectedProject.type} />
                          <ReadOnlyField label={t('common.status')} value={selectedProject.status} />
                          <ReadOnlyField label="PM" value={selectedProject.pm} />
                          <ReadOnlyField label="DT Lead" value={selectedProject.dtLead} />
                          <ReadOnlyField label="IT Lead" value={selectedProject.itLead} />
                          <ReadOnlyField label={t('govCreate.startDate')} value={selectedProject.startDate} />
                          <ReadOnlyField label={t('govCreate.goLiveDate')} value={selectedProject.goLiveDate} />
                          <ReadOnlyField label={t('govCreate.endDate')} value={selectedProject.endDate} />
                          <ReadOnlyField label="AI Related" value={selectedProject.aiRelated} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3" data-testid="non-mspo-form">
                      <div className="grid grid-cols-2 gap-3">
                        <ChangeHighlight fieldName="projectCode" changelog={changelog}>
                          <div>
                            <label className="block text-xs font-medium text-text-secondary mb-1">{t('govCreate.projectCode')} <span className="text-red-500">*</span></label>
                            <input className={`input-field ${validationErrors.projectCode ? 'border-red-400' : ''}`} value={nonMspo.projectCode} onChange={(e) => { setNonMspo({ ...nonMspo, projectCode: e.target.value }); setValidationErrors((v) => { const { projectCode: _, ...rest } = v; return rest; }); }} data-testid="input-project-code" />
                            {validationErrors.projectCode && <p className="text-xs text-red-500 mt-1">{validationErrors.projectCode}</p>}
                          </div>
                        </ChangeHighlight>
                        <ChangeHighlight fieldName="projectName" changelog={changelog}>
                          <div>
                            <label className="block text-xs font-medium text-text-secondary mb-1">{t('col.projectName')} <span className="text-red-500">*</span></label>
                            <input className={`input-field ${validationErrors.projectName ? 'border-red-400' : ''}`} value={nonMspo.projectName} onChange={(e) => { setNonMspo({ ...nonMspo, projectName: e.target.value }); setValidationErrors((v) => { const { projectName: _, ...rest } = v; return rest; }); }} data-testid="input-project-name" />
                            {validationErrors.projectName && <p className="text-xs text-red-500 mt-1">{validationErrors.projectName}</p>}
                          </div>
                        </ChangeHighlight>
                      </div>
                      <ChangeHighlight fieldName="projectDescription" changelog={changelog}>
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">{t('common.description')}</label>
                          <textarea className="input-field h-20" value={nonMspo.projectDescription} onChange={(e) => setNonMspo({ ...nonMspo, projectDescription: e.target.value })} data-testid="input-project-description" />
                        </div>
                      </ChangeHighlight>
                      <ChangeHighlight fieldName="projectPm" changelog={changelog}>
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">{t('govCreate.projectManager')} <span className="text-red-500">*</span></label>
                          {validationErrors.projectPm && <p className="text-xs text-red-500 mb-1">{validationErrors.projectPm}</p>}
                          <div ref={pmDropdownRef} className="relative">
                            {nonMspo.projectPmItcode ? (
                              <div className="flex items-center gap-2">
                                <span className="flex-1 px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm" data-testid="pm-selected">
                                  {nonMspo.projectPm} ({nonMspo.projectPmItcode})
                                </span>
                                <button type="button" onClick={clearPm} className="text-sm text-red-500 hover:text-red-700">{t('domainReview.clear')}</button>
                              </div>
                            ) : (
                              <input className="input-field" placeholder={t('govCreate.searchEmployee')} value={pmSearch} onChange={(e) => handlePmSearchChange(e.target.value)} onFocus={() => { if (pmSearch.trim()) setShowPmDropdown(true); }} data-testid="input-project-pm" />
                            )}
                            {showPmDropdown && (
                              <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-border-light rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                {pmLoading && <div className="px-3 py-2 text-sm text-text-secondary">{t('govCreate.searching')}</div>}
                                {!pmLoading && pmResults.length === 0 && pmSearch.trim() && <div className="px-3 py-2 text-sm text-text-secondary">{t('govCreate.noEmployees')}</div>}
                                {pmResults.map((emp) => (
                                  <button key={emp.itcode} type="button" onClick={() => selectPm(emp)} className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-border-light last:border-0" data-testid={`pm-option-${emp.itcode}`}>
                                    <div className="text-sm font-medium">{emp.itcode}</div>
                                    <div className="text-xs text-text-secondary">{emp.name}{emp.email ? ` · ${emp.email}` : ''}</div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </ChangeHighlight>
                      <div className="grid grid-cols-3 gap-3">
                        <ChangeHighlight fieldName="projectStartDate" changelog={changelog}>
                          <div>
                            <label className="block text-xs font-medium text-text-secondary mb-1">{t('govCreate.startDate')} <span className="text-red-500">*</span></label>
                            <input type="date" className={`input-field ${validationErrors.projectStartDate ? 'border-red-400' : ''}`} value={nonMspo.projectStartDate} onChange={(e) => { setNonMspo({ ...nonMspo, projectStartDate: e.target.value }); setValidationErrors((v) => { const { projectStartDate: _, ...rest } = v; return rest; }); }} data-testid="input-project-start-date" />
                            {validationErrors.projectStartDate && <p className="text-xs text-red-500 mt-1">{validationErrors.projectStartDate}</p>}
                          </div>
                        </ChangeHighlight>
                        <ChangeHighlight fieldName="projectGoLiveDate" changelog={changelog}>
                          <div>
                            <label className="block text-xs font-medium text-text-secondary mb-1">{t('govCreate.goLiveDate')} <span className="text-red-500">*</span></label>
                            <input type="date" className={`input-field ${validationErrors.projectGoLiveDate ? 'border-red-400' : ''}`} value={nonMspo.projectGoLiveDate} onChange={(e) => { setNonMspo({ ...nonMspo, projectGoLiveDate: e.target.value }); setValidationErrors((v) => { const { projectGoLiveDate: _, ...rest } = v; return rest; }); }} data-testid="input-project-go-live-date" />
                            {validationErrors.projectGoLiveDate && <p className="text-xs text-red-500 mt-1">{validationErrors.projectGoLiveDate}</p>}
                          </div>
                        </ChangeHighlight>
                        <ChangeHighlight fieldName="projectEndDate" changelog={changelog}>
                          <div>
                            <label className="block text-xs font-medium text-text-secondary mb-1">{t('govCreate.endDate')}</label>
                            <input type="date" className="input-field" value={nonMspo.projectEndDate} onChange={(e) => setNonMspo({ ...nonMspo, projectEndDate: e.target.value })} data-testid="input-project-end-date" />
                          </div>
                        </ChangeHighlight>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Attachments */}
              {isEditable && <FileUpload files={attachments} onChange={setAttachments} />}
              {attachmentsData && attachmentsData.data.length > 0 && (
                <div data-testid="attachments-card">
                  <label className="block text-sm font-medium mb-2">{t('govDetail.existingAttachments')}</label>
                  <ul className="space-y-1">
                    {attachmentsData.data.map((att) => (
                      <li key={att.id} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded">
                        <span className="font-medium truncate">{att.fileName}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-text-secondary text-xs">
                            {att.fileSize < 1024 ? `${att.fileSize} B` : att.fileSize < 1048576 ? `${(att.fileSize / 1024).toFixed(1)} KB` : `${(att.fileSize / 1048576).toFixed(1)} MB`}
                          </span>
                          <a href={`${API_BASE}/governance-requests/${requestId}/attachments/${att.id}`} className="text-egm-teal hover:underline text-xs" download>{t('common.download')}</a>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Section 3: Business & Product Information */}
          <SectionCard title={t('govCreate.businessProductInfo')}>
            <div className="space-y-4">
              <ChangeHighlight fieldName="productSoftwareType" changelog={changelog}>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('govCreate.productType')} <span className="text-red-500">*</span></label>
                  {isReadOnly ? (
                    <div className="px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">
                      {productSoftwareType === 'Other' ? productSoftwareTypeOther : productSoftwareType || '-'}
                    </div>
                  ) : (
                    <>
                      <select
                        data-testid="select-product-software-type"
                        className={`select-field ${validationErrors.productSoftwareType ? 'border-red-400' : ''}`}
                        value={productSoftwareType}
                        onChange={(e) => {
                          setProductSoftwareType(e.target.value);
                          if (e.target.value !== 'Other') setProductSoftwareTypeOther('');
                          setValidationErrors(prev => { const n = {...prev}; delete n.productSoftwareType; delete n.productSoftwareTypeOther; return n; });
                        }}
                      >
                        <option value="">{t('govCreate.selectOption')}</option>
                        <option value="Hardware">{t('govCreate.hardware')}</option>
                        <option value="Software-Client based">{t('govCreate.softwareClient')}</option>
                        <option value="Software-Web Based">{t('govCreate.softwareWeb')}</option>
                        <option value="Other">{t('govCreate.other')}</option>
                      </select>
                      {validationErrors.productSoftwareType && <p className="text-red-500 text-xs mt-1">{validationErrors.productSoftwareType}</p>}
                      {productSoftwareType === 'Other' && (
                        <div className="mt-2">
                          <input
                            data-testid="input-product-software-type-other"
                            className={`input-field ${validationErrors.productSoftwareTypeOther ? 'border-red-400' : ''}`}
                            placeholder={t('govCreate.pleaseSpecify')}
                            value={productSoftwareTypeOther}
                            onChange={(e) => {
                              setProductSoftwareTypeOther(e.target.value);
                              setValidationErrors(prev => { const n = {...prev}; delete n.productSoftwareTypeOther; return n; });
                            }}
                          />
                          {validationErrors.productSoftwareTypeOther && <p className="text-red-500 text-xs mt-1">{validationErrors.productSoftwareTypeOther}</p>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </ChangeHighlight>

              <ChangeHighlight fieldName="productEndUser" changelog={changelog}>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('govCreate.productEndUser')} <span className="text-red-500">*</span></label>
                  {isReadOnly ? (
                    <div className="px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">{productEndUser.join(', ') || '-'}</div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {[
                          { value: 'Lenovo internal employee/contractors', label: t('govCreate.endUserInternal'), id: 'internal' },
                          { value: 'Lenovo partners (such as distributors, resellers, service partner, etc.)', label: t('govCreate.endUserPartners'), id: 'partners' },
                          { value: 'External customer-facing', label: t('govCreate.endUserExternal'), id: 'external' },
                        ].map(({ value: option, label, id }) => (
                          <label key={option} className="flex items-start gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              data-testid={`checkbox-end-user-${id}`}
                              checked={productEndUser.includes(option)}
                              onChange={(e) => {
                                setProductEndUser(prev => e.target.checked ? [...prev, option] : prev.filter(v => v !== option));
                                setValidationErrors(prev => { const n = {...prev}; delete n.productEndUser; return n; });
                              }}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                      {validationErrors.productEndUser && <p className="text-red-500 text-xs mt-1">{validationErrors.productEndUser}</p>}
                    </>
                  )}
                </div>
              </ChangeHighlight>

              <ChangeHighlight fieldName="userRegion" changelog={changelog}>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('govCreate.userRegion')} <span className="text-red-500">*</span></label>
                  {isReadOnly ? (
                    <div className="px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">{userRegion.join(', ') || '-'}</div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-4">
                        {['PRC', 'EMEA', 'AP', 'LA', 'NA', 'META'].map((region) => (
                          <label key={region} className="flex items-center gap-1.5 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              data-testid={`checkbox-region-${region.toLowerCase()}`}
                              checked={userRegion.includes(region)}
                              onChange={(e) => {
                                setUserRegion(prev => e.target.checked ? [...prev, region] : prev.filter(v => v !== region));
                                setValidationErrors(prev => { const n = {...prev}; delete n.userRegion; return n; });
                              }}
                            />
                            <span>{region}</span>
                          </label>
                        ))}
                      </div>
                      {validationErrors.userRegion && <p className="text-red-500 text-xs mt-1">{validationErrors.userRegion}</p>}
                    </>
                  )}
                </div>
              </ChangeHighlight>

              <ChangeHighlight fieldName="thirdPartyVendor" changelog={changelog}>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('govCreate.thirdPartyVendor')}</label>
                  {isReadOnly ? (
                    <div className="px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">{thirdPartyVendor || '-'}</div>
                  ) : (
                    <input
                      data-testid="input-third-party-vendor"
                      className="input-field"
                      placeholder={t('govCreate.thirdPartyPlaceholder')}
                      value={thirdPartyVendor}
                      onChange={(e) => setThirdPartyVendor(e.target.value)}
                    />
                  )}
                </div>
              </ChangeHighlight>
            </div>
          </SectionCard>

          </>)}

          {/* === WIZARD STEP 2 (or non-wizard Draft: always show) === */}
          {(!showWizard || wizardStep === 2) && (
            <>
            {/* Domain Questionnaires — Draft: fully editable */}
            {request.status === 'Draft' && (
              <SectionCard title={t('govDetail.domainQuestionnaires')} subtitle={t('govDetail.domainQuestionnairesSubtitle')}>
                <DomainQuestionnaires
                  ref={questionnaireRef}
                  requestId={requestId}
                />
                {validationErrors.questionnaires && (
                  <p className="text-red-500 text-sm mt-2">{validationErrors.questionnaires}</p>
                )}
              </SectionCard>
            )}
            </>
          )}

          {/* Domain Questionnaires — always visible for non-Draft, per-domain editability */}
          {request.status !== 'Draft' && (
            <SectionCard title={t('govDetail.domainQuestionnaires')} subtitle={t('govDetail.domainQuestionnairesSubtitle')}>
              <DomainQuestionnaires
                requestId={requestId}
                readOnly={!isOwner}
                domainReadOnly={domainEditabilityMap}
                changelog={changelog}
              />
            </SectionCard>
          )}

          {/* Governance Domain Actions — action items grouped by domain */}
          {request.status !== 'Draft' && (
            <SectionCard title={t('govDetail.governanceDomainActions')} subtitle={t('govDetail.governanceDomainActionsSubtitle')} defaultOpen>
              <GovernanceDomainActions requestId={requestId} />
            </SectionCard>
          )}

          {/* Review Progress */}
          {progress && progress.totalDomains > 0 && (
            <SectionCard title={t('govDetail.reviewProgress')}>
              <div>
                <div className="mb-4">
                  <div className="flex justify-between text-sm mb-1">
                    <span>{progress.completedDomains}/{progress.totalDomains} {t('govDetail.domainsComplete')}</span>
                    <span>{progress.progressPercent}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-egm-teal h-2 rounded-full transition-all" style={{ width: `${progress.progressPercent}%` }} />
                  </div>
                </div>
                <div className="space-y-2">
                  {progress.domains.map((d) => (
                    <div key={d.domainCode} className="flex items-center justify-between text-sm p-2 bg-bg-gray rounded">
                      <span className="font-medium">{d.domainCode}</span>
                      <span className={clsx('px-2 py-0.5 rounded text-xs text-white', statusColors[d.status] || 'bg-gray-400')}>
                        {d.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>
          )}

          {/* Action buttons */}
          <div className="flex justify-between pt-2 pb-8">
            {/* Left side — secondary actions */}
            <div className="flex gap-3">
              {isOwner && (
                <Button
                  type="default"
                  icon={<CopyOutlined />}
                  disabled={copyMutation.isPending}
                  onClick={() => copyMutation.mutate()}
                  data-testid="copy-request-btn"
                >
                  {copyMutation.isPending ? t('govDetail.copying') : t('govDetail.copyRequest')}
                </Button>
              )}
              {isOwner && request.status === 'Draft' && request.lifecycleStatus === 'Active' && (
                <Button
                  danger
                  icon={<CloseCircleOutlined />}
                  disabled={cancelMutation.isPending}
                  onClick={() => { if (confirm(t('govDetail.cancelConfirm'))) cancelMutation.mutate(); }}
                  data-testid="cancel-request-btn"
                >
                  {cancelMutation.isPending ? t('govDetail.cancelling') : t('govDetail.cancelRequest')}
                </Button>
              )}
              {hasRole('admin', 'governance_lead') && request.status === 'Complete' && request.lifecycleStatus === 'Active' && (
                <Button
                  type="default"
                  icon={<InboxOutlined />}
                  disabled={archiveMutation.isPending}
                  onClick={() => { if (confirm(t('govDetail.archiveConfirm'))) archiveMutation.mutate(); }}
                  data-testid="archive-request-btn"
                >
                  {archiveMutation.isPending ? t('govDetail.archiving') : t('govDetail.archive')}
                </Button>
              )}
            </div>
            {/* Right side — primary actions */}
            <div className="flex gap-3">
              {/* Wizard Step 1 buttons */}
              {showWizard && wizardStep === 1 && (
                <>
                  <Button type="default" onClick={() => router.push('/requests')} data-testid="back-btn">{t('common.back')}</Button>
                  <Button
                    type="default"
                    disabled={saving}
                    onClick={() => handleSave(false)}
                    data-testid="save-draft-btn"
                  >
                    {saving ? t('common.saving') : t('common.save')}
                  </Button>
                  <Button
                    type="primary"
                    style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
                    disabled={!isStep1Complete || saving}
                    onClick={async () => {
                      const ok = await handleSave(false);
                      if (ok) setWizardStep(2);
                    }}
                    data-testid="next-step-btn"
                  >
                    {saving ? t('common.saving') : t('common.next')}
                  </Button>
                </>
              )}
              {/* Wizard Step 2 buttons */}
              {showWizard && wizardStep === 2 && (
                <>
                  <Button type="default" onClick={() => setWizardStep(1)} data-testid="back-step-btn">{t('common.back')}</Button>
                  <Button
                    type="default"
                    disabled={saving}
                    onClick={() => handleSave(false)}
                    data-testid="save-draft-btn"
                  >
                    {saving ? t('common.saving') : t('common.save')}
                  </Button>
                  <Button
                    type="primary"
                    style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
                    disabled={submitMutation.isPending}
                    onClick={async () => {
                      const ok = await handleSave();
                      if (ok) submitMutation.mutate();
                    }}
                    data-testid="submit-request-btn"
                  >
                    {submitMutation.isPending ? t('govDetail.submitting') : t('govDetail.submitRequest')}
                  </Button>
                </>
              )}
              {/* Non-wizard buttons (non-Draft or read-only) */}
              {!showWizard && (
                <>
                  <Button type="default" onClick={() => router.push('/requests')} data-testid="back-btn">{t('common.back')}</Button>
                  {isEditable && (
                    <>
                      {request.status === 'Draft' && (
                        <>
                          <Button
                            type="default"
                            disabled={saving}
                            onClick={() => handleSave(false)}
                            data-testid="save-draft-btn"
                          >
                            {saving ? t('common.saving') : t('common.save')}
                          </Button>
                          <Button
                            type="primary"
                            style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
                            disabled={submitMutation.isPending}
                            onClick={async () => {
                              const ok = await handleSave();
                              if (ok) submitMutation.mutate();
                            }}
                            data-testid="submit-request-btn"
                          >
                            {submitMutation.isPending ? t('govDetail.submitting') : t('govDetail.submitRequest')}
                          </Button>
                        </>
                      )}
                      {(request.status === 'Submitted' || request.status === 'In Progress') && (
                        <Button
                          type="primary"
                          style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
                          disabled={saving}
                          onClick={() => handleSave()}
                          data-testid="save-changes-btn"
                        >
                          {saving ? t('common.saving') : t('govDetail.saveChanges')}
                        </Button>
                      )}
                      {progress?.domains.some(d => d.status === 'Return for Additional Information') && (
                        <Button
                          type="primary"
                          style={{ background: '#13C2C2', borderColor: '#13C2C2' }}
                          disabled={resubmitMutation.isPending}
                          onClick={() => {
                            if (confirm(t('govDetail.resubmitConfirm'))) resubmitMutation.mutate();
                          }}
                          data-testid="resubmit-btn"
                        >
                          {resubmitMutation.isPending ? t('govDetail.resubmitting') : t('govDetail.resubmit')}
                        </Button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs text-text-secondary">{label}</div>
      <div className="text-sm text-text-primary">{value || '—'}</div>
    </div>
  );
}

interface MatrixData {
  rules: { ruleCode: string; ruleName: string; parentRuleCode: string | null }[];
  domains: { domainCode: string; domainName: string }[];
  matrix: Record<string, Record<string, string>>;
}

function ReadOnlyRulesDisplay({ ruleCodes }: { ruleCodes: string[] }) {
  const { t } = useLocale();
  const { data: matrixData, isLoading } = useQuery<MatrixData>({
    queryKey: ['dispatch-rules-matrix'],
    queryFn: () => api.get('/dispatch-rules/matrix'),
  });

  if (isLoading) return <span className="text-xs text-text-secondary">{t('domainReview.loadingRules')}</span>;
  if (!ruleCodes.length) return <span className="text-sm text-text-secondary">{t('domainReview.noRulesSelected')}</span>;

  // Build lookup and group by L1/L2
  const ruleMap = new Map(matrixData?.rules.map((r) => [r.ruleCode, r]) || []);
  const selectedSet = new Set(ruleCodes);

  // Compute auto-parent codes
  const autoParents = new Set<string>();
  for (const code of ruleCodes) {
    const rule = ruleMap.get(code);
    if (rule?.parentRuleCode) autoParents.add(rule.parentRuleCode);
  }

  // Group: L1 parents with their selected L2 children
  type Group = { parent: { ruleCode: string; ruleName: string }; children: { ruleCode: string; ruleName: string }[] };
  const groups: Group[] = [];
  const usedCodes = new Set<string>();

  // First, gather L1 parents that have selected L2 children
  for (const parentCode of autoParents) {
    const parentRule = ruleMap.get(parentCode);
    if (!parentRule) continue;
    const children = ruleCodes
      .filter((c) => ruleMap.get(c)?.parentRuleCode === parentCode)
      .map((c) => ({ ruleCode: c, ruleName: ruleMap.get(c)?.ruleName || c }));
    groups.push({ parent: { ruleCode: parentCode, ruleName: parentRule.ruleName }, children });
    usedCodes.add(parentCode);
    children.forEach((ch) => usedCodes.add(ch.ruleCode));
  }

  // Then, gather standalone L1 rules (selected directly, no children selected)
  for (const code of ruleCodes) {
    if (usedCodes.has(code)) continue;
    const rule = ruleMap.get(code);
    if (!rule || rule.parentRuleCode) continue; // skip L2 orphans
    groups.push({ parent: { ruleCode: code, ruleName: rule.ruleName }, children: [] });
    usedCodes.add(code);
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.parent.ruleCode}>
          {/* L1 parent chip */}
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-text-primary bg-gray-100">
            {group.parent.ruleName}
            <span className="text-xs opacity-70">({group.parent.ruleCode})</span>
          </span>
          {/* L2 children indented */}
          {group.children.length > 0 && (
            <div className="ml-6 mt-1.5 flex flex-wrap gap-1.5">
              {group.children.map((child) => (
                <span key={child.ruleCode} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-text-primary bg-gray-100">
                  {child.ruleName}
                  <span className="text-xs opacity-70">({child.ruleCode})</span>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ApplicableDomainsDisplay({ ruleCodes }: { ruleCodes: string[] }) {
  const { t } = useLocale();
  const { data: matrixData, isLoading } = useQuery<MatrixData>({
    queryKey: ['dispatch-rules-matrix'],
    queryFn: () => api.get('/dispatch-rules/matrix'),
  });

  const triggeredDomains = useMemo(() => {
    if (!matrixData || !ruleCodes) return [];
    const domainSet = new Set<string>();

    // Compute auto parent codes
    const parentCodes = new Set<string>();
    for (const rc of ruleCodes) {
      const rule = matrixData.rules.find((r) => r.ruleCode === rc);
      if (rule?.parentRuleCode) parentCodes.add(rule.parentRuleCode);
    }

    // Domains from selected rules
    for (const rc of ruleCodes) {
      const ruleMatrix = matrixData.matrix[rc];
      if (!ruleMatrix) continue;
      for (const [domainCode, rel] of Object.entries(ruleMatrix)) {
        if (rel === 'in') domainSet.add(domainCode);
      }
    }

    // Domains from auto-aggregated parents
    for (const pc of parentCodes) {
      const parentMatrix = matrixData.matrix[pc];
      if (!parentMatrix) continue;
      for (const [domainCode, rel] of Object.entries(parentMatrix)) {
        if (rel === 'in') domainSet.add(domainCode);
      }
    }

    return matrixData.domains.filter((d) => domainSet.has(d.domainCode));
  }, [ruleCodes, matrixData]);

  if (isLoading) return <span className="text-xs text-text-secondary">{t('domainReview.loadingDomains')}</span>;

  if (triggeredDomains.length === 0) {
    return <span className="text-xs text-text-secondary italic">{t('domainReview.noDomainsTriggered')}</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {triggeredDomains.map((domain) => (
        <DomainPreviewChip key={domain.domainCode} domainCode={domain.domainCode} domainName={domain.domainName} />
      ))}
    </div>
  );
}

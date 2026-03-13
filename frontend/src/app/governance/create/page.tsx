'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { SectionCard } from '../_components/SectionCard';
import { GovernanceScopeDetermination } from '../_components/GovernanceScopeDetermination';
import { FileUpload } from '../_components/FileUpload';
import projectTypes from '@/config/project-types.json';
import businessUnits from '@/config/business-units.json';

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

export default function CreateRequestPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const [govProjectType, setGovProjectType] = useState('');
  const [businessUnit, setBusinessUnit] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Business & Product Information
  const [productSoftwareType, setProductSoftwareType] = useState('');
  const [productSoftwareTypeOther, setProductSoftwareTypeOther] = useState('');
  const [productEndUser, setProductEndUser] = useState<string[]>([]);
  const [userRegion, setUserRegion] = useState<string[]>([]);
  const [thirdPartyVendor, setThirdPartyVendor] = useState('');

  // Project type toggle (MSPO / Non-MSPO)
  const [projectType, setProjectType] = useState<'mspo' | 'non_mspo'>('mspo');

  // MSPO project search state
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Non-MSPO manual fields
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

  // PM itcode search state (Non-MSPO)
  const [pmSearch, setPmSearch] = useState('');
  const [pmResults, setPmResults] = useState<Employee[]>([]);
  const [showPmDropdown, setShowPmDropdown] = useState(false);
  const [pmLoading, setPmLoading] = useState(false);
  const pmDropdownRef = useRef<HTMLDivElement>(null);
  const pmDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Close dropdowns on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
      if (pmDropdownRef.current && !pmDropdownRef.current.contains(e.target as Node)) {
        setShowPmDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const searchProjects = useCallback(async (query: string) => {
    if (!query.trim()) {
      setProjects([]);
      return;
    }
    setProjectLoading(true);
    try {
      const res = await api.get<{ data: Project[] }>('/projects', { search: query, pageSize: 10 });
      setProjects(res.data);
    } catch {
      setProjects([]);
    } finally {
      setProjectLoading(false);
    }
  }, []);

  const handleProjectSearchChange = (value: string) => {
    setProjectSearch(value);
    setShowDropdown(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchProjects(value), 300);
  };

  const selectProject = (p: Project) => {
    setSelectedProject(p);
    setProjectSearch('');
    setShowDropdown(false);
  };

  const clearProject = () => {
    setSelectedProject(null);
    setProjectSearch('');
  };

  // PM employee search (Non-MSPO)
  const searchEmployees = useCallback(async (query: string) => {
    if (!query.trim()) {
      setPmResults([]);
      return;
    }
    setPmLoading(true);
    try {
      const res = await api.get<{ data: Employee[] }>('/employees/search', { q: query });
      setPmResults(res.data);
    } catch {
      setPmResults([]);
    } finally {
      setPmLoading(false);
    }
  }, []);

  const handlePmSearchChange = (value: string) => {
    setPmSearch(value);
    setShowPmDropdown(true);
    if (pmDebounceRef.current) clearTimeout(pmDebounceRef.current);
    pmDebounceRef.current = setTimeout(() => searchEmployees(value), 300);
  };

  const selectPm = (emp: Employee) => {
    setNonMspo({ ...nonMspo, projectPm: emp.name, projectPmItcode: emp.itcode });
    setPmSearch('');
    setShowPmDropdown(false);
  };

  const clearPm = () => {
    setNonMspo({ ...nonMspo, projectPm: '', projectPmItcode: '' });
    setPmSearch('');
  };

  // MSPO cache fix: switching modes does NOT clear the other mode's data
  const handleProjectTypeChange = (type: 'mspo' | 'non_mspo') => {
    setProjectType(type);
    // Both modes' data are preserved in state independently.
    // Only the active mode's data is sent on submit.
  };

  const submitActionRef = useRef<'save' | 'submit'>('save');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const action = submitActionRef.current;

    // Frontend validation for required fields — only on Submit, not Save Draft
    if (action === 'submit') {
      const errors: Record<string, string> = {};
      if (!govProjectType) errors.govProjectType = 'Project Type is required';
      if (!businessUnit) errors.businessUnit = 'Business Unit is required';
      if (projectType === 'non_mspo') {
        if (!nonMspo.projectCode) errors.projectCode = 'Project Code is required';
        if (!nonMspo.projectName) errors.projectName = 'Project Name is required';
        if (!nonMspo.projectPm) errors.projectPm = 'Project Manager is required';
        if (!nonMspo.projectStartDate) errors.projectStartDate = 'Start Date is required';
        if (!nonMspo.projectGoLiveDate) errors.projectGoLiveDate = 'Go Live Date is required';
      }
      if (!productSoftwareType) errors.productSoftwareType = 'Product/Software Type is required';
      if (productSoftwareType === 'Other' && !productSoftwareTypeOther.trim()) errors.productSoftwareTypeOther = 'Please specify the type';
      if (productEndUser.length === 0) errors.productEndUser = 'At least one end user must be selected';
      if (userRegion.length === 0) errors.userRegion = 'At least one region must be selected';
      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
        return;
      }
      setValidationErrors({});
    }

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        ruleCodes: selectedRules,
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

      const result = await api.post<{ requestId: string }>('/governance-requests', payload);

      // Upload attachments after request creation
      for (const file of attachments) {
        const formData = new FormData();
        formData.append('file', file);
        try {
          await api.upload(`/governance-requests/${result.requestId}/attachments`, formData);
        } catch {
          toast(`Failed to upload ${file.name}`, 'error');
        }
      }

      // If submitting, transition from Draft to Submitted
      if (action === 'submit') {
        await api.put(`/governance-requests/${result.requestId}/submit`, {});
        toast('Governance request submitted', 'success');
      } else {
        toast('Governance request saved as draft', 'success');
      }

      router.push(`/governance/${result.requestId}`);
    } catch {
      toast('Failed to create request', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageLayout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold mb-6">Create Governance Request</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Section 1: Governance Scope Determination */}
          <SectionCard title="Governance Scope Determination" subtitle="Select applicable compliance rules to determine governance domains">
            <GovernanceScopeDetermination
              selectedRules={selectedRules}
              onRulesChange={setSelectedRules}
            />
          </SectionCard>

          {/* Section 2: Project Information */}
          <SectionCard title="Project Information">
            <div className="space-y-4">
              {/* Request ID — auto-generated by backend */}
              <div>
                <label className="block text-sm font-medium mb-1">Request ID</label>
                <div className="px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm text-text-secondary" data-testid="request-id-placeholder">
                  Auto-generated upon submission
                </div>
              </div>

              {/* Project Type + Business Unit — side by side */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Project Type <span className="text-red-500">*</span></label>
                  <select
                    className={`select-field ${validationErrors.govProjectType ? 'border-red-400' : ''}`}
                    value={govProjectType}
                    onChange={(e) => { setGovProjectType(e.target.value); setValidationErrors((v) => { const { govProjectType: _, ...rest } = v; return rest; }); }}
                    data-testid="select-gov-project-type"
                  >
                    <option value="">-- Select Project Type --</option>
                    {projectTypes.map((pt) => (
                      <option key={pt.value} value={pt.value}>{pt.label}</option>
                    ))}
                  </select>
                  {validationErrors.govProjectType && <p className="text-xs text-red-500 mt-1">{validationErrors.govProjectType}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Business Unit <span className="text-red-500">*</span></label>
                  <select
                    className={`select-field ${validationErrors.businessUnit ? 'border-red-400' : ''}`}
                    value={businessUnit}
                    onChange={(e) => { setBusinessUnit(e.target.value); setValidationErrors((v) => { const { businessUnit: _, ...rest } = v; return rest; }); }}
                    data-testid="select-business-unit"
                  >
                    <option value="">-- Select Business Unit --</option>
                    {businessUnits.map((bu) => (
                      <option key={bu.value} value={bu.value}>{bu.label}</option>
                    ))}
                  </select>
                  {validationErrors.businessUnit && <p className="text-xs text-red-500 mt-1">{validationErrors.businessUnit}</p>}
                </div>
              </div>

              {/* Project Type Toggle (MSPO / Non-MSPO) */}
              <div>
                <label className="block text-sm font-medium mb-2">Project</label>
                <div className="flex gap-2 mb-3" data-testid="project-type-toggle">
                  <button
                    type="button"
                    onClick={() => handleProjectTypeChange('mspo')}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      projectType === 'mspo'
                        ? 'bg-egm-teal text-white'
                        : 'bg-gray-100 text-text-secondary hover:bg-gray-200'
                    }`}
                    data-testid="btn-mspo"
                  >
                    MSPO Project
                  </button>
                  <button
                    type="button"
                    onClick={() => handleProjectTypeChange('non_mspo')}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      projectType === 'non_mspo'
                        ? 'bg-egm-teal text-white'
                        : 'bg-gray-100 text-text-secondary hover:bg-gray-200'
                    }`}
                    data-testid="btn-non-mspo"
                  >
                    Non-MSPO Project
                  </button>
                </div>

                {projectType === 'mspo' ? (
                  /* MSPO Mode — Project Search */
                  <div className="space-y-3">
                    <div ref={dropdownRef} className="relative">
                      {selectedProject ? (
                        <div className="flex items-center gap-2">
                          <span className="flex-1 px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">
                            {selectedProject.projectId} — {selectedProject.projectName || 'Untitled'}
                          </span>
                          <button type="button" onClick={clearProject} className="text-sm text-red-500 hover:text-red-700">
                            Clear
                          </button>
                        </div>
                      ) : (
                        <input
                          className="input-field"
                          placeholder="Search by project ID or name..."
                          value={projectSearch}
                          onChange={(e) => handleProjectSearchChange(e.target.value)}
                          onFocus={() => { if (projectSearch.trim()) setShowDropdown(true); }}
                          data-testid="input-project-search"
                        />
                      )}
                      {showDropdown && (
                        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-border-light rounded-lg shadow-lg max-h-60 overflow-y-auto">
                          {projectLoading && (
                            <div className="px-3 py-2 text-sm text-text-secondary">Searching...</div>
                          )}
                          {!projectLoading && projects.length === 0 && projectSearch.trim() && (
                            <div className="px-3 py-2 text-sm text-text-secondary">No projects found</div>
                          )}
                          {projects.map((p) => (
                            <button
                              key={p.projectId}
                              type="button"
                              onClick={() => selectProject(p)}
                              className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-border-light last:border-0"
                            >
                              <div className="text-sm font-medium">{p.projectId}</div>
                              <div className="text-xs text-text-secondary">{p.projectName || 'Untitled'} {p.pm ? `· PM: ${p.pm}` : ''}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* MSPO Read-only Project Details */}
                    {selectedProject && (
                      <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg border border-border-light" data-testid="mspo-project-details">
                        <ReadOnlyField label="Project Code" value={selectedProject.projectId} />
                        <ReadOnlyField label="Project Name" value={selectedProject.projectName} />
                        <ReadOnlyField label="Type" value={selectedProject.type} />
                        <ReadOnlyField label="Status" value={selectedProject.status} />
                        <ReadOnlyField label="PM" value={selectedProject.pm} />
                        <ReadOnlyField label="DT Lead" value={selectedProject.dtLead} />
                        <ReadOnlyField label="IT Lead" value={selectedProject.itLead} />
                        <ReadOnlyField label="Start Date" value={selectedProject.startDate} />
                        <ReadOnlyField label="Go Live Date" value={selectedProject.goLiveDate} />
                        <ReadOnlyField label="End Date" value={selectedProject.endDate} />
                        <ReadOnlyField label="AI Related" value={selectedProject.aiRelated} />
                      </div>
                    )}
                  </div>
                ) : (
                  /* Non-MSPO Mode — Manual Form */
                  <div className="space-y-3" data-testid="non-mspo-form">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">Project Code <span className="text-red-500">*</span></label>
                        <input
                          className={`input-field ${validationErrors.projectCode ? 'border-red-400' : ''}`}
                          value={nonMspo.projectCode}
                          onChange={(e) => { setNonMspo({ ...nonMspo, projectCode: e.target.value }); setValidationErrors((v) => { const { projectCode: _, ...rest } = v; return rest; }); }}
                          data-testid="input-project-code"
                        />
                        {validationErrors.projectCode && <p className="text-xs text-red-500 mt-1">{validationErrors.projectCode}</p>}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">Project Name <span className="text-red-500">*</span></label>
                        <input
                          className={`input-field ${validationErrors.projectName ? 'border-red-400' : ''}`}
                          value={nonMspo.projectName}
                          onChange={(e) => { setNonMspo({ ...nonMspo, projectName: e.target.value }); setValidationErrors((v) => { const { projectName: _, ...rest } = v; return rest; }); }}
                          data-testid="input-project-name"
                        />
                        {validationErrors.projectName && <p className="text-xs text-red-500 mt-1">{validationErrors.projectName}</p>}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Description</label>
                      <textarea
                        className="input-field h-20"
                        value={nonMspo.projectDescription}
                        onChange={(e) => setNonMspo({ ...nonMspo, projectDescription: e.target.value })}
                        data-testid="input-project-description"
                      />
                    </div>
                    {/* PM Autocomplete by itcode */}
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Project Manager <span className="text-red-500">*</span></label>
                      {validationErrors.projectPm && <p className="text-xs text-red-500 mb-1">{validationErrors.projectPm}</p>}
                      <div ref={pmDropdownRef} className="relative">
                        {nonMspo.projectPmItcode ? (
                          <div className="flex items-center gap-2">
                            <span className="flex-1 px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm" data-testid="pm-selected">
                              {nonMspo.projectPm} ({nonMspo.projectPmItcode})
                            </span>
                            <button type="button" onClick={clearPm} className="text-sm text-red-500 hover:text-red-700">
                              Clear
                            </button>
                          </div>
                        ) : (
                          <input
                            className="input-field"
                            placeholder="Search by itcode or name..."
                            value={pmSearch}
                            onChange={(e) => handlePmSearchChange(e.target.value)}
                            onFocus={() => { if (pmSearch.trim()) setShowPmDropdown(true); }}
                            data-testid="input-project-pm"
                          />
                        )}
                        {showPmDropdown && (
                          <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-border-light rounded-lg shadow-lg max-h-60 overflow-y-auto">
                            {pmLoading && (
                              <div className="px-3 py-2 text-sm text-text-secondary">Searching...</div>
                            )}
                            {!pmLoading && pmResults.length === 0 && pmSearch.trim() && (
                              <div className="px-3 py-2 text-sm text-text-secondary">No employees found</div>
                            )}
                            {pmResults.map((emp) => (
                              <button
                                key={emp.itcode}
                                type="button"
                                onClick={() => selectPm(emp)}
                                className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-border-light last:border-0"
                                data-testid={`pm-option-${emp.itcode}`}
                              >
                                <div className="text-sm font-medium">{emp.itcode}</div>
                                <div className="text-xs text-text-secondary">{emp.name}{emp.email ? ` · ${emp.email}` : ''}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">Start Date <span className="text-red-500">*</span></label>
                        <input
                          type="date"
                          className={`input-field ${validationErrors.projectStartDate ? 'border-red-400' : ''}`}
                          value={nonMspo.projectStartDate}
                          onChange={(e) => { setNonMspo({ ...nonMspo, projectStartDate: e.target.value }); setValidationErrors((v) => { const { projectStartDate: _, ...rest } = v; return rest; }); }}
                          data-testid="input-project-start-date"
                        />
                        {validationErrors.projectStartDate && <p className="text-xs text-red-500 mt-1">{validationErrors.projectStartDate}</p>}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">Go Live Date <span className="text-red-500">*</span></label>
                        <input
                          type="date"
                          className={`input-field ${validationErrors.projectGoLiveDate ? 'border-red-400' : ''}`}
                          value={nonMspo.projectGoLiveDate}
                          onChange={(e) => { setNonMspo({ ...nonMspo, projectGoLiveDate: e.target.value }); setValidationErrors((v) => { const { projectGoLiveDate: _, ...rest } = v; return rest; }); }}
                          data-testid="input-project-go-live-date"
                        />
                        {validationErrors.projectGoLiveDate && <p className="text-xs text-red-500 mt-1">{validationErrors.projectGoLiveDate}</p>}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">End Date</label>
                        <input
                          type="date"
                          className="input-field"
                          value={nonMspo.projectEndDate}
                          onChange={(e) => setNonMspo({ ...nonMspo, projectEndDate: e.target.value })}
                          data-testid="input-project-end-date"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Attachments */}
              <FileUpload files={attachments} onChange={setAttachments} />
            </div>
          </SectionCard>

          {/* Section 3: Business & Product Information */}
          <SectionCard title="Business & Product Information">
            <div className="space-y-4">
              {/* Product/Software Type */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Product/Software Type <span className="text-red-500">*</span>
                </label>
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
                  <option value="">-- Select --</option>
                  <option value="Hardware">Hardware</option>
                  <option value="Software-Client based">Software-Client based</option>
                  <option value="Software-Web Based">Software-Web Based</option>
                  <option value="Other">Other</option>
                </select>
                {validationErrors.productSoftwareType && <p className="text-red-500 text-xs mt-1">{validationErrors.productSoftwareType}</p>}
                {productSoftwareType === 'Other' && (
                  <div className="mt-2">
                    <input
                      data-testid="input-product-software-type-other"
                      className={`input-field ${validationErrors.productSoftwareTypeOther ? 'border-red-400' : ''}`}
                      placeholder="Please specify..."
                      value={productSoftwareTypeOther}
                      onChange={(e) => {
                        setProductSoftwareTypeOther(e.target.value);
                        setValidationErrors(prev => { const n = {...prev}; delete n.productSoftwareTypeOther; return n; });
                      }}
                    />
                    {validationErrors.productSoftwareTypeOther && <p className="text-red-500 text-xs mt-1">{validationErrors.productSoftwareTypeOther}</p>}
                  </div>
                )}
              </div>

              {/* Product/Project End User */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Product/Project End User <span className="text-red-500">*</span>
                </label>
                <div className="space-y-2">
                  {[
                    { value: 'Lenovo internal employee/contractors', id: 'internal' },
                    { value: 'Lenovo partners (such as distributors, resellers, service partner, etc.)', id: 'partners' },
                    { value: 'External customer-facing', id: 'external' },
                  ].map(({ value: option, id }) => (
                    <label key={option} className="flex items-start gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        data-testid={`checkbox-end-user-${id}`}
                        checked={productEndUser.includes(option)}
                        onChange={(e) => {
                          setProductEndUser(prev =>
                            e.target.checked ? [...prev, option] : prev.filter(v => v !== option)
                          );
                          setValidationErrors(prev => { const n = {...prev}; delete n.productEndUser; return n; });
                        }}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
                {validationErrors.productEndUser && <p className="text-red-500 text-xs mt-1">{validationErrors.productEndUser}</p>}
              </div>

              {/* User Region */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  User Region <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-4">
                  {['PRC', 'EMEA', 'AP', 'LA', 'NA', 'META'].map((region) => (
                    <label key={region} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        data-testid={`checkbox-region-${region.toLowerCase()}`}
                        checked={userRegion.includes(region)}
                        onChange={(e) => {
                          setUserRegion(prev =>
                            e.target.checked ? [...prev, region] : prev.filter(v => v !== region)
                          );
                          setValidationErrors(prev => { const n = {...prev}; delete n.userRegion; return n; });
                        }}
                      />
                      <span>{region}</span>
                    </label>
                  ))}
                </div>
                {validationErrors.userRegion && <p className="text-red-500 text-xs mt-1">{validationErrors.userRegion}</p>}
              </div>

              {/* Third-party Vendor Involvement */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Third-party Vendor Involvement
                </label>
                <input
                  data-testid="input-third-party-vendor"
                  className="input-field"
                  placeholder="Describe any third-party vendor involvement..."
                  value={thirdPartyVendor}
                  onChange={(e) => setThirdPartyVendor(e.target.value)}
                />
              </div>
            </div>
          </SectionCard>

          {/* Action buttons */}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="btn-default" onClick={() => router.back()} data-testid="cancel-btn">Cancel</button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium border border-border-light rounded-lg hover:bg-gray-50 transition-colors"
              disabled={loading}
              onClick={() => { submitActionRef.current = 'save'; }}
              data-testid="save-draft-btn"
            >
              {loading && submitActionRef.current === 'save' ? 'Saving...' : 'Save'}
            </button>
            <button
              type="submit"
              className="btn-teal"
              disabled={loading}
              onClick={() => { submitActionRef.current = 'submit'; }}
              data-testid="submit-request-btn"
            >
              {loading && submitActionRef.current === 'submit' ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
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

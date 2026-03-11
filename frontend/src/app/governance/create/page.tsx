'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { PageLayout } from '@/components/layout/PageLayout';

interface Project {
  projectId: string;
  projectName: string;
  status: string;
  pm: string;
}

export default function CreateRequestPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    projectId: '',
    organization: '',
    priority: 'Normal',
    targetDate: '',
  });

  // Project search state
  const [projectSearch, setProjectSearch] = useState('');
  const [projectLabel, setProjectLabel] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
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
    setForm({ ...form, projectId: p.projectId });
    setProjectLabel(`${p.projectId} — ${p.projectName || 'Untitled'}`);
    setProjectSearch('');
    setShowDropdown(false);
  };

  const clearProject = () => {
    setForm({ ...form, projectId: '' });
    setProjectLabel('');
    setProjectSearch('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast('Title is required', 'error');
      return;
    }

    setLoading(true);
    try {
      const result = await api.post<{ requestId: string }>('/governance-requests', form);
      toast('Governance request created', 'success');
      router.push(`/governance/${result.requestId}`);
    } catch (err) {
      toast('Failed to create request', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageLayout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold mb-6">Create Governance Request</h1>
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-border-light p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input className="input-field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea className="input-field h-24" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>

          {/* Project selector */}
          <div ref={dropdownRef} className="relative">
            <label className="block text-sm font-medium mb-1">Project</label>
            {projectLabel ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 px-3 py-2 rounded-lg border border-border-light bg-gray-50 text-sm">
                  {projectLabel}
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Organization</label>
              <input className="input-field" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Priority</label>
              <select className="select-field" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="Low">Low</option>
                <option value="Normal">Normal</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Target Date</label>
            <input type="date" className="input-field" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" className="btn-default" onClick={() => router.back()}>Cancel</button>
            <button type="submit" className="btn-teal" disabled={loading}>
              {loading ? 'Creating...' : 'Create Request'}
            </button>
          </div>
        </form>
      </div>
    </PageLayout>
  );
}

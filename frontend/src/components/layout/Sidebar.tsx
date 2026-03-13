'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { sidebarNavItems, type NavItem } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import clsx from 'clsx';

function NavLink({ item, depth = 0, collapsed = false }: { item: NavItem; depth?: number; collapsed?: boolean }) {
  const pathname = usePathname();
  const { hasPermission } = useAuth();
  const [expanded, setExpanded] = useState(false);

  // Check own permission
  if (item.requiredResource && !hasPermission(item.requiredResource, item.requiredScope || 'read')) {
    return null;
  }

  // Filter children by permission — hide parent if no children are visible
  const visibleChildren = item.children?.filter(
    (child) => !child.requiredResource || hasPermission(child.requiredResource, child.requiredScope || 'read')
  );
  const hasChildren = visibleChildren && visibleChildren.length > 0;

  // If item originally had children but none are visible after filtering, hide parent
  if (item.children && item.children.length > 0 && !hasChildren) {
    return null;
  }

  const isActive = pathname === item.href;
  const Icon = item.icon;

  // Collapsed mode: show only icons, no children, link everything
  if (collapsed) {
    return (
      <div className="relative group">
        <Link
          href={item.href}
          className={clsx(
            'flex items-center justify-center py-2.5 mx-1 rounded-md transition-colors',
            isActive ? 'bg-primary-blue/10 text-primary-blue' : 'text-text-primary hover:bg-gray-50'
          )}
          title={item.label}
        >
          <Icon className="w-4 h-4" />
        </Link>
        {/* Tooltip on hover */}
        <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
          {item.label}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className={clsx(
          'flex items-center gap-2 px-4 py-2 text-sm cursor-pointer rounded-md mx-2 transition-colors',
          isActive ? 'bg-primary-blue/10 text-primary-blue font-medium' : 'text-text-primary hover:bg-gray-50',
          depth > 0 && 'pl-10'
        )}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          <>
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{item.label}</span>
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </>
        ) : (
          <Link href={item.href} className="flex items-center gap-2 w-full">
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span>{item.label}</span>
          </Link>
        )}
      </div>
      {hasChildren && expanded && (
        <div>
          {visibleChildren!.map((child) => (
            <NavLink key={child.href} item={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <div className="relative flex-shrink-0">
      <aside
        className={clsx(
          'border-r border-border-light bg-white h-full overflow-y-auto flex flex-col transition-all duration-200',
          collapsed ? 'w-sidebar-collapsed' : 'w-sidebar'
        )}
      >
        <nav className="flex flex-col gap-1 flex-1 py-4">
          {sidebarNavItems.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} />
          ))}
        </nav>
      </aside>

      {/* Floating circle toggle on right edge */}
      <button
        onClick={onToggle}
        className="absolute top-5 -right-3 z-20 w-6 h-6 rounded-full bg-white border border-border-light shadow-sm flex items-center justify-center text-text-secondary hover:text-primary-blue hover:border-primary-blue transition-colors"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        data-testid="sidebar-toggle-btn"
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5" />
        ) : (
          <ChevronLeft className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}

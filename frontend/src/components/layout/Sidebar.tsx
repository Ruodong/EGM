'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { sidebarNavItems, type NavItem } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import clsx from 'clsx';

function NavLink({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const pathname = usePathname();
  const { hasPermission } = useAuth();
  const [expanded, setExpanded] = useState(false);

  if (item.requiredResource && !hasPermission(item.requiredResource, item.requiredScope || 'read')) {
    return null;
  }

  const isActive = pathname === item.href;
  const hasChildren = item.children && item.children.length > 0;
  const Icon = item.icon;

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
          {item.children!.map((child) => (
            <NavLink key={child.href} item={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="w-sidebar border-r border-border-light bg-white flex-shrink-0 overflow-y-auto py-4">
      <nav className="flex flex-col gap-1">
        {sidebarNavItems.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>
    </aside>
  );
}

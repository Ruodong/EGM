'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { Layout, Menu, Button, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  HomeOutlined,
  FileProtectOutlined,
  AuditOutlined,
  UnorderedListOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  SettingOutlined,
  QuestionCircleOutlined,
  SafetyOutlined,
  TeamOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { sidebarNavItems, type NavItem } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';

const { Sider } = Layout;

// Map lucide icon component names → antd icons
const ICON_MAP: Record<string, React.ReactNode> = {
  Home: <HomeOutlined />,
  FileCheck: <FileProtectOutlined />,
  ClipboardCheck: <AuditOutlined />,
  ListTodo: <UnorderedListOutlined />,
  Puzzle: <AppstoreOutlined />,
  BarChart3: <BarChartOutlined />,
  Settings: <SettingOutlined />,
  HelpCircle: <QuestionCircleOutlined />,
  Shield: <SafetyOutlined />,
  Users: <TeamOutlined />,
};

function getIconName(icon: NavItem['icon']): string {
  return icon || '';
}

function buildMenuItems(
  items: NavItem[],
  hasPermission: (resource: string, scope: string) => boolean,
): MenuProps['items'] {
  return items
    .filter((item) => {
      if (item.requiredResource && !hasPermission(item.requiredResource, item.requiredScope || 'read')) {
        return false;
      }
      if (item.children && item.children.length > 0) {
        const visibleChildren = item.children.filter(
          (child) => !child.requiredResource || hasPermission(child.requiredResource, child.requiredScope || 'read'),
        );
        if (visibleChildren.length === 0) return false;
      }
      return true;
    })
    .map((item) => {
      const iconNode = ICON_MAP[getIconName(item.icon)] || <AppstoreOutlined />;
      const visibleChildren = item.children?.filter(
        (child) => !child.requiredResource || hasPermission(child.requiredResource, child.requiredScope || 'read'),
      );

      if (visibleChildren && visibleChildren.length > 0) {
        return {
          key: item.href,
          icon: iconNode,
          label: item.label,
          children: visibleChildren.map((child) => ({
            key: `child:${child.href}`,
            icon: ICON_MAP[getIconName(child.icon)] || <AppstoreOutlined />,
            label: <Link href={child.href}>{child.label}</Link>,
          })),
        };
      }

      return {
        key: item.href,
        icon: iconNode,
        label: <Link href={item.href}>{item.label}</Link>,
      };
    });
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const { hasPermission } = useAuth();

  const menuItems = useMemo(
    () => buildMenuItems(sidebarNavItems, hasPermission),
    [hasPermission],
  );

  // Determine selected keys — child items use "child:" prefix
  const selectedKeys = useMemo(() => {
    for (const item of sidebarNavItems) {
      if (item.children?.some((c) => c.href === pathname)) {
        return [`child:${pathname}`];
      }
    }
    return [pathname];
  }, [pathname]);

  const defaultOpenKeys = useMemo(() => {
    for (const item of sidebarNavItems) {
      if (item.children?.some((c) => c.href === pathname)) {
        return [item.href];
      }
    }
    return [];
  }, [pathname]);

  return (
    <Sider
      trigger={null}
      collapsible
      collapsed={collapsed}
      width={240}
      collapsedWidth={56}
      theme="light"
      style={{ borderRight: '1px solid #F0F0F0', position: 'relative' }}
    >
      <Menu
        mode="inline"
        selectedKeys={selectedKeys}
        defaultOpenKeys={collapsed ? [] : defaultOpenKeys}
        items={menuItems}
        style={{ borderRight: 'none', paddingTop: 16 }}
      />
      <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
        <Button
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={onToggle}
          data-testid="sidebar-toggle-btn"
          style={{
            position: 'absolute',
            top: 20,
            right: -14,
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: '#fff',
            border: '1px solid #F0F0F0',
            boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        />
      </Tooltip>
    </Sider>
  );
}

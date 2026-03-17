'use client';

import { useState } from 'react';
import { Layout, Dropdown, Button, Badge, Spin, Space, Typography, Segmented } from 'antd';
import { DownOutlined, LoadingOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/lib/locale-context';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MenuProps } from 'antd';

const { Text } = Typography;

const ROLE_COLORS: Record<string, string> = {
  admin: '#EF4444',
  governance_lead: '#A855F7',
  domain_reviewer: '#F59E0B',
  requestor: '#3B82F6',
  viewer: '#9CA3AF',
};

export function Header() {
  const { user, switchUser } = useAuth();
  const { locale, setLocale, t } = useLocale();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: usersData, isLoading: usersLoading } = useQuery<{ data: { itcode: string; name: string; role: string }[] }>({
    queryKey: ['dev-user-list'],
    queryFn: () => api.get('/dev/users'),
    staleTime: 30_000,
    enabled: open,
  });

  const roleUsers = usersData?.data ?? [];

  const currentRoleColor = ROLE_COLORS[user?.role ?? ''] ?? '#9CA3AF';
  const currentRoleLabel = t(`role.${user?.role ?? ''}`);

  const handleSwitch = async (itcode: string) => {
    setOpen(false);
    await switchUser(itcode);
    queryClient.invalidateQueries();
  };

  const menuItems: MenuProps['items'] = usersLoading
    ? [{ key: 'loading', label: <Spin indicator={<LoadingOutlined />} size="small" />, disabled: true }]
    : roleUsers.length === 0
      ? [{ key: 'empty', label: <Text type="secondary">{t('common.noData')}</Text>, disabled: true }]
      : roleUsers.map((u) => ({
          key: u.itcode,
          label: (
            <Space size="small" style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space size="small">
                <Badge color={ROLE_COLORS[u.role] ?? '#9CA3AF'} />
                <span style={{ fontWeight: user?.id === u.itcode ? 600 : 400 }}>{u.name}</span>
              </Space>
              <Text type="secondary" style={{ fontSize: 12 }}>{t(`role.${u.role}`)}</Text>
            </Space>
          ),
          onClick: () => handleSwitch(u.itcode),
        }));

  return (
    <Layout.Header
      style={{
        height: 56,
        lineHeight: '56px',
        padding: '0 24px',
        background: '#fff',
        borderBottom: '1px solid #F0F0F0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Space size="middle">
        <svg viewBox="0 0 200 200" width={28} height={28} aria-label="Lenovo">
          <rect width="200" height="200" rx="40" fill="#E1002A" />
          <text x="100" y="138" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="bold" fontSize="110" fill="#FFFFFF" letterSpacing="-4">Le</text>
        </svg>
        <Text strong style={{ fontSize: 16 }}>{t('header.title')}</Text>
      </Space>

      <Space size="middle">
        <Segmented
          value={locale}
          onChange={(val) => setLocale(val as 'en' | 'zh')}
          options={[
            { label: 'EN', value: 'en' },
            { label: '中文', value: 'zh' },
          ]}
          size="small"
        />
        {user && (
          <Dropdown
            menu={{ items: menuItems }}
            trigger={['click']}
            open={open}
            onOpenChange={setOpen}
            placement="bottomRight"
          >
            <Button type="text" style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40 }}>
              <Badge color={currentRoleColor} />
              <Text strong>{user.name}</Text>
              <Text type="secondary">({currentRoleLabel})</Text>
              <DownOutlined style={{ fontSize: 12, color: '#8C8C8C' }} />
            </Button>
          </Dropdown>
        )}
      </Space>
    </Layout.Header>
  );
}

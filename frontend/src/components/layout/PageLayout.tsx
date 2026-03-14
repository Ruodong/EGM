'use client';

import { useState } from 'react';
import { Layout } from 'antd';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

export function PageLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header />
      <Layout>
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
        <Layout.Content style={{ padding: 24, background: '#FAFAFA', overflow: 'auto' }}>
          {children}
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

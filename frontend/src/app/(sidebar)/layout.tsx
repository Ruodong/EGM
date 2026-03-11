'use client';

import { PageLayout } from '@/components/layout/PageLayout';

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  return <PageLayout>{children}</PageLayout>;
}

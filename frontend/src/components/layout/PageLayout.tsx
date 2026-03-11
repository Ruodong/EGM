'use client';

import { Header } from './Header';
import { Sidebar } from './Sidebar';

export function PageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6 bg-bg-gray">{children}</main>
      </div>
    </div>
  );
}

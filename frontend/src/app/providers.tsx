'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider } from '@/lib/auth-context';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider } from 'antd';

const antdTheme = {
  token: {
    colorPrimary: '#4096FF',
    colorSuccess: '#52C41A',
    colorWarning: '#FA8C16',
    colorError: '#EF4444',
    colorInfo: '#1890FF',
    colorTextBase: '#262626',
    colorBgBase: '#FFFFFF',
    borderRadius: 6,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <AntdRegistry>
            <ConfigProvider theme={antdTheme}>
              {children}
            </ConfigProvider>
          </AntdRegistry>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

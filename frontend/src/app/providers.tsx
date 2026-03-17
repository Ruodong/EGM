'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider } from '@/lib/auth-context';
import { LocaleProvider, useLocale } from '@/lib/locale-context';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';

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

function AntdConfigured({ children }: { children: React.ReactNode }) {
  const { locale } = useLocale();
  return (
    <AntdRegistry>
      <ConfigProvider theme={antdTheme} locale={locale === 'zh' ? zhCN : enUS}>
        {children}
      </ConfigProvider>
    </AntdRegistry>
  );
}

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
        <LocaleProvider>
          <ToastProvider>
            <AntdConfigured>
              {children}
            </AntdConfigured>
          </ToastProvider>
        </LocaleProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

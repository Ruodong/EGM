'use client';

import { createContext, useContext, useCallback } from 'react';
import { message } from 'antd';
import { App } from 'antd';

interface ToastContextValue {
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messageApi, contextHolder] = message.useMessage();

  const addToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    messageApi[type](msg);
  }, [messageApi]);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {contextHolder}
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

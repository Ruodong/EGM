import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx}',
  ],
  safelist: [
    'bg-status-draft',
    'bg-status-in-review',
    'bg-status-in-progress',
    'bg-status-completed',
    'bg-status-pending',
    'bg-status-info-requested',
    'bg-primary-blue',
    'bg-red-500',
    'bg-gray-400',
  ],
  theme: {
    extend: {
      colors: {
        'primary-blue': '#4096FF',
        'primary-blue-hover': '#1677FF',
        'egm-teal': '#13C2C2',
        'egm-teal-dark': '#0D9F9F',
        'status-completed': '#52C41A',
        'status-in-progress': '#FA8C16',
        'status-in-review': '#1890FF',
        'status-info-requested': '#EB2F96',
        'status-draft': '#8C8C8C',
        'status-pending': '#D9D9D9',
        'border-light': '#F0F0F0',
        'bg-gray': '#FAFAFA',
        'text-primary': '#262626',
        'text-secondary': '#8C8C8C',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'sans-serif'],
      },
      width: {
        sidebar: '240px',
        'sidebar-collapsed': '56px',
      },
    },
  },
  plugins: [],
};

export default config;

/**
 * Domain icon utilities.
 * Each domain code is hashed to a stable index in ICON_POOL,
 * so every domain consistently gets its own unique visual icon.
 *
 * Uses @ant-design/icons instead of lucide-react.
 */
import React from 'react';
import {
  BankOutlined, BarChartOutlined, BulbOutlined, LockOutlined,
  AuditOutlined, DesktopOutlined, SafetyCertificateOutlined, TeamOutlined,
  DollarOutlined, SolutionOutlined, WarningOutlined, FileSearchOutlined,
  SettingOutlined, AimOutlined, GlobalOutlined, ClusterOutlined,
  DatabaseOutlined, CodeOutlined, HeartOutlined, EnvironmentOutlined,
  ReadOutlined, AppstoreOutlined, InboxOutlined, CompassOutlined,
  WalletOutlined, ExperimentOutlined, EditOutlined,
} from '@ant-design/icons';

type AntdIconComponent = typeof BankOutlined;

export type DomainIconEntry = { Icon: AntdIconComponent; colors: string };

const ICON_POOL: [AntdIconComponent, string][] = [
  [BankOutlined,              'text-blue-600 bg-blue-50'],
  [BarChartOutlined,          'text-amber-600 bg-amber-50'],
  [BulbOutlined,              'text-purple-600 bg-purple-50'],
  [LockOutlined,              'text-rose-600 bg-rose-50'],
  [AuditOutlined,             'text-indigo-600 bg-indigo-50'],
  [DesktopOutlined,           'text-cyan-600 bg-cyan-50'],
  [SafetyCertificateOutlined, 'text-red-600 bg-red-50'],
  [TeamOutlined,              'text-teal-600 bg-teal-50'],
  [DollarOutlined,            'text-emerald-600 bg-emerald-50'],
  [SolutionOutlined,          'text-orange-600 bg-orange-50'],
  [WarningOutlined,           'text-yellow-600 bg-yellow-50'],
  [FileSearchOutlined,        'text-slate-600 bg-slate-50'],
  [SettingOutlined,           'text-gray-600 bg-gray-100'],
  [AimOutlined,               'text-pink-600 bg-pink-50'],
  [GlobalOutlined,            'text-sky-600 bg-sky-50'],
  [ClusterOutlined,           'text-violet-600 bg-violet-50'],
  [DatabaseOutlined,          'text-lime-700 bg-lime-50'],
  [CodeOutlined,              'text-cyan-700 bg-cyan-100'],
  [HeartOutlined,             'text-rose-500 bg-rose-100'],
  [EnvironmentOutlined,       'text-green-600 bg-green-50'],
  [ReadOutlined,              'text-indigo-500 bg-indigo-50'],
  [AppstoreOutlined,          'text-blue-500 bg-blue-100'],
  [InboxOutlined,             'text-violet-500 bg-violet-50'],
  [CompassOutlined,           'text-amber-500 bg-amber-50'],
  [WalletOutlined,            'text-emerald-500 bg-emerald-100'],
  [ExperimentOutlined,        'text-fuchsia-600 bg-fuchsia-50'],
  [EditOutlined,              'text-orange-500 bg-orange-50'],
  [CodeOutlined,              'text-sky-700 bg-sky-100'],
];

/** Hash a domain code to a stable, unique position in ICON_POOL. */
export function getDomainIcon(code: string): DomainIconEntry {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  }
  const entry = ICON_POOL[hash % ICON_POOL.length];
  return { Icon: entry[0], colors: entry[1] };
}

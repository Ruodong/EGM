/**
 * Domain icon utilities.
 * Each domain code is hashed to a stable index in ICON_POOL,
 * so every domain consistently gets its own unique visual icon.
 */
import {
  Building2, BarChart3, Brain, Lock, Scale, Monitor, Shield,
  Users, DollarSign, ClipboardCheck, AlertTriangle, FileSearch,
  Settings2, Target, Globe, Network, Database, Cpu, HeartPulse,
  Leaf, BookOpen, Layers, Boxes, Compass, Wallet, FlaskConical,
  Pencil, type LucideIcon,
} from 'lucide-react';

export type DomainIconEntry = { Icon: LucideIcon; colors: string };

const ICON_POOL: [LucideIcon, string][] = [
  [Building2,     'text-blue-600 bg-blue-50'],
  [BarChart3,     'text-amber-600 bg-amber-50'],
  [Brain,         'text-purple-600 bg-purple-50'],
  [Lock,          'text-rose-600 bg-rose-50'],
  [Scale,         'text-indigo-600 bg-indigo-50'],
  [Monitor,       'text-cyan-600 bg-cyan-50'],
  [Shield,        'text-red-600 bg-red-50'],
  [Users,         'text-teal-600 bg-teal-50'],
  [DollarSign,    'text-emerald-600 bg-emerald-50'],
  [ClipboardCheck,'text-orange-600 bg-orange-50'],
  [AlertTriangle, 'text-yellow-600 bg-yellow-50'],
  [FileSearch,    'text-slate-600 bg-slate-50'],
  [Settings2,     'text-gray-600 bg-gray-100'],
  [Target,        'text-pink-600 bg-pink-50'],
  [Globe,         'text-sky-600 bg-sky-50'],
  [Network,       'text-violet-600 bg-violet-50'],
  [Database,      'text-lime-700 bg-lime-50'],
  [Cpu,           'text-cyan-700 bg-cyan-100'],
  [HeartPulse,    'text-rose-500 bg-rose-100'],
  [Leaf,          'text-green-600 bg-green-50'],
  [BookOpen,      'text-indigo-500 bg-indigo-50'],
  [Layers,        'text-blue-500 bg-blue-100'],
  [Boxes,         'text-violet-500 bg-violet-50'],
  [Compass,       'text-amber-500 bg-amber-50'],
  [Wallet,        'text-emerald-500 bg-emerald-100'],
  [FlaskConical,  'text-fuchsia-600 bg-fuchsia-50'],
  [Pencil,        'text-orange-500 bg-orange-50'],
  [Cpu,           'text-sky-700 bg-sky-100'],
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

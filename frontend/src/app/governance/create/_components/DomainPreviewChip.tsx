import { getDomainIcon } from '@/lib/domain-icons';
import clsx from 'clsx';

interface DomainPreviewChipProps {
  domainCode: string;
  domainName: string;
}

export function DomainPreviewChip({ domainCode, domainName }: DomainPreviewChipProps) {
  const { Icon, colors } = getDomainIcon(domainCode);
  const iconColor = colors.split(' ').find(c => c.startsWith('text-')) ?? '';

  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-text-primary bg-gray-100"
      data-testid={`domain-chip-${domainCode}`}
    >
      <Icon className={clsx('h-4 w-4', iconColor)} />
      {domainName}
      <span className="text-xs opacity-70">({domainCode})</span>
    </span>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import clsx from 'clsx';
import { Tag, Typography, Spin } from 'antd';
import { getDomainIcon } from '@/lib/domain-icons';

const { Title, Text } = Typography;

interface Domain {
  id: string;
  domainCode: string;
  domainName: string;
  description: string | null;
  integrationType: string;
  externalBaseUrl: string | null;
  icon: string | null;
  isActive: boolean;
}

export default function DomainsPage() {
  const { data, isLoading } = useQuery<{ data: Domain[] }>({
    queryKey: ['domains'],
    queryFn: () => api.get('/domains'),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <Title level={4} style={{ margin: 0 }}>Domain Registry</Title>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {isLoading ? (
          <div className="col-span-2 text-center py-4"><Spin /></div>
        ) : (
          data?.data?.map((d) => {
            const { Icon, colors } = getDomainIcon(d.domainCode);
            return (
              <div key={d.id} className="bg-white rounded-lg border border-border-light p-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', colors)}>
                      <Icon style={{ fontSize: 20 }} />
                    </div>
                    <div>
                      <h3 className="font-medium">{d.domainName}</h3>
                      <span className="text-xs text-text-secondary">{d.domainCode}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.integrationType === 'external' && (
                      <Tag color="purple">External</Tag>
                    )}
                    <Tag color={d.isActive ? 'green' : 'default'}>
                      {d.isActive ? 'Active' : 'Inactive'}
                    </Tag>
                  </div>
                </div>
                {d.description && <Text type="secondary" className="block text-sm mt-2">{d.description}</Text>}
                {d.externalBaseUrl && (
                  <Text type="secondary" className="block text-xs mt-1">System URL: {d.externalBaseUrl}</Text>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

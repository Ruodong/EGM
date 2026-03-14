'use client';

import { Typography } from 'antd';

const { Title, Text } = Typography;

export default function ActionsPage() {
  return (
    <div>
      <Title level={4} style={{ margin: 0, marginBottom: 24 }}>Review Actions</Title>
      <div className="bg-white rounded-lg border border-border-light p-8 text-center">
        <Text type="secondary">Action items tracking — coming soon.</Text>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Modal, Tag, Tooltip, Alert, message } from 'antd';
import { FileSearchOutlined, CopyOutlined, RobotOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { SectionCard } from './SectionCard';

interface LegalPreReviewResponse {
  draft: string;
  model: string;
  skillsUsed: string[];
  domainCode: string;
  plugin: string;
}

interface Props {
  domainReviewId: string;
  domainCode: string;
}

/**
 * PoC integration of the `claude-for-legal/commercial-legal` plugin.
 * Reads no DB state and writes none — just calls the LLM with the plugin's
 * skill prompts as system context and shows the draft memo.
 */
export function LegalPreReviewSection({ domainReviewId, domainCode }: Props) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<LegalPreReviewResponse | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<LegalPreReviewResponse>(
        `/domain-reviews/${domainReviewId}/legal-pre-review`,
        {},
      ),
    onSuccess: (data) => {
      setResult(data);
      setOpen(true);
    },
    onError: (err: Error) => {
      message.error(`Legal pre-review failed: ${err.message}`);
    },
  });

  const copyDraft = async () => {
    if (!result?.draft) return;
    try {
      await navigator.clipboard.writeText(result.draft);
      message.success('Draft copied to clipboard');
    } catch {
      message.error('Copy failed — browser blocked clipboard access');
    }
  };

  return (
    <>
      <SectionCard
        title="Legal AI Pre-Review"
        subtitle={`Generates a draft legal review memo using the commercial-legal plugin's /review skill. Domain: ${domainCode}.`}
        defaultOpen
      >
        <div className="mb-3 flex items-center gap-2">
          <RobotOutlined />
          <Tag color="purple">claude-for-legal</Tag>
          <Tag color="orange">PoC</Tag>
        </div>
        <Alert
          type="info"
          showIcon
          message="Provisional mode"
          description="No practice profile is configured for this deployment, so the draft uses generic in-house counsel defaults (US jurisdiction, middle risk appetite, purchasing-side). The output is a DRAFT for attorney review — not legal advice."
          className="mb-3"
        />
        <Tooltip title="Calls the LLM with claude-for-legal/commercial-legal skill prompts injected as system context.">
          <Button
            type="primary"
            icon={<FileSearchOutlined />}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Generate Legal Pre-Review Draft
          </Button>
        </Tooltip>
      </SectionCard>

      <Modal
        open={open}
        title={
          <span className="flex items-center gap-2">
            <RobotOutlined /> Legal Pre-Review Draft
            {result && <Tag color="purple">{result.plugin}</Tag>}
          </span>
        }
        width={900}
        onCancel={() => setOpen(false)}
        footer={[
          <Button key="copy" icon={<CopyOutlined />} onClick={copyDraft} disabled={!result}>
            Copy to Clipboard
          </Button>,
          <Button key="close" type="primary" onClick={() => setOpen(false)}>
            Close
          </Button>,
        ]}
      >
        {result && (
          <div>
            <div className="text-xs text-text-secondary mb-2">
              Model: <code>{result.model}</code> · Skills:{' '}
              {result.skillsUsed.map((s) => (
                <Tag key={s} className="!mr-1">{s.replace('skills/', '').replace('/SKILL.md', '')}</Tag>
              ))}
            </div>
            <pre className="whitespace-pre-wrap break-words text-sm bg-bg-secondary p-3 rounded max-h-[60vh] overflow-auto">
              {result.draft}
            </pre>
          </div>
        )}
      </Modal>
    </>
  );
}

'use client';

import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { Button, Image } from 'antd';
import {
  SendOutlined,
  UserOutlined,
  CommentOutlined,
  PaperClipOutlined,
  DeleteOutlined,
  DownloadOutlined,
  CloseOutlined,
} from '@ant-design/icons';

interface FeedbackAttachment {
  id: string;
  feedbackId: string;
  actionId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  createBy: string;
  createByName: string | null;
  createAt: string | null;
}

interface FeedbackEntry {
  id: string;
  actionId: string;
  roundNo: number;
  feedbackType: 'response' | 'follow_up';
  content: string;
  createdBy: string;
  createdByName: string | null;
  createAt: string | null;
  attachments?: FeedbackAttachment[];
}

interface ActionFeedbackPanelProps {
  actionId: string;
  feedback: FeedbackEntry[];
  /** Current user's itcode */
  currentUser: string;
  /** Whether user can submit feedback */
  canSubmit: boolean;
  /** Domain review ID for cache invalidation */
  domainReviewId: string;
  /** Request ID for cache invalidation */
  requestId: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ActionFeedbackPanel({
  actionId,
  feedback,
  currentUser,
  canSubmit,
  domainReviewId,
  requestId,
}: ActionFeedbackPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['review-actions', domainReviewId] });
    queryClient.invalidateQueries({ queryKey: ['review-actions-by-request', requestId] });
    queryClient.invalidateQueries({ queryKey: ['action-feedback', actionId] });
  };

  const feedbackMutation = useMutation({
    mutationFn: async (text: string) => {
      // 1. Submit feedback text (use placeholder if only files are being sent)
      const feedbackText = text || '(see attached file)';
      const fb = await api.post<{ id: string }>(`/review-actions/${actionId}/feedback`, { content: feedbackText });
      // 2. Upload any pending files to the feedback
      if (pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          const formData = new FormData();
          formData.append('file', file);
          await api.upload(`/review-actions/${actionId}/feedback/${fb.id}/attachments`, formData);
        }
      }
      return fb;
    },
    onSuccess: () => {
      invalidate();
      setContent('');
      setPendingFiles([]);
      toast('Feedback submitted', 'success');
    },
    onError: () => toast('Failed to submit feedback', 'error'),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: ({ feedbackId, attId }: { feedbackId: string; attId: string }) =>
      api.delete(`/review-actions/${actionId}/feedback/${feedbackId}/attachments/${attId}`),
    onSuccess: () => {
      invalidate();
      toast('Attachment deleted', 'success');
    },
    onError: () => toast('Failed to delete attachment', 'error'),
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      setPendingFiles((prev) => [...prev, ...Array.from(files)]);
      e.target.value = '';
    }
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          // Give pasted images a readable name with timestamp
          const ext = item.type.split('/')[1] || 'png';
          const name = `screenshot-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${ext}`;
          const renamedFile = new File([file], name, { type: file.type });
          files.push(renamedFile);
        }
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      setPendingFiles((prev) => [...prev, ...files]);
    }
  };

  return (
    <div className="mt-3 border-t border-border-light pt-3">
      <span className="text-xs font-medium text-text-secondary mb-2 block">Feedback History</span>

      {/* Feedback timeline */}
      {feedback.length > 0 && (
        <div className="space-y-2 mb-3">
          {feedback.map((f) => {
            const isResponse = f.feedbackType === 'response';
            const atts = f.attachments || [];
            return (
              <div
                key={f.id}
                className={`flex gap-2 ${isResponse ? '' : 'flex-row-reverse'}`}
              >
                <div
                  className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs ${
                    isResponse
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-purple-100 text-purple-600'
                  }`}
                >
                  {isResponse ? <UserOutlined /> : <CommentOutlined />}
                </div>
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    isResponse
                      ? 'bg-blue-50 text-blue-900'
                      : 'bg-purple-50 text-purple-900'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-xs">
                      {f.createdByName || f.createdBy}
                    </span>
                    <span className="text-xs opacity-60">
                      Round {f.roundNo} · {isResponse ? 'Response' : 'Follow-up'}
                    </span>
                    {f.createAt && (
                      <span className="text-xs opacity-50">
                        {new Date(f.createAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap">{f.content}</p>

                  {/* Feedback attachments */}
                  {atts.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-black/5 pt-2">
                      {atts.map((att) => {
                        const attUrl = `${API_BASE}/review-actions/${actionId}/feedback/${f.id}/attachments/${att.id}`;
                        const isImg = att.contentType.startsWith('image/');
                        return (
                          <div key={att.id}>
                            {isImg && (
                              <Image
                                src={attUrl}
                                alt={att.fileName}
                                style={{ maxHeight: 160, borderRadius: 6, objectFit: 'contain' }}
                                preview={{ mask: 'Click to preview' }}
                              />
                            )}
                            <div className="flex items-center gap-1.5 text-xs mt-1">
                              <PaperClipOutlined style={{ fontSize: 10, opacity: 0.5 }} />
                              <a
                                href={attUrl}
                                download={att.fileName}
                                className="text-primary-blue hover:underline truncate flex-1"
                                title={att.fileName}
                              >
                                {att.fileName}
                              </a>
                              <span className="opacity-50 whitespace-nowrap">{formatFileSize(att.fileSize)}</span>
                              <a href={attUrl} download={att.fileName} title="Download">
                                <DownloadOutlined style={{ fontSize: 11, color: '#1890FF' }} />
                              </a>
                              {att.createBy === currentUser && (
                                <button
                                  type="button"
                                  onClick={() => deleteAttachmentMutation.mutate({
                                    feedbackId: f.id,
                                    attId: att.id,
                                  })}
                                  className="text-red-400 hover:text-red-600"
                                  title="Delete"
                                >
                                  <DeleteOutlined style={{ fontSize: 11 }} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Submit feedback */}
      {canSubmit && (
        <div>
          <div className="flex gap-2">
            <div className="flex-1">
              <textarea
                className="input-field w-full resize-none"
                rows={2}
                placeholder="Type your feedback response... (paste screenshot with Ctrl+V)"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onPaste={handlePaste}
              />
              {/* Pending files preview */}
              {pendingFiles.length > 0 && (
                <div className="mt-1 space-y-1">
                  {pendingFiles.map((file, i) => (
                    <div key={i} className="bg-gray-50 rounded px-2 py-1">
                      {file.type.startsWith('image/') && (
                        <img
                          src={URL.createObjectURL(file)}
                          alt={file.name}
                          className="max-h-20 rounded mb-1"
                          onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                        />
                      )}
                      <div className="flex items-center gap-1.5 text-xs">
                        <PaperClipOutlined style={{ fontSize: 10, opacity: 0.5 }} />
                        <span className="truncate flex-1">{file.name}</span>
                        <span className="text-text-secondary whitespace-nowrap">{formatFileSize(file.size)}</span>
                        <button
                          type="button"
                          onClick={() => removePendingFile(i)}
                          className="text-gray-400 hover:text-red-500"
                          title="Remove"
                        >
                          <CloseOutlined style={{ fontSize: 10 }} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1 justify-end">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                onChange={handleFileSelect}
              />
              <Button
                type="text"
                icon={<PaperClipOutlined />}
                onClick={() => fileInputRef.current?.click()}
                title="Attach file"
                style={{ padding: '4px 8px' }}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                disabled={(!content.trim() && pendingFiles.length === 0) || feedbackMutation.isPending}
                onClick={() => feedbackMutation.mutate(content.trim())}
              >
                {feedbackMutation.isPending ? 'Sending...' : 'Send'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {feedback.length === 0 && !canSubmit && (
        <p className="text-xs text-text-secondary italic">No feedback yet</p>
      )}
    </div>
  );
}

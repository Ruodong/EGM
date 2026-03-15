'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { Button } from 'antd';
import { SendOutlined, UserOutlined, CommentOutlined } from '@ant-design/icons';

interface FeedbackEntry {
  id: string;
  actionId: string;
  roundNo: number;
  feedbackType: 'response' | 'follow_up';
  content: string;
  createdBy: string;
  createdByName: string | null;
  createAt: string | null;
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

  const feedbackMutation = useMutation({
    mutationFn: (text: string) =>
      api.post(`/review-actions/${actionId}/feedback`, { content: text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-actions', domainReviewId] });
      queryClient.invalidateQueries({ queryKey: ['review-actions-by-request', requestId] });
      setContent('');
      toast('Feedback submitted', 'success');
    },
    onError: () => toast('Failed to submit feedback', 'error'),
  });

  return (
    <div className="mt-3 border-t border-border-light pt-3">
      {/* Feedback timeline */}
      {feedback.length > 0 && (
        <div className="space-y-2 mb-3">
          {feedback.map((f) => {
            const isResponse = f.feedbackType === 'response';
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
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Submit feedback */}
      {canSubmit && (
        <div className="flex gap-2">
          <textarea
            className="input-field flex-1 resize-none"
            rows={2}
            placeholder="Type your feedback..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            disabled={!content.trim() || feedbackMutation.isPending}
            onClick={() => feedbackMutation.mutate(content.trim())}
            style={{ alignSelf: 'flex-end' }}
          >
            {feedbackMutation.isPending ? 'Sending...' : 'Send'}
          </Button>
        </div>
      )}

      {feedback.length === 0 && !canSubmit && (
        <p className="text-xs text-text-secondary italic">No feedback yet</p>
      )}
    </div>
  );
}

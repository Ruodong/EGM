'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { authHeaders } from '@/lib/auth-token';
import { Button } from 'antd';
import {
  RobotOutlined,
  CloseOutlined,
  SendOutlined,
  DeleteOutlined,
  LoadingOutlined,
} from '@ant-design/icons';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createAt?: string | null;
}

interface AskEgmFloatingProps {
  domainReviewId: string;
  domainName: string;
}

const QUICK_PROMPTS = [
  'Summarize the key points from the questionnaire responses',
  'What are the potential compliance risks in this review?',
  'Are there any inconsistencies in the questionnaire responses?',
  'Suggest action items for this review',
  'Draft a review decision summary',
];

function devRoleHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const devUser = localStorage.getItem('egm_dev_user');
  if (devUser) return { 'X-Dev-User': devUser };
  const role = localStorage.getItem('egm_dev_role');
  return role ? { 'X-Dev-Role': role } : {};
}

export function AskEgmFloating({ domainReviewId, domainName }: AskEgmFloatingProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load history when opened
  const { data: historyData } = useQuery<{ data: ChatMessage[] }>({
    queryKey: ['ask-egm-history', domainReviewId],
    queryFn: () => api.get(`/ask-egm/${domainReviewId}/history`),
    enabled: open,
  });

  useEffect(() => {
    if (historyData?.data) {
      setMessages(historyData.data);
    }
  }, [historyData]);

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleClearHistory = useCallback(async () => {
    try {
      await api.delete(`/ask-egm/${domainReviewId}/history`);
      setMessages([]);
      queryClient.invalidateQueries({ queryKey: ['ask-egm-history', domainReviewId] });
    } catch {
      // ignore
    }
  }, [domainReviewId, queryClient]);

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || streaming) return;

    setInput('');
    setStreaming(true);
    setStreamingContent('');

    // Optimistic: add user message
    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: msg,
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch(`${API_BASE}/ask-egm/${domainReviewId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
          ...devRoleHeader(),
        },
        body: JSON.stringify({ message: msg }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.token) {
              fullContent += parsed.token;
              setStreamingContent(fullContent);
            }
            if (parsed.error) {
              fullContent += `\n\n[Error: ${parsed.error}]`;
              setStreamingContent(fullContent);
            }
          } catch {
            // skip unparseable chunks
          }
        }
      }

      // Add assistant message
      if (fullContent) {
        const assistantMsg: ChatMessage = {
          id: `temp-${Date.now()}-ai`,
          role: 'assistant',
          content: fullContent,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        const errorMsg: ChatMessage = {
          id: `temp-${Date.now()}-err`,
          role: 'assistant',
          content: 'Sorry, an error occurred. Please try again.',
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    } finally {
      setStreaming(false);
      setStreamingContent('');
      abortRef.current = null;
      // Refresh history to sync IDs
      queryClient.invalidateQueries({ queryKey: ['ask-egm-history', domainReviewId] });
    }
  }, [input, streaming, domainReviewId, queryClient]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Floating action button (collapsed state)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
        title="Ask EGM — AI Assistant"
      >
        <RobotOutlined style={{ fontSize: 24 }} />
      </button>
    );
  }

  // Expanded chat panel
  return (
    <div className="fixed bottom-6 right-6 z-50 w-[420px] h-[580px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white">
        <div className="flex items-center gap-2">
          <RobotOutlined style={{ fontSize: 18 }} />
          <span className="font-semibold text-sm">Ask EGM</span>
          <span className="text-xs opacity-80">· {domainName}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleClearHistory}
            className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
            title="Clear conversation"
          >
            <DeleteOutlined style={{ fontSize: 14 }} />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
            title="Close"
          >
            <CloseOutlined style={{ fontSize: 14 }} />
          </button>
        </div>
      </div>

      {/* Context badges */}
      <div className="px-4 py-2 border-b border-gray-100 flex gap-2 flex-wrap">
        <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">Request Info</span>
        <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">Questionnaire</span>
        <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">Action Items</span>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <RobotOutlined style={{ fontSize: 40, color: '#CBD5E1' }} />
            <p className="text-sm text-text-secondary mt-3 mb-4">
              Ask me anything about this <strong>{domainName}</strong> review.
            </p>
            <div className="space-y-2 w-full">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleSend(prompt)}
                  className="w-full text-left text-xs bg-gray-50 hover:bg-blue-50 hover:text-blue-700 rounded-lg px-3 py-2 transition-colors border border-gray-100"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
            </div>
          </div>
        ))}

        {/* Streaming message */}
        {streaming && streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-xl rounded-bl-sm bg-gray-100 text-gray-800 px-3 py-2 text-sm">
              <p className="whitespace-pre-wrap break-words">{streamingContent}</p>
            </div>
          </div>
        )}

        {/* Typing indicator */}
        {streaming && !streamingContent && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-xl rounded-bl-sm px-3 py-2 text-sm text-gray-500">
              <LoadingOutlined className="mr-1" /> Thinking...
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Disclaimer */}
      <div className="px-4 py-1 text-center">
        <span className="text-[10px] text-gray-400">AI suggestions are for reference only. Please verify before making decisions.</span>
      </div>

      {/* Input area */}
      <div className="px-4 pb-3 pt-1 border-t border-gray-100">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent"
            rows={1}
            placeholder="Ask about this review..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
          />
          <Button
            type="primary"
            shape="circle"
            icon={streaming ? <LoadingOutlined /> : <SendOutlined />}
            disabled={!input.trim() || streaming}
            onClick={() => handleSend()}
            className="flex-shrink-0"
          />
        </div>
      </div>
    </div>
  );
}

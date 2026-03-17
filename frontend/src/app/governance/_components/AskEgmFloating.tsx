'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { authHeaders } from '@/lib/auth-token';
import { useLocale } from '@/lib/locale-context';
import { Button, Tooltip } from 'antd';
import {
  RobotOutlined,
  CloseOutlined,
  SendOutlined,
  DeleteOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  SearchOutlined,
  GlobalOutlined,
  LinkOutlined,
  StopOutlined,
  CheckCircleFilled,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

interface AttachmentMeta {
  id: string;
  fileName: string;
  contentType: string;
  fileSize?: number;
  isImage?: boolean;
}

interface SourceLink {
  title: string;
  url: string;
}

interface MessageMetadata {
  attachments?: AttachmentMeta[];
  followUpQuestions?: string[];
  sources?: SourceLink[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createAt?: string | null;
  metadata?: MessageMetadata | null;
}

interface AskEgmFloatingProps {
  domainReviewId: string;
  domainName: string;
}

function devRoleHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const devUser = localStorage.getItem('egm_dev_user');
  if (devUser) return { 'X-Dev-User': devUser };
  const role = localStorage.getItem('egm_dev_role');
  return role ? { 'X-Dev-Role': role } : {};
}

/* -- Markdown renderer for assistant messages ---------------------------------------- */

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Tables
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="w-full text-xs border-collapse border border-gray-300">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-gray-200 text-gray-700">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="border border-gray-300 px-2 py-1 text-left font-semibold">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border border-gray-300 px-2 py-1">{children}</td>
        ),
        // Headings
        h1: ({ children }) => <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>,
        h2: ({ children }) => <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>,
        h3: ({ children }) => <h4 className="text-xs font-bold mt-1.5 mb-0.5">{children}</h4>,
        // Lists
        ul: ({ children }) => <ul className="list-disc pl-4 my-1 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 my-1 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="text-xs">{children}</li>,
        // Code blocks
        code: ({ className, children, ...props }) => {
          const isInline = !className;
          if (isInline) {
            return <code className="bg-gray-200 px-1 py-0.5 rounded text-[11px] font-mono" {...props}>{children}</code>;
          }
          return (
            <pre className="bg-gray-800 text-gray-100 rounded-lg p-2 my-1 overflow-x-auto text-[11px]">
              <code className={className} {...props}>{children}</code>
            </pre>
          );
        },
        // Bold, paragraphs
        p: ({ children }) => <p className="my-1">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        // Links
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{children}</a>
        ),
        // Blockquote
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-gray-300 pl-2 my-1 text-gray-600 italic">{children}</blockquote>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

/* -- Authenticated image component (fetches blob with auth headers) ---------------- */

function AuthImage({ attId, alt, className }: { attId: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    fetch(`${API_BASE}/ask-egm/attachments/${attId}`, {
      headers: { ...authHeaders(), ...devRoleHeader() },
    })
      .then((res) => (res.ok ? res.blob() : Promise.reject(res.status)))
      .then((blob) => {
        if (!revoked) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        }
      })
      .catch(() => { if (!revoked) setError(true); });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attId]);
  if (error) return (
    <div className={`${className ?? ''} bg-gray-100 border border-gray-200 rounded flex items-center justify-center text-gray-400 text-[10px]`}>
      Deleted
    </div>
  );
  if (!src) return <div className={`${className ?? ''} bg-gray-200 animate-pulse`} />;
  return <img src={src} alt={alt} className={className} />;
}

/** Download an attachment via fetch with auth headers, then trigger browser download. */
function triggerAuthDownload(attId: string, fileName: string) {
  fetch(`${API_BASE}/ask-egm/attachments/${attId}`, {
    headers: { ...authHeaders(), ...devRoleHeader() },
  })
    .then((res) => (res.ok ? res.blob() : Promise.reject(res.status)))
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    })
    .catch(() => {});
}

/* -- Attachment preview (inline in message) ----------------------------------------- */

function AttachmentPreview({ attachments }: { attachments: AttachmentMeta[] }) {
  if (!attachments?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {attachments.map((att) => {
        const isImage = att.isImage || att.contentType?.startsWith('image/');
        if (isImage) {
          return (
            <button
              key={att.id}
              type="button"
              onClick={() => triggerAuthDownload(att.id, att.fileName)}
              className="block cursor-pointer"
            >
              <AuthImage
                attId={att.id}
                alt={att.fileName}
                className="max-w-[180px] max-h-[120px] rounded-lg border border-gray-200 object-cover"
              />
            </button>
          );
        }
        return (
          <button
            key={att.id}
            type="button"
            onClick={() => triggerAuthDownload(att.id, att.fileName)}
            className="flex items-center gap-1 px-2 py-1 bg-white/80 border border-gray-200 rounded text-[11px] text-gray-600 hover:bg-gray-50 cursor-pointer"
          >
            <PaperClipOutlined />
            <span className="max-w-[120px] truncate">{att.fileName}</span>
          </button>
        );
      })}
    </div>
  );
}

/* -- Pending attachments (before send) --------------------------------------------- */

function PendingAttachments({
  attachments,
  onRemove,
}: {
  attachments: AttachmentMeta[];
  onRemove: (id: string) => void;
}) {
  const { t } = useLocale();
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-4 py-1.5 border-t border-gray-100 bg-gray-50">
      {attachments.map((att) => {
        const isImage = att.isImage || att.contentType?.startsWith('image/');
        return (
          <div key={att.id} className="relative group">
            {isImage ? (
              <AuthImage
                attId={att.id}
                alt={att.fileName}
                className="w-14 h-14 rounded-lg border border-gray-200 object-cover"
              />
            ) : (
              <div className="flex items-center gap-1 px-2 py-1.5 bg-white border border-gray-200 rounded text-[11px]">
                <PaperClipOutlined />
                <span className="max-w-[80px] truncate">{att.fileName}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => onRemove(att.id)}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              title={t('common.remove')}
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* -- Follow-up question chips ------------------------------------------------------ */

function FollowUpQuestions({
  questions,
  onSelect,
  disabled,
}: {
  questions: string[];
  onSelect: (q: string) => void;
  disabled: boolean;
}) {
  if (!questions.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {questions.map((q, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(q)}
          disabled={disabled}
          className="text-left text-[11px] bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg px-2.5 py-1.5 transition-colors border border-blue-100 disabled:opacity-50"
        >
          {q}
        </button>
      ))}
    </div>
  );
}

/* -- Source citations (web search results) ------------------------------------------ */

function SourcesCitation({ sources }: { sources: SourceLink[] }) {
  const { t } = useLocale();
  if (!sources?.length) return null;
  return (
    <div className="mt-1.5 pt-1.5 border-t border-gray-200">
      <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-1">
        <GlobalOutlined style={{ fontSize: 10 }} />
        <span>{t('askEgm.webSources')}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {sources.map((s, i) => (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-1.5 py-0.5 rounded transition-colors max-w-[180px]"
            title={s.url}
          >
            <LinkOutlined style={{ fontSize: 9 }} />
            <span className="truncate">{s.title || new URL(s.url).hostname}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

/* -- Main component ----------------------------------------------------------------- */

type PanelState = 'closed' | 'open' | 'minimized';

export function AskEgmFloating({ domainReviewId, domainName }: AskEgmFloatingProps) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [panelState, setPanelState] = useState<PanelState>('closed');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [latestFollowUps, setLatestFollowUps] = useState<string[]>([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [searchingWeb, setSearchingWeb] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Notification badge: shows when streaming finishes while minimized
  const [hasNewResponse, setHasNewResponse] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track panel state in a ref so the streaming callback can read it
  const panelStateRef = useRef<PanelState>(panelState);
  useEffect(() => { panelStateRef.current = panelState; }, [panelState]);

  const QUICK_PROMPTS = [
    t('askEgm.prompt1'),
    t('askEgm.prompt2'),
    t('askEgm.prompt3'),
    t('askEgm.prompt4'),
    t('askEgm.prompt5'),
  ];

  // Load history when opened (or minimized — keep data fresh)
  const { data: historyData } = useQuery<{ data: ChatMessage[] }>({
    queryKey: ['ask-egm-history', domainReviewId],
    queryFn: () => api.get(`/ask-egm/${domainReviewId}/history`),
    enabled: panelState !== 'closed',
  });

  useEffect(() => {
    if (historyData?.data) {
      setMessages(historyData.data);
      // Restore follow-ups from the last assistant message
      const lastAssistant = [...historyData.data].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant?.metadata?.followUpQuestions) {
        setLatestFollowUps(lastAssistant.metadata.followUpQuestions);
      }
    }
  }, [historyData]);

  // Auto-scroll to bottom (only when panel is open)
  useEffect(() => {
    if (panelState === 'open') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingContent, panelState]);

  // Clear notification when opening from minimized
  useEffect(() => {
    if (panelState === 'open') setHasNewResponse(false);
  }, [panelState]);

  // -- File upload -------------------------------------------------------------------

  const uploadFile = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      alert(t('askEgm.fileTooLarge'));
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await api.upload<AttachmentMeta>(
        `/ask-egm/${domainReviewId}/upload`,
        formData
      );
      setPendingAttachments((prev) => [...prev, result]);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  }, [domainReviewId, t]);

  // Clipboard paste handler for images
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) uploadFile(file);
          return;
        }
      }
    },
    [uploadFile]
  );

  // File input change handler
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      for (const file of Array.from(files)) {
        uploadFile(file);
      }
      // Reset input so same file can be selected again
      e.target.value = '';
    },
    [uploadFile]
  );

  const removePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
    // Delete from backend to prevent orphan attachments (fire-and-forget)
    fetch(`${API_BASE}/ask-egm/attachments/${id}`, {
      method: 'DELETE',
      headers: { ...authHeaders(), ...devRoleHeader() },
    }).catch(() => {});
  }, []);

  // -- Cancel streaming ---------------------------------------------------------------

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  // -- Chat actions -------------------------------------------------------------------

  const handleClearHistory = useCallback(async () => {
    try {
      await api.delete(`/ask-egm/${domainReviewId}/history`);
      setMessages([]);
      setLatestFollowUps([]);
      setPendingAttachments([]);
      queryClient.invalidateQueries({ queryKey: ['ask-egm-history', domainReviewId] });
    } catch {
      // ignore
    }
  }, [domainReviewId, queryClient]);

  const handleSend = useCallback(async (text?: string) => {
    let msg = (text || input).trim();
    if ((!msg && !pendingAttachments.length) || streaming) return;
    if (!msg) msg = '(Attached files)';

    const attachmentIds = pendingAttachments.map((a) => a.id);
    const attachmentMeta = pendingAttachments.length ? [...pendingAttachments] : undefined;

    setInput('');
    setStreaming(true);
    setStreamingContent('');
    setLatestFollowUps([]);
    setPendingAttachments([]);

    // Optimistic: add user message
    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: msg,
      metadata: attachmentMeta ? { attachments: attachmentMeta } : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const reqBody: Record<string, unknown> = { message: msg };
      if (attachmentIds.length) {
        reqBody.attachmentIds = attachmentIds;
      }
      if (webSearchEnabled) {
        reqBody.webSearch = true;
      }

      const res = await fetch(`${API_BASE}/ask-egm/${domainReviewId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
          ...devRoleHeader(),
        },
        body: JSON.stringify(reqBody),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullContent = '';
      let followUps: string[] = [];
      let sources: SourceLink[] = [];

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
            // Web search events
            if (parsed.searching === true) {
              setSearchingWeb(true);
              setSearchQuery(parsed.query || '');
            }
            if (parsed.searching === false) {
              setSearchingWeb(false);
              if (parsed.sources) {
                sources = parsed.sources;
              }
            }
            if (parsed.done) {
              if (parsed.followUpQuestions) followUps = parsed.followUpQuestions;
              if (parsed.sources) sources = parsed.sources;
            }
          } catch {
            // skip unparseable chunks
          }
        }
      }

      // Add assistant message
      if (fullContent) {
        const assistantMeta: MessageMetadata = {};
        if (followUps.length) assistantMeta.followUpQuestions = followUps;
        if (sources.length) assistantMeta.sources = sources;
        const assistantMsg: ChatMessage = {
          id: `temp-${Date.now()}-ai`,
          role: 'assistant',
          content: fullContent,
          metadata: Object.keys(assistantMeta).length ? assistantMeta : undefined,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setLatestFollowUps(followUps);
      }

      // If panel is minimized, show notification badge
      if (panelStateRef.current === 'minimized') {
        setHasNewResponse(true);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled — keep partial content as a message if any
        if (streamingContent) {
          const partialMsg: ChatMessage = {
            id: `temp-${Date.now()}-partial`,
            role: 'assistant',
            content: streamingContent + '\n\n*(Cancelled)*',
          };
          setMessages((prev) => [...prev, partialMsg]);
        }
      } else {
        const errorMsg: ChatMessage = {
          id: `temp-${Date.now()}-err`,
          role: 'assistant',
          content: t('askEgm.errorOccurred'),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    } finally {
      setStreaming(false);
      setStreamingContent('');
      setSearchingWeb(false);
      abortRef.current = null;
      // Refresh history to sync IDs
      queryClient.invalidateQueries({ queryKey: ['ask-egm-history', domainReviewId] });
    }
  }, [input, streaming, domainReviewId, queryClient, pendingAttachments, webSearchEnabled, streamingContent, t]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // -- FAB (closed or minimized state) ------------------------------------------------

  if (panelState === 'closed' || panelState === 'minimized') {
    return (
      <button
        type="button"
        onClick={() => { setPanelState('open'); setHasNewResponse(false); }}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
        title={t('askEgm.buttonTitle')}
      >
        {/* Streaming while minimized: pulse animation */}
        {panelState === 'minimized' && streaming ? (
          <div className="relative">
            <RobotOutlined style={{ fontSize: 24 }} />
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-yellow-400 items-center justify-center">
                <LoadingOutlined style={{ fontSize: 8, color: '#fff' }} />
              </span>
            </span>
          </div>
        ) : panelState === 'minimized' && hasNewResponse ? (
          /* Finished while minimized: green badge */
          <div className="relative">
            <RobotOutlined style={{ fontSize: 24 }} />
            <span className="absolute -top-1 -right-1">
              <CheckCircleFilled style={{ fontSize: 16, color: '#22c55e' }} />
            </span>
          </div>
        ) : (
          <RobotOutlined style={{ fontSize: 24 }} />
        )}
      </button>
    );
  }

  // Find the last assistant message index for showing follow-ups
  const lastAssistantIdx = messages.length - 1 - [...messages].reverse().findIndex((m) => m.role === 'assistant');

  // Expanded chat panel
  return (
    <div className="fixed bottom-6 right-6 z-50 w-[420px] h-[580px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/*,.pdf,.txt,.csv,.xlsx,.docx"
        multiple
        onChange={handleFileSelect}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white">
        <div className="flex items-center gap-2">
          <RobotOutlined style={{ fontSize: 18 }} />
          <span className="font-semibold text-sm">{t('askEgm.title')}</span>
          <span className="text-xs opacity-80">· {domainName}</span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip title={t('askEgm.clearConversation')} placement="bottom">
            <button
              type="button"
              onClick={handleClearHistory}
              className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
            >
              <DeleteOutlined style={{ fontSize: 13 }} />
            </button>
          </Tooltip>
          <Tooltip title={t('askEgm.minimize')} placement="bottom">
            <button
              type="button"
              onClick={() => setPanelState('minimized')}
              className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
            >
              <CloseOutlined style={{ fontSize: 14 }} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Context badges */}
      <div className="px-4 py-2 border-b border-gray-100 flex gap-2 flex-wrap">
        <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{t('askEgm.requestInfo')}</span>
        <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">{t('askEgm.questionnaire')}</span>
        <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{t('askEgm.actionItemsBadge')}</span>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-sm text-text-secondary mb-4">
              {t('askEgm.askAnything')}<strong>{domainName}</strong> {t('askEgm.reviewSuffix')}
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

        {messages.map((msg, idx) => (
          <div key={msg.id}>
            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                }`}
              >
                {/* User message: attachments preview */}
                {msg.role === 'user' && msg.metadata?.attachments && (
                  <AttachmentPreview attachments={msg.metadata.attachments} />
                )}

                {/* Content: markdown for assistant, plain text for user */}
                {msg.role === 'assistant' ? (
                  <div className="prose-sm ask-egm-markdown">
                    <MarkdownContent content={msg.content} />
                    {msg.metadata?.sources && <SourcesCitation sources={msg.metadata.sources} />}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                )}
              </div>
            </div>

            {/* Follow-up questions after the LAST assistant message */}
            {msg.role === 'assistant' && idx === lastAssistantIdx && !streaming && latestFollowUps.length > 0 && (
              <FollowUpQuestions
                questions={latestFollowUps}
                onSelect={handleSend}
                disabled={streaming}
              />
            )}
          </div>
        ))}

        {/* Streaming message */}
        {streaming && streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-xl rounded-bl-sm bg-gray-100 text-gray-800 px-3 py-2 text-sm">
              <div className="prose-sm ask-egm-markdown">
                <MarkdownContent content={streamingContent} />
              </div>
            </div>
          </div>
        )}

        {/* Web search indicator */}
        {streaming && searchingWeb && (
          <div className="flex justify-start">
            <div className="bg-purple-50 rounded-xl rounded-bl-sm px-3 py-2 text-sm text-purple-600 flex items-center gap-1.5">
              <SearchOutlined className="animate-pulse" />
              <span>{t('askEgm.searchingWeb')}{searchQuery ? `: "${searchQuery}"` : '...'}</span>
            </div>
          </div>
        )}

        {/* Typing indicator */}
        {streaming && !streamingContent && !searchingWeb && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-xl rounded-bl-sm px-3 py-2 text-sm text-gray-500">
              <LoadingOutlined className="mr-1" /> {t('askEgm.thinking')}
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Disclaimer */}
      <div className="px-4 py-1 text-center">
        <span className="text-[10px] text-gray-400">{t('askEgm.disclaimer')}</span>
      </div>

      {/* Pending attachments preview */}
      <PendingAttachments attachments={pendingAttachments} onRemove={removePendingAttachment} />

      {/* Input area */}
      <div className="px-4 pb-3 pt-1 border-t border-gray-100">
        <div className="flex gap-2 items-end">
          {/* Attachment + Web Search toggle buttons */}
          <div className="flex flex-col gap-0.5 pb-0.5">
            <Tooltip title={t('askEgm.uploadTooltip')} placement="top">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || streaming}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
              >
                {uploading ? <LoadingOutlined style={{ fontSize: 16 }} /> : <PaperClipOutlined style={{ fontSize: 16 }} />}
              </button>
            </Tooltip>
            <Tooltip title={webSearchEnabled ? t('askEgm.webSearchOn') : t('askEgm.enableWebSearch')} placement="top">
              <button
                type="button"
                onClick={() => setWebSearchEnabled((v) => !v)}
                disabled={streaming}
                className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                  webSearchEnabled
                    ? 'bg-purple-100 text-purple-600 hover:bg-purple-200'
                    : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                }`}
              >
                <GlobalOutlined style={{ fontSize: 16 }} />
              </button>
            </Tooltip>
          </div>

          <textarea
            ref={textareaRef}
            className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent"
            rows={1}
            placeholder={pendingAttachments.length ? t('askEgm.attachmentPlaceholder') : t('askEgm.placeholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={streaming}
          />

          {/* Send or Cancel button */}
          {streaming ? (
            <Tooltip title={t('common.cancel')} placement="top">
              <Button
                danger
                shape="circle"
                icon={<StopOutlined />}
                onClick={handleCancel}
                className="flex-shrink-0"
              />
            </Tooltip>
          ) : (
            <Button
              type="primary"
              shape="circle"
              icon={<SendOutlined />}
              disabled={!input.trim() && !pendingAttachments.length}
              onClick={() => handleSend()}
              className="flex-shrink-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}

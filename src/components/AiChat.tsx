import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowUp,
  AtSign,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsRight,
  Copy,
  Edit3,
  FileText,
  Globe2,
  Loader2,
  Map,
  MessageCircle,
  MessageCirclePlus,
  Mic,
  MoreHorizontal,
  PanelRight,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  AI_MODELS,
  AI_PROVIDER_OPENROUTER,
  AiActionPlan,
  AiChatRequestOptions,
  AiModelId,
  aiModelLabel,
  applyAiActionPlan,
  canTrustedModeAutoApply,
  cancelAiGeneration,
  formatAiActionPreview,
  selectAiActions
} from '../lib/ai';
import { CHAT_ACTIONS_FENCE, visibleStreamText } from '../lib/aiChatSession';
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from '../lib/overlay';
import { AiMarkdown } from './AiMarkdown';

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) return '';

  const diffMs = Date.now() - timestamp;
  const absMs = Math.abs(diffMs);
  const minutes = Math.round(absMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

type AiComposerMode = 'default' | 'ask' | 'plan';

const SUGGESTIONS: Array<{ label: string; prompt: string; icon: LucideIcon }> = [
  { label: 'Search for anything', prompt: 'Search for anything about this workspace', icon: Search },
  { label: 'Write meeting agenda', prompt: 'Write a meeting agenda for this page', icon: Sparkles },
  { label: 'Analyze PDFs or images', prompt: 'Analyze the attached PDFs or images', icon: FileText },
  { label: 'Create a task tracker', prompt: 'Create a task tracker', icon: CheckCircle2 },
];

const MODE_OPTIONS: Array<{
  id: AiComposerMode;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  { id: 'default', label: 'Default', description: 'Can search, edit, and more', icon: WandSparkles },
  { id: 'ask', label: 'Ask', description: "Answers only, won't make edits", icon: MessageCircle },
  { id: 'plan', label: 'Plan', description: 'Plans first, then executes after approval', icon: Map },
];

const PERSONA_ICONS = [WandSparkles, Sparkles, Search, FileText, CheckCircle2, MessageCircle, Map, Globe2];

function InlineActionCard({
  plan,
  autoApply,
  onApplied,
}: {
  plan: AiActionPlan;
  autoApply: boolean;
  onApplied: () => void;
}) {
  const [selected, setSelected] = useState<boolean[]>(plan.actions.map(() => true));
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const autoApplyStartedRef = useRef(false);
  const fetchPages = useAppStore((state) => state.fetchPages);
  const setCurrentPageId = useAppStore((state) => state.setCurrentPageId);
  const showSuccess = useAppStore((state) => state.showSuccess);
  const showError = useAppStore((state) => state.showError);

  const apply = async (useSelection: boolean) => {
    const selectedIndices = selected.flatMap((checked, index) => (checked ? [index] : []));
    const planToApply = useSelection ? selectAiActions(plan, selectedIndices) : plan;
    if (planToApply.actions.length === 0) return;

    setApplying(true);
    try {
      const result = await applyAiActionPlan(planToApply);
      await fetchPages();
      if (result.primary_page_id) setCurrentPageId(result.primary_page_id);
      const changed = result.created_page_ids.length + result.updated_page_ids.length;
      showSuccess(`AI applied ${changed} item${changed === 1 ? '' : 's'}.`);
      setApplied(true);
      onApplied();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setApplying(false);
    }
  };

  useEffect(() => {
    if (!autoApply || autoApplyStartedRef.current || applied) return;
    autoApplyStartedRef.current = true;
    void apply(false);
  }, [autoApply, applied]);

  if (applied) {
    return (
      <div className="on-ai-action-card on-ai-action-card-applied">
        <Check className="h-4 w-4" />
        <span>Applied</span>
      </div>
    );
  }

  const selectedCount = selected.filter(Boolean).length;

  return (
    <div className="on-ai-action-card">
      <div className="on-ai-action-card-copy">
        <div>
          <span>{plan.summary}</span>
          <small>{selectedCount} pending action{selectedCount === 1 ? '' : 's'}</small>
        </div>
        <Sparkles className="h-4 w-4" />
      </div>
      <ul className="on-ai-action-list">
        {formatAiActionPreview(plan).map((line, index) => (
          <li key={`${line}-${index}`}>
            <label>
              <input
                type="checkbox"
                checked={selected[index] ?? true}
                disabled={applying}
                onChange={(event) =>
                  setSelected((current) => {
                    const next = plan.actions.map((_, actionIndex) => current[actionIndex] ?? true);
                    next[index] = event.target.checked;
                    return next;
                  })
                }
              />
              <span>{line}</span>
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="on-button-secondary on-ai-action-apply"
        onClick={() => void apply(true)}
        disabled={applying || selectedCount === 0}
      >
        {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        <span>{applying ? 'Applying...' : `Apply ${selectedCount} selected`}</span>
      </button>
    </div>
  );
}

export function AiChat() {
  const launcherRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isOpen = useAppStore((state) => state.isAiActionModalOpen);
  const openAiActionModal = useAppStore((state) => state.openAiActionModal);
  const onClose = useAppStore((state) => state.closeAiActionModal);
  const notesPageId = useAppStore((state) => state.currentPageId);
  const workspaceMode = useAppStore((state) => state.workspaceMode);
  const studioDocument = useAppStore((state) =>
    state.workspaceMode === 'studio'
      ? state.studioDocuments.find((document) => document.id === state.currentStudioDocumentId) ?? null
      : null
  );
  const notesPageTitle = useAppStore(
    (state) => state.pages.find((page) => page.id === state.currentPageId)?.title ?? null
  );
  const currentPageId = workspaceMode === 'studio' ? studioDocument?.note_page_id ?? null : notesPageId;
  const currentPageTitle =
    workspaceMode === 'studio'
      ? studioDocument
        ? `${studioDocument.title} Notes`
        : null
      : notesPageTitle;
  const aiSettings = useAppStore((state) => state.aiSettings);
  const aiModels = useAppStore((state) => state.aiModels);
  const fetchAiSettings = useAppStore((state) => state.fetchAiSettings);
  const fetchAiModels = useAppStore((state) => state.fetchAiModels);
  const updateAiSettingsAction = useAppStore((state) => state.updateAiSettingsAction);
  const conversations = useAppStore((state) => state.aiConversations);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const messages = useAppStore((state) => state.aiMessages);
  const streamingMessageId = useAppStore((state) => state.streamingMessageId);
  const fetchAiConversations = useAppStore((state) => state.fetchAiConversations);
  const openAiConversation = useAppStore((state) => state.openAiConversation);
  const newAiConversation = useAppStore((state) => state.newAiConversation);
  const renameAiConversationAction = useAppStore((state) => state.renameAiConversationAction);
  const deleteAiConversationAction = useAppStore((state) => state.deleteAiConversationAction);
  const sendAiChatMessage = useAppStore((state) => state.sendAiChatMessage);
  const regenerateAiChat = useAppStore((state) => state.regenerateAiChat);
  const showSuccess = useAppStore((state) => state.showSuccess);
  const showError = useAppStore((state) => state.showError);

  const [prompt, setPrompt] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [autoApplyMessageId, setAutoApplyMessageId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<AiComposerMode>('default');
  const [webAccessEnabled, setWebAccessEnabled] = useState(true);
  const [widePanel, setWidePanel] = useState(false);
  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  const [personaName, setPersonaName] = useState('');
  const [personaIconIndex, setPersonaIconIndex] = useState(0);
  const [personaInstructionsAdded, setPersonaInstructionsAdded] = useState(false);
  const [attachedSources, setAttachedSources] = useState<string[]>([]);
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<Record<string, 'up' | 'down'>>({});
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const streamingRef = useRef(false);

  const selectedModel: AiModelId = aiSettings?.model ?? AI_MODELS[0].id;
  const hasApiKey = Boolean(aiSettings?.has_api_key);
  const trustedModeEnabled = Boolean(aiSettings?.trusted_mode_enabled);
  const isStreaming = streamingMessageId !== null;
  const canSend = useMemo(() => Boolean(prompt.trim()) && !isStreaming && hasApiKey, [hasApiKey, isStreaming, prompt]);
  const activeConversation = conversations.find((item) => item.id === activeConversationId) ?? null;
  const panelTitle =
    messages.length === 0 || !activeConversation || activeConversation.title === 'New chat'
      ? 'New AI chat'
      : activeConversation.title;
  const selectedMode = MODE_OPTIONS.find((item) => item.id === composerMode) ?? MODE_OPTIONS[0];
  const contextLabel = currentPageTitle ?? 'New page';
  const SelectedPersonaIcon = PERSONA_ICONS[personaIconIndex] ?? WandSparkles;

  useEffect(() => {
    streamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (!isOpen) return;
    closeOpenOverlays();
    setAttachMenuOpen(false);
    setModeMenuOpen(false);
    setMoreMenuOpen(false);
    void fetchAiSettings();
    void fetchAiModels();
    void fetchAiConversations();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const handleCloseOverlays = () => onClose();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, handleCloseOverlays);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, handleCloseOverlays);
    };
  }, [fetchAiConversations, fetchAiModels, fetchAiSettings, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen && streamingRef.current) {
      void cancelAiGeneration();
      return;
    }
    if (!isOpen) {
      setHistoryOpen(false);
      setAttachMenuOpen(false);
      setModeMenuOpen(false);
      setMoreMenuOpen(false);
      setPersonalizeOpen(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [isOpen, messages, streamingMessageId]);

  useEffect(() => {
    if (!isOpen || !aiSettings || aiModels.length === 0) return;
    if (aiModels.some((model) => model.id === aiSettings.model)) return;
    void updateAiSettingsAction({
      provider: AI_PROVIDER_OPENROUTER,
      model: aiModels[0].id,
      trusted_mode_enabled: aiSettings.trusted_mode_enabled,
    });
  }, [aiModels, aiSettings, isOpen, updateAiSettingsAction]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

  const handleModelChange = (model: AiModelId) => {
    if (!aiSettings || model === selectedModel) return;
    void updateAiSettingsAction({
      provider: AI_PROVIDER_OPENROUTER,
      model,
      trusted_mode_enabled: trustedModeEnabled,
    });
  };

  const submitPrompt = async (value = prompt) => {
    const cleanPrompt = value.trim();
    if (!cleanPrompt || isStreaming) return;
    if (!hasApiKey) {
      showError(new Error('Missing AI API key'));
      return;
    }
    setPrompt('');
    setAttachMenuOpen(false);
    setModeMenuOpen(false);
    setHistoryOpen(false);
    setExpandedSteps(new Set());
    const requestOptions = currentChatOptions();
    const saved = await sendAiChatMessage(cleanPrompt, currentPageId, requestOptions);
    if (saved) setAttachedSources([]);
    if (saved?.plan && canTrustedModeAutoApply(saved.plan, trustedModeEnabled)) {
      setAutoApplyMessageId(saved.id);
    }
  };

  const handleSend = async () => {
    await submitPrompt();
  };

  const handleRegenerate = async () => {
    if (isStreaming) return;
    const saved = await regenerateAiChat(currentPageId, currentChatOptions());
    if (saved?.plan && canTrustedModeAutoApply(saved.plan, trustedModeEnabled)) {
      setAutoApplyMessageId(saved.id);
    }
  };

  const currentChatOptions = (): AiChatRequestOptions => ({
    mode: composerMode,
    web_access_enabled: webAccessEnabled,
    persona_name: personaName.trim() || null,
    persona_instructions_added: personaInstructionsAdded,
    attached_sources: attachedSources,
  });

  const handleCopyMessage = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(id);
      window.setTimeout(() => setCopiedMessageId(null), 1200);
    } catch (error: unknown) {
      showError(error);
    }
  };

  const transcriptText = () =>
    messages.map((message) => `${message.role === 'user' ? 'You' : 'AI'}: ${message.content}`).join('\n\n').trim();

  const copyTranscript = async () => {
    const text = transcriptText() || panelTitle;
    try {
      await navigator.clipboard.writeText(text);
      showSuccess(messages.length > 0 ? 'AI chat copied.' : 'AI chat title copied.');
    } catch (error: unknown) {
      showError(error);
    }
  };

  const shareConversation = async () => {
    const text = transcriptText() || panelTitle;
    try {
      if ('share' in navigator && typeof navigator.share === 'function') {
        await navigator.share({ title: panelTitle, text });
      } else {
        await navigator.clipboard.writeText(text);
        showSuccess('AI chat copied for sharing.');
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      showError(error);
    }
  };

  const focusComposer = () => {
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const addFollowUp = () => {
    setPrompt((current) => current || 'Follow up on this.');
    focusComposer();
  };

  const setFeedback = (id: string, value: 'up' | 'down') => {
    setFeedbackByMessageId((current) => ({ ...current, [id]: value }));
    showSuccess(value === 'up' ? 'Marked as helpful.' : 'Feedback saved.');
  };

  const handleAttachFiles = () => {
    fileInputRef.current?.click();
  };

  const handleMentionCurrentPage = () => {
    const mention = `@${contextLabel} `;
    setPrompt((current) => (current.includes(mention) ? current : `${mention}${current}`));
    setAttachMenuOpen(false);
    focusComposer();
  };

  const clearActiveChat = async () => {
    setMoreMenuOpen(false);
    await startNewConversation();
    showSuccess('Started a new AI chat.');
  };

  const startRename = (id: string, title: string) => {
    setRenamingId(id);
    setRenameDraft(title);
  };

  const submitRename = async () => {
    const id = renamingId;
    if (!id) return;
    const title = renameDraft.trim();
    setRenamingId(null);
    setRenameDraft('');
    if (title) await renameAiConversationAction(id, title);
  };

  const startNewConversation = async () => {
    setAutoApplyMessageId(null);
    setHistoryOpen(false);
    setMoreMenuOpen(false);
    await newAiConversation();
  };

  const stop = () => {
    void cancelAiGeneration();
  };

  const modal = isOpen ? createPortal(
    <div
      className="on-ai-chat-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`on-ai-chat-modal ${widePanel ? 'on-ai-chat-modal-wide' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-label="AI chat"
      >
        <header className="on-ai-chat-topbar">
          <div className="on-ai-chat-title-wrap">
            <button
              type="button"
              className="on-ai-chat-title-button"
              aria-expanded={historyOpen}
              aria-label="AI conversations"
              onClick={() => {
                setHistoryOpen((open) => !open);
                setAttachMenuOpen(false);
                setModeMenuOpen(false);
              }}
            >
              <span className="on-ai-title-mark">
                <WandSparkles className="h-4 w-4" />
              </span>
              <span>{panelTitle}</span>
              <ChevronDown className="h-4 w-4" />
            </button>

            {historyOpen && (
              <div className="on-ai-history-menu" role="menu" aria-label="AI conversations">
                <button
                  type="button"
                  className="on-ai-history-new"
                  onClick={() => {
                    void startNewConversation();
                    setHistoryOpen(false);
                  }}
                >
                  <MessageCirclePlus className="h-4 w-4" />
                  <span>New AI chat</span>
                </button>
                <div className="on-ai-history-list">
                  {conversations.length === 0 ? (
                    <div className="on-ai-history-empty">No conversations yet</div>
                  ) : (
                    conversations.map((conversation) => {
                      const isActive = conversation.id === activeConversationId;
                      const isRenaming = conversation.id === renamingId;
                      return (
                        <div
                          key={conversation.id}
                          className={`on-ai-history-item ${isActive ? 'on-ai-history-item-active' : ''}`}
                        >
                          {isRenaming ? (
                            <input
                              ref={renameInputRef}
                              value={renameDraft}
                              onChange={(event) => setRenameDraft(event.target.value)}
                              onBlur={() => void submitRename()}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') void submitRename();
                                if (event.key === 'Escape') {
                                  setRenamingId(null);
                                  setRenameDraft('');
                                }
                              }}
                              aria-label="Conversation title"
                            />
                          ) : (
                            <button
                              type="button"
                              className="on-ai-history-open"
                              onClick={() => {
                                void openAiConversation(conversation.id);
                                setHistoryOpen(false);
                              }}
                            >
                              <span>{conversation.title}</span>
                              <time>{formatRelativeTime(conversation.updated_at)}</time>
                            </button>
                          )}
                          {!isRenaming && (
                            <div className="on-ai-history-actions">
                              <button
                                type="button"
                                aria-label="Rename conversation"
                                onClick={() => startRename(conversation.id, conversation.title)}
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label="Delete conversation"
                                onClick={() => void deleteAiConversationAction(conversation.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="on-ai-chat-top-actions">
            <button type="button" aria-label="Share AI chat" onClick={() => void shareConversation()}>
              <Share2 className="h-4 w-4" />
            </button>
            <button type="button" aria-label="New chat" onClick={() => void startNewConversation()}>
              <MessageCirclePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Toggle panel"
              aria-pressed={widePanel}
              onClick={() => setWidePanel((current) => !current)}
            >
              <PanelRight className="h-4 w-4" />
            </button>
            <div className="on-ai-header-menu-anchor">
              <button
                type="button"
                aria-label="More AI actions"
                aria-expanded={moreMenuOpen}
                onClick={() => {
                  setMoreMenuOpen((open) => !open);
                  setHistoryOpen(false);
                  setAttachMenuOpen(false);
                  setModeMenuOpen(false);
                }}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {moreMenuOpen && (
                <div className="on-ai-more-menu" role="menu" aria-label="More AI actions">
                  <button type="button" role="menuitem" onClick={() => void copyTranscript()}>
                    <Copy className="h-4 w-4" />
                    <span>Copy transcript</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => void clearActiveChat()}>
                    <MessageCirclePlus className="h-4 w-4" />
                    <span>Start new chat</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      setModeMenuOpen(true);
                    }}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    <span>Open settings</span>
                  </button>
                </div>
              )}
            </div>
            <button type="button" aria-label="Close AI" onClick={onClose}>
              <ChevronsRight className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="on-ai-chat-thread">
          {messages.length === 0 ? (
            <div className="on-ai-chat-empty">
              <div className="on-ai-empty-mark">
                <WandSparkles className="h-9 w-9" strokeWidth={1.75} />
              </div>
              <h2>How can I help you today?</h2>
              <div className="on-ai-empty-actions" aria-label="AI suggestions">
                {SUGGESTIONS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button key={item.label} type="button" onClick={() => void submitPrompt(item.prompt)}>
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            messages.map((message) => {
              const streaming = message.id === streamingMessageId;
              const visibleContent = streaming ? visibleStreamText(message.content) : message.content;
              const preparingActions = streaming && message.content.includes(CHAT_ACTIONS_FENCE);
              const isLastMessage = message.id === messages[messages.length - 1]?.id;
              const isLastAssistant = message.role === 'assistant' && message.id === messages[messages.length - 1]?.id;
              const isLastUserWithoutReply = message.role === 'user' && isLastMessage;
              return (
                <article key={message.id} className={`on-ai-message on-ai-message-${message.role}`}>
                  <div className="on-ai-message-stack">
                    {message.role === 'user' ? (
                      <div className="on-ai-user-pill">
                        <span>{message.content}</span>
                      </div>
                    ) : (
                      <>
                        {streaming && !visibleContent ? (
                          <button type="button" className="on-ai-working-row" aria-label="AI is working">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Working</span>
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        ) : (
                          <div className="on-ai-message-bubble">
                            {message.plan && (
                              <>
                                <button
                                  type="button"
                                  className="on-ai-steps-toggle"
                                  aria-expanded={expandedSteps.has(message.id)}
                                  onClick={() => setExpandedSteps((current) => {
                                    const next = new Set(current);
                                    if (next.has(message.id)) next.delete(message.id);
                                    else next.add(message.id);
                                    return next;
                                  })}
                                >
                                  <span>4 steps</span>
                                  <ChevronDown className="h-4 w-4" />
                                </button>
                                {expandedSteps.has(message.id) && (
                                  <ol className="on-ai-steps-list">
                                    <li>Thought</li>
                                    <li>Loaded OpenNotion tools</li>
                                    <li>Thought</li>
                                    <li>Prepared {message.plan.summary}</li>
                                  </ol>
                                )}
                              </>
                            )}
                            {visibleContent ? <AiMarkdown content={visibleContent} /> : null}
                            {preparingActions && <div className="on-ai-preparing-actions">Preparing actions...</div>}
                            {message.plan && (
                              <InlineActionCard
                                plan={message.plan}
                                autoApply={message.id === autoApplyMessageId}
                                onApplied={() => setAutoApplyMessageId(null)}
                              />
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {!streaming && (
                      <div className="on-ai-message-actions">
                        <button
                          type="button"
                          onClick={() => void handleCopyMessage(message.id, message.content)}
                          aria-label="Copy message"
                        >
                          {copiedMessageId === message.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          <span>Copy</span>
                        </button>
                        {message.role === 'assistant' && (
                          <>
                            <button type="button" aria-label="Add follow-up" onClick={addFollowUp}>
                              <Plus className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label="Good response"
                              aria-pressed={feedbackByMessageId[message.id] === 'up'}
                              onClick={() => setFeedback(message.id, 'up')}
                            >
                              <ThumbsUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label="Bad response"
                              aria-pressed={feedbackByMessageId[message.id] === 'down'}
                              onClick={() => setFeedback(message.id, 'down')}
                            >
                              <ThumbsDown className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {isLastAssistant && (
                          <button type="button" onClick={() => void handleRegenerate()} aria-label="Regenerate">
                            <RefreshCw className="h-4 w-4" />
                            <span>Regenerate</span>
                          </button>
                        )}
                        {isLastUserWithoutReply && (
                          <button type="button" onClick={() => void handleRegenerate()} aria-label="Retry">
                            <RefreshCw className="h-4 w-4" />
                            <span>Retry</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })
          )}
          <div ref={endRef} />
        </div>

        <footer className="on-ai-chat-composer">
          <div className="on-ai-composer-card">
            <input
              ref={fileInputRef}
              className="on-ai-hidden-file-input"
              type="file"
              accept="image/*,.pdf,.csv"
              multiple
              tabIndex={-1}
              onChange={(event) => {
                const names = Array.from(event.currentTarget.files ?? []).map((file) => file.name);
                if (names.length > 0) {
                  setAttachedSources((current) => [...current, ...names]);
                  showSuccess(`${names.length} source${names.length === 1 ? '' : 's'} attached to this chat.`);
                }
                setAttachMenuOpen(false);
                event.currentTarget.value = '';
              }}
            />
            <div className="on-ai-composer-context-row">
              <span className="on-ai-context-chip">
                <FileText className="h-4 w-4" />
                <span>{contextLabel}</span>
              </span>
              <span className="on-ai-ready-status">
                {hasApiKey ? `Ready${trustedModeEnabled ? ' / Trusted' : ''}` : 'Needs key'}
              </span>
            </div>
            {attachedSources.length > 0 && (
              <div className="on-ai-source-chips" aria-label="Attached sources">
                {attachedSources.map((source, index) => (
                  <span key={`${source}-${index}`} className="on-ai-source-chip">
                    <Paperclip className="h-3.5 w-3.5" />
                    <span>{source}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${source}`}
                      onClick={() => setAttachedSources((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={hasApiKey ? 'Do anything with AI...' : 'Add an OpenRouter API key in Settings first'}
              aria-label="Message AI"
            />
            <div className="on-ai-composer-actions">
              <div className="on-ai-composer-left-actions">
                <div className="on-ai-composer-popover-anchor">
                  <button
                    type="button"
                    className="on-ai-composer-icon-button"
                    aria-label="Add sources"
                    aria-expanded={attachMenuOpen}
                    onClick={() => {
                      setAttachMenuOpen((open) => !open);
                      setModeMenuOpen(false);
                    }}
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                  {attachMenuOpen && (
                    <div className="on-ai-attach-menu" role="menu" aria-label="Add sources">
                      <button type="button" role="menuitem" onClick={handleAttachFiles}>
                        <Paperclip className="h-4 w-4" />
                        <span>Add images, PDFs, or CSVs</span>
                      </button>
                      <button type="button" role="menuitem" onClick={handleMentionCurrentPage}>
                        <AtSign className="h-4 w-4" />
                        <span>Mention pages or people</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="on-ai-composer-popover-anchor">
                  <button
                    type="button"
                    className="on-ai-composer-icon-button"
                    aria-label="AI settings"
                    aria-expanded={modeMenuOpen}
                    onClick={() => {
                      setModeMenuOpen((open) => !open);
                      setAttachMenuOpen(false);
                    }}
                  >
                    <SlidersHorizontal className="h-5 w-5" />
                  </button>
                  {modeMenuOpen && (
                    <div className="on-ai-mode-menu" role="menu" aria-label="AI settings">
                      <div className="on-ai-mode-menu-row">
                        <Globe2 className="h-4 w-4" />
                        <span>Web access</span>
                        <button
                          type="button"
                          className={`on-ai-toggle-switch ${webAccessEnabled ? 'on-ai-toggle-switch-on' : ''}`}
                          aria-label="Toggle web access"
                          aria-pressed={webAccessEnabled}
                          onClick={() => setWebAccessEnabled((enabled) => !enabled)}
                        />
                      </div>
                      <button
                        type="button"
                        className="on-ai-mode-menu-row"
                        onClick={() => {
                          setModeMenuOpen(false);
                          setAttachMenuOpen(true);
                        }}
                      >
                        <Sparkles className="h-4 w-4" />
                        <span>My sources</span>
                        <strong>{attachedSources.length}</strong>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="on-ai-mode-menu-row"
                        onClick={() => {
                          setModeMenuOpen(false);
                          setAttachMenuOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                        <span>Add sources</span>
                      </button>
                      <div className="on-ai-mode-divider" />
                      <div className="on-ai-mode-options">
                        {MODE_OPTIONS.map((item) => {
                          const Icon = item.icon;
                          const selected = item.id === composerMode;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className={selected ? 'on-ai-mode-option-selected' : ''}
                              onClick={() => setComposerMode(item.id)}
                            >
                              <Icon className="h-4 w-4" />
                              <span>
                                <strong>{item.label}</strong>
                                <small>{item.description}</small>
                              </span>
                              {selected && <Check className="h-4 w-4" />}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        className="on-ai-mode-menu-row"
                        onClick={() => {
                          setPersonalizeOpen(true);
                          setModeMenuOpen(false);
                        }}
                      >
                        <WandSparkles className="h-4 w-4" />
                        <span>Personalize</span>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <label className="on-ai-model-menu-row">
                        <span>Model</span>
                        <select
                          aria-label="AI model"
                          value={selectedModel}
                          onChange={(event) => handleModelChange(event.target.value as AiModelId)}
                          disabled={isStreaming}
                        >
                          {!aiModels.some((model) => model.id === selectedModel) && (
                            <option value={selectedModel}>{aiModelLabel(selectedModel, aiModels)}</option>
                          )}
                          {aiModels.map((model) => (
                            <option key={model.id} value={model.id}>{model.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              </div>

              <div className="on-ai-composer-right-actions">
                <span className="on-ai-auto-label">{selectedMode.label === 'Default' ? 'Auto' : selectedMode.label}</span>
                <button
                  type="button"
                  className="on-ai-composer-icon-button"
                  aria-label="Voice input"
                  onClick={() => {
                    setPrompt((current) => current || 'Voice input is not available yet. Type your request here.');
                    focusComposer();
                  }}
                >
                  <Mic className="h-5 w-5" />
                </button>
                {isStreaming ? (
                  <button type="button" className="on-ai-chat-send on-ai-chat-stop" aria-label="Stop" onClick={stop}>
                    <Square className="h-4 w-4" fill="currentColor" />
                  </button>
                ) : (
                  <button type="button" className="on-ai-chat-send" aria-label="Send" onClick={() => void handleSend()} disabled={!canSend}>
                    <ArrowUp className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </footer>

        {personalizeOpen && (
          <div
            className="on-ai-personalize-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Personalize AI"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setPersonalizeOpen(false);
            }}
          >
            <div className="on-ai-personalize-modal">
              <button
                type="button"
                className="on-ai-personalize-close"
                aria-label="Close personalization"
                onClick={() => setPersonalizeOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
              <h2>Personalize your OpenNotion AI</h2>
              <div className="on-ai-persona-avatar-row">
                <button
                  type="button"
                  aria-label="Previous AI icon"
                  onClick={() => setPersonaIconIndex((index) => (index - 1 + PERSONA_ICONS.length) % PERSONA_ICONS.length)}
                >
                  <ChevronRight className="h-5 w-5 rotate-180" />
                </button>
                <div className="on-ai-persona-avatar">
                  <SelectedPersonaIcon className="h-12 w-12" />
                </div>
                <button
                  type="button"
                  aria-label="Next AI icon"
                  onClick={() => setPersonaIconIndex((index) => (index + 1) % PERSONA_ICONS.length)}
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
              <input
                value={personaName}
                onChange={(event) => setPersonaName(event.target.value)}
                placeholder="Enter a name"
                aria-label="AI name"
              />
              <div className="on-ai-persona-section-label">Instructions</div>
              <div className="on-ai-persona-instructions">
                <span>
                  {personaInstructionsAdded
                    ? 'Using this workspace page as guidance for future AI chats'
                    : 'Use a page to give OpenNotion AI instructions and guide its behavior'}
                </span>
                <button type="button" onClick={() => setPersonaInstructionsAdded(true)}>
                  <Plus className="h-4 w-4" />
                  <span>{personaInstructionsAdded ? 'Instructions added' : 'Add instructions'}</span>
                </button>
              </div>
              <div className="on-ai-persona-icon-grid" aria-label="AI icon choices">
                {PERSONA_ICONS.map((Icon, index) => (
                  <button
                    key={index}
                    type="button"
                    aria-label={`AI icon ${index + 1}`}
                    aria-pressed={index === personaIconIndex}
                    onClick={() => setPersonaIconIndex(index)}
                  >
                    <Icon className="h-7 w-7" />
                  </button>
                ))}
              </div>
              <div className="on-ai-persona-footer">
                <button
                  type="button"
                  onClick={() => {
                    setPersonaName('');
                    setPersonaIconIndex(0);
                    setPersonaInstructionsAdded(false);
                  }}
                >
                  Reset
                </button>
                <button type="button" onClick={() => setPersonalizeOpen(false)}>Done</button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className={`on-ai-launch-button ${isOpen ? 'on-ai-launch-button-active' : ''}`}
        aria-label="Ask AI"
        title="Ask AI"
        onClick={() => {
          if (isOpen) {
            onClose();
          } else {
            openAiActionModal();
          }
        }}
      >
        <WandSparkles className="h-4 w-4" />
        <span>Ask AI</span>
      </button>
      {modal}
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  CheckCircle2,
  ChevronsRight,
  Database,
  FileText,
  Mic,
  PanelRight,
  Plus,
  SendHorizontal,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  AI_MODELS,
  AI_PROVIDER_OPENROUTER,
  AiActionPlan,
  AiModelId,
  aiModelLabel,
  applyAiActionPlan,
  canTrustedModeAutoApply,
  generateAiActionPlan
} from '../lib/ai';
import {
  AiChatMessage,
  aiAppliedMessage,
  aiMissingKeyMessage,
  aiPlanMessages,
  trimmedAiPrompt
} from '../lib/aiChat';
import { CLOSE_OPEN_OVERLAYS_EVENT, closeOpenOverlays } from '../lib/overlay';

function nextMessageId() {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function userMessage(id: string, content: string): AiChatMessage {
  return { id, role: 'user', content };
}

const QUICK_PROMPTS = [
  { label: 'Create a study page', prompt: 'Create a study page for this topic', icon: FileText },
  { label: 'Create a revision database', prompt: 'Create a revision database', icon: Database },
  { label: 'Create section subpages', prompt: 'Create subpages for the main sections', icon: CheckCircle2 },
];

export function AiActionModal() {
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isOpen = useAppStore((state) => state.isAiActionModalOpen);
  const openAiActionModal = useAppStore((state) => state.openAiActionModal);
  const onClose = useAppStore((state) => state.closeAiActionModal);
  const currentPageId = useAppStore((state) => state.currentPageId);
  const currentPageTitle = useAppStore((state) =>
    state.pages.find((page) => page.id === state.currentPageId)?.title ?? null
  );
  const aiSettings = useAppStore((state) => state.aiSettings);
  const aiModels = useAppStore((state) => state.aiModels);
  const fetchAiSettings = useAppStore((state) => state.fetchAiSettings);
  const fetchAiModels = useAppStore((state) => state.fetchAiModels);
  const fetchPages = useAppStore((state) => state.fetchPages);
  const setCurrentPageId = useAppStore((state) => state.setCurrentPageId);
  const showSuccess = useAppStore((state) => state.showSuccess);
  const showError = useAppStore((state) => state.showError);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [plan, setPlan] = useState<AiActionPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    closeOpenOverlays();
    void fetchAiSettings();
    void fetchAiModels();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (launcherRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const handleCloseOverlays = () => onClose();

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener(CLOSE_OPEN_OVERLAYS_EVENT, handleCloseOverlays);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(CLOSE_OPEN_OVERLAYS_EVENT, handleCloseOverlays);
    };
  }, [fetchAiModels, fetchAiSettings, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [isOpen, messages, isGenerating]);

  const selectedModel: AiModelId = aiSettings?.model ?? AI_MODELS[0].id;
  const hasApiKey = Boolean(aiSettings?.has_api_key);
  const trustedModeEnabled = Boolean(aiSettings?.trusted_mode_enabled);
  const canSend = useMemo(() => Boolean(trimmedAiPrompt(prompt)) && !isGenerating && !isApplying, [isApplying, isGenerating, prompt]);

  const handleApply = async (targetPlan = plan) => {
    if (!targetPlan) return;
    setIsApplying(true);
    try {
      const result = await applyAiActionPlan(targetPlan);
      await fetchPages();
      if (result.primary_page_id) setCurrentPageId(result.primary_page_id);
      setPlan(null);
      setMessages((current) => [...current, aiAppliedMessage(result.created_page_ids.length, nextMessageId())]);
      showSuccess(`AI created ${result.created_page_ids.length} item${result.created_page_ids.length === 1 ? '' : 's'}.`);
    } catch (error: unknown) {
      showError(error);
    } finally {
      setIsApplying(false);
    }
  };

  const handleGenerate = async () => {
    const cleanPrompt = trimmedAiPrompt(prompt);
    if (!cleanPrompt || isGenerating || isApplying) return;

    setPrompt('');
    setPlan(null);

    if (!hasApiKey) {
      setMessages((current) => [
        ...current,
        userMessage(nextMessageId(), cleanPrompt),
        aiMissingKeyMessage(nextMessageId()),
      ]);
      showError(new Error('Missing AI API key'));
      return;
    }

    setIsGenerating(true);
    try {
      const nextPlan = await generateAiActionPlan({
        prompt: cleanPrompt,
        provider: AI_PROVIDER_OPENROUTER,
        model: selectedModel,
        current_page_id: currentPageId,
      });
      setMessages((current) => [
        ...current,
        ...aiPlanMessages(cleanPrompt, nextPlan, nextMessageId(), nextMessageId()),
      ]);
      setPlan(nextPlan);
      if (canTrustedModeAutoApply(nextPlan, trustedModeEnabled)) {
        await handleApply(nextPlan);
      }
    } catch (error: unknown) {
      showError(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const panel = isOpen ? createPortal(
    <aside ref={panelRef} className="on-ai-chat-shell" aria-label="OpenNotion AI chat">
      <div className="on-ai-chat-header">
        <button type="button" className="on-ai-chat-title" aria-label="AI chat menu">
          <span>New AI chat</span>
          <ChevronsRight className="h-4 w-4 rotate-90" strokeWidth={1.9} />
        </button>
        <div className="on-ai-chat-header-actions">
          <button type="button" aria-label="New AI chat" onClick={() => {
            setMessages([]);
            setPlan(null);
            setPrompt('');
          }}>
            <Sparkles className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button type="button" aria-label="Focus AI panel">
            <PanelRight className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button type="button" aria-label="Close AI" onClick={onClose}>
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
      </div>

      <div className="on-ai-chat-scroll">
        {messages.length === 0 && !isGenerating ? (
          <div className="on-ai-empty-state">
            <div className="on-ai-empty-mark">
              <Bot className="h-9 w-9" strokeWidth={1.75} />
            </div>
            <h2>How can I help you today?</h2>
            <div className="on-ai-empty-actions">
              {QUICK_PROMPTS.map(({ label, prompt: value, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPrompt(value)}
                  disabled={isGenerating || isApplying}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.85} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="on-ai-chat-body">
            {messages.map((message) => (
              <div key={message.id} className={`on-ai-chat-message on-ai-chat-message-${message.role} ${message.kind ? `on-ai-chat-message-${message.kind}` : ''}`}>
                <div>{message.content}</div>
                {message.previewLines && (
                  <ul>
                    {message.previewLines.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                )}
              </div>
            ))}
            {isGenerating && (
              <div className="on-ai-chat-message on-ai-chat-message-assistant">
                Generating preview...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {plan && (
        <div className="on-ai-chat-preview-actions">
          <button className="on-button-secondary gap-2" onClick={() => void handleApply()} disabled={isApplying}>
            <Sparkles className="h-4 w-4" /> {isApplying ? 'Applying...' : 'Apply preview'}
          </button>
        </div>
      )}

      <div className="on-ai-chat-composer">
        <div className="on-ai-chat-context">
          <span>{currentPageTitle ? `Context: ${currentPageTitle}` : 'Context: workspace'}</span>
          <span>{aiModelLabel(selectedModel, aiModels)} · {hasApiKey ? 'Ready' : 'Needs key'}{trustedModeEnabled ? ' · Trusted' : ''}</span>
        </div>
        <div className="on-ai-composer-card">
          <div className="on-ai-composer-pill">
            <FileText className="h-4 w-4" strokeWidth={1.8} />
            <span>{currentPageTitle || 'New page'}</span>
          </div>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void handleGenerate();
              }
            }}
            placeholder="Do anything with AI..."
            aria-label="Ask AI"
          />
          <div className="on-ai-composer-actions">
            <div className="on-ai-composer-left-actions">
              <button type="button" aria-label="Add attachment">
                <Plus className="h-5 w-5" strokeWidth={1.85} />
              </button>
              <button type="button" aria-label="AI options">
                <SlidersHorizontal className="h-5 w-5" strokeWidth={1.85} />
              </button>
            </div>
            <div className="on-ai-composer-right-actions">
              <span>Auto</span>
              <button type="button" aria-label="Voice input">
                <Mic className="h-5 w-5" strokeWidth={1.85} />
              </button>
              <button
                type="button"
                className="on-ai-chat-send"
                aria-label="Send AI prompt"
                onClick={() => void handleGenerate()}
                disabled={!canSend}
              >
                <SendHorizontal className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>,
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
      {panel}
    </>
  );
}

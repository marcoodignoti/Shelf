import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  CheckCircle2,
  Database,
  FileText,
  SendHorizontal,
  Sparkles,
  StopCircle,
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
  cancelAiGeneration,
  formatAiActionPreview,
  generateAiActionPlanStreaming,
  selectAiActions
} from '../lib/ai';
import {
  AiChatMessage,
  aiAppliedMessage,
  aiChatHistory,
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
  const notesPageId = useAppStore((state) => state.currentPageId);
  const workspaceMode = useAppStore((state) => state.workspaceMode);
  // In Studio mode the active note is the current document's linked note page,
  // not currentPageId (which is stale from notes mode). Target that so AI
  // context/append act on the PDF's note, not whatever was last open in notes.
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
  const fetchPages = useAppStore((state) => state.fetchPages);
  const setCurrentPageId = useAppStore((state) => state.setCurrentPageId);
  const updateAiSettingsAction = useAppStore((state) => state.updateAiSettingsAction);
  const showSuccess = useAppStore((state) => state.showSuccess);
  const showError = useAppStore((state) => state.showError);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [plan, setPlan] = useState<AiActionPlan | null>(null);
  // One checkbox per action in the pending plan; user can drop actions before
  // applying. Reset to all-checked whenever a new plan arrives.
  const [selectedActions, setSelectedActions] = useState<boolean[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  // Running count of streamed characters, shown while generating so the user
  // sees live progress instead of a static spinner.
  const [streamChars, setStreamChars] = useState(0);
  const [isApplying, setIsApplying] = useState(false);
  // Monotonic token: a generate run whose id no longer matches has been
  // cancelled (panel closed, new chat, or explicit Stop) and its result is
  // discarded. The backend call itself cannot be aborted, so we drop its result.
  const generationIdRef = useRef(0);

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

  // Closing the panel mid-generation discards the pending run so it does not
  // resolve into a stale "Generating..." state on reopen, and aborts the
  // backend request instead of leaving it to finish in the background.
  useEffect(() => {
    if (isOpen) return;
    generationIdRef.current += 1;
    setIsGenerating(false);
    void cancelAiGeneration();
  }, [isOpen]);

  // Self-heal a stored model that the live OpenRouter list no longer offers
  // (e.g. a deprecated/invalid id), so generation never targets a 404 model.
  useEffect(() => {
    if (!isOpen || !aiSettings || aiModels.length === 0) return;
    if (aiModels.some((model) => model.id === aiSettings.model)) return;
    void updateAiSettingsAction({
      provider: AI_PROVIDER_OPENROUTER,
      model: aiModels[0].id,
      trusted_mode_enabled: aiSettings.trusted_mode_enabled,
    });
  }, [isOpen, aiSettings, aiModels, updateAiSettingsAction]);

  const selectedModel: AiModelId = aiSettings?.model ?? AI_MODELS[0].id;
  const hasApiKey = Boolean(aiSettings?.has_api_key);
  const trustedModeEnabled = Boolean(aiSettings?.trusted_mode_enabled);
  const canSend = useMemo(() => Boolean(trimmedAiPrompt(prompt)) && !isGenerating && !isApplying, [isApplying, isGenerating, prompt]);

  const handleModelChange = (model: AiModelId) => {
    if (model === selectedModel) return;
    void updateAiSettingsAction({
      provider: AI_PROVIDER_OPENROUTER,
      model,
      trusted_mode_enabled: trustedModeEnabled,
    });
  };

  const cancelGeneration = () => {
    generationIdRef.current += 1;
    setIsGenerating(false);
    // Abort the backend request too, not just discard its result.
    void cancelAiGeneration();
  };

  const startNewChat = () => {
    cancelGeneration();
    setMessages([]);
    setPlan(null);
    setSelectedActions([]);
    setPrompt('');
  };

  // `useSelection` filters the plan down to the checked actions (manual Apply);
  // trusted-mode auto-apply passes the full plan with useSelection = false.
  const handleApply = async (targetPlan = plan, useSelection = false) => {
    if (!targetPlan) return;
    const planToApply = useSelection
      ? selectAiActions(
          targetPlan,
          selectedActions.flatMap((checked, index) => (checked ? [index] : []))
        )
      : targetPlan;
    if (planToApply.actions.length === 0) return;
    setIsApplying(true);
    try {
      const result = await applyAiActionPlan(planToApply);
      await fetchPages();
      if (result.primary_page_id) setCurrentPageId(result.primary_page_id);
      setPlan(null);
      setSelectedActions([]);
      const changed = result.created_page_ids.length + result.updated_page_ids.length;
      setMessages((current) => [...current, aiAppliedMessage(changed, nextMessageId())]);
      showSuccess(`AI updated ${changed} item${changed === 1 ? '' : 's'}.`);
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

    const generationId = generationIdRef.current + 1;
    generationIdRef.current = generationId;
    // Snapshot the transcript before this prompt's turns are appended so the
    // backend sees only prior context, not the in-flight request.
    const history = aiChatHistory(messages);
    setStreamChars(0);
    setIsGenerating(true);
    try {
      const nextPlan = await generateAiActionPlanStreaming(
        {
          prompt: cleanPrompt,
          provider: AI_PROVIDER_OPENROUTER,
          model: selectedModel,
          current_page_id: currentPageId,
          history,
        },
        (delta) => {
          if (generationIdRef.current !== generationId) return;
          setStreamChars((count) => count + delta.length);
        }
      );
      if (generationIdRef.current !== generationId) return;
      setMessages((current) => [
        ...current,
        ...aiPlanMessages(cleanPrompt, nextPlan, nextMessageId(), nextMessageId()),
      ]);
      setPlan(nextPlan);
      setSelectedActions(nextPlan.actions.map(() => true));
      if (canTrustedModeAutoApply(nextPlan, trustedModeEnabled)) {
        await handleApply(nextPlan, false);
      }
    } catch (error: unknown) {
      if (generationIdRef.current !== generationId) return;
      showError(error);
    } finally {
      if (generationIdRef.current === generationId) setIsGenerating(false);
    }
  };

  const panel = isOpen ? createPortal(
    <aside ref={panelRef} className="on-ai-chat-shell" aria-label="OpenNotion AI chat">
      <div className="on-ai-chat-header">
        <span className="on-ai-chat-title">New AI chat</span>
        <div className="on-ai-chat-header-actions">
          <button type="button" aria-label="New AI chat" onClick={startNewChat}>
            <Sparkles className="h-4 w-4" strokeWidth={1.9} />
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
                {streamChars > 0 ? `Generating preview... (${streamChars} characters)` : 'Generating preview...'}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {plan && (
        <div className="on-ai-chat-preview-actions">
          <ul className="on-ai-preview-checklist">
            {formatAiActionPreview(plan).map((line, index) => (
              <li key={`${line}-${index}`}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedActions[index] ?? true}
                    disabled={isApplying}
                    onChange={(event) =>
                      setSelectedActions((current) => {
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
            className="on-button-secondary gap-2"
            onClick={() => void handleApply(plan, true)}
            disabled={isApplying || !selectedActions.some(Boolean)}
          >
            <Sparkles className="h-4 w-4" /> {isApplying ? 'Applying...' : `Apply ${selectedActions.filter(Boolean).length} selected`}
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
              <select
                className="on-ai-composer-model"
                aria-label="AI model"
                value={selectedModel}
                onChange={(event) => handleModelChange(event.target.value as AiModelId)}
                disabled={isGenerating || isApplying}
              >
                {!aiModels.some((model) => model.id === selectedModel) && (
                  <option value={selectedModel}>{aiModelLabel(selectedModel, aiModels)}</option>
                )}
                {aiModels.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
            </div>
            <div className="on-ai-composer-right-actions">
              {isGenerating ? (
                <button
                  type="button"
                  className="on-ai-chat-send"
                  aria-label="Stop AI generation"
                  onClick={cancelGeneration}
                >
                  <StopCircle className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  className="on-ai-chat-send"
                  aria-label="Send AI prompt"
                  onClick={() => void handleGenerate()}
                  disabled={!canSend}
                >
                  <SendHorizontal className="h-4 w-4" />
                </button>
              )}
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

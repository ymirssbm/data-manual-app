import { useEffect, useRef, useState } from 'react';
import { isQuestion, surveyModels, type StudySpec, type ValidationResult } from '../../core';
import { CLAUDE_MODELS, type AiConfig, type ChatTurn } from '../../ai/providers';
import { replyProse, runStudyAi } from '../../ai/studyAi';
import type { LoadedSource } from './DataPull';
import { Box, Field, Icon, PageTitle } from '../ui';
import { download, safeFileName } from '../util';

interface Props {
  spec: StudySpec | null;
  onLoaded(source: LoadedSource, result: ValidationResult): void;
  notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  result?: ValidationResult | null;
  repairs?: number;
  error?: boolean;
}

const CONFIG_KEY = 'data-manual:ai-config';
const KEY_KEY = 'data-manual:ai-key';
const DEFAULT_CONFIG: AiConfig = { provider: 'anthropic', apiKey: '', model: 'claude-opus-5-5', effort: 'medium', baseUrl: '', useRelay: true };

const EXAMPLE_GENERATE =
  'Generate a study looking at the longitudinal process of people in recovery using 30 days of EMA with a morning and an evening survey. Include a baseline survey with basic demographics. For the EMA, ask about social support, cravings, and positive and negative affect, and only ask about craving triggers when cravings are above 50.';
const EXAMPLE_MODIFY =
  'Add a question to the evening survey asking whether the participant attended a recovery meeting today; if yes, ask whether it was in person or online, and how helpful it was (0-100 slider).';
const HELP =
  'Describe a study to create one, or ask for changes to the loaded study ("add a sleep block to the morning survey", "make the craving follow-up only appear above 50"). The assistant sees your study and the spec schema, returns a complete updated spec, and the app validates it (and asks the model to fix any errors) before you choose to use it. Response data in the loaded study is never sent.';

function loadConfig(): AiConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') as Partial<AiConfig>;
    const key = localStorage.getItem(KEY_KEY) ?? sessionStorage.getItem(KEY_KEY) ?? '';
    return { ...DEFAULT_CONFIG, ...saved, apiKey: key };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function AiPage({ spec, onLoaded, notify }: Props) {
  const [config, setConfig] = useState<AiConfig>(loadConfig);
  const [rememberKey, setRememberKey] = useState(() => {
    try {
      return !!localStorage.getItem(KEY_KEY);
    } catch {
      return false;
    }
  });
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', text: "Hi! I'm your AI Study Assistant. Add your API key in AI Settings, then describe a study to create or the changes you want to the loaded one." },
  ]);
  const [input, setInput] = useState('');
  // Settings start open until a key is entered, then stay out of the way.
  const [settingsOpen, setSettingsOpen] = useState(() => !loadConfig().apiKey);
  const [busy, setBusy] = useState<string | null>(null);
  const [streaming, setStreaming] = useState('');
  const abort = useRef<AbortController | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const { apiKey: _k, ...rest } = config;
      void _k;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(rest));
      if (rememberKey) {
        localStorage.setItem(KEY_KEY, config.apiKey);
        sessionStorage.removeItem(KEY_KEY);
      } else {
        localStorage.removeItem(KEY_KEY);
        sessionStorage.setItem(KEY_KEY, config.apiKey);
      }
    } catch {
      // storage unavailable
    }
  }, [config, rememberKey]);
  // Scroll only the chat box (never the page), and return nothing from the effect.
  useEffect(() => {
    const box = chatEnd.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, streaming]);

  const set = <K extends keyof AiConfig>(k: K, v: AiConfig[K]) => setConfig((c) => ({ ...c, [k]: v }));

  const run = async (prompt: string, base: StudySpec | null, useHistory: boolean) => {
    if (!prompt.trim() || busy) return;
    const history: ChatTurn[] = useHistory
      ? messages.slice(1).filter((m) => !m.error).map((m) => ({ role: m.role, content: m.role === 'assistant' ? replyProse(m.text) : m.text }))
      : [];
    setMessages((m) => [...m, { role: 'user', text: prompt }]);
    abort.current = new AbortController();
    setBusy('Thinking…');
    setStreaming('');
    try {
      const out = await runStudyAi({
        config,
        history,
        prompt,
        base,
        signal: abort.current.signal,
        onStatus: setBusy,
        onText: (t) => setStreaming(replyProse(t)),
      });
      setMessages((m) => [...m, { role: 'assistant', text: out.message, result: out.result, repairs: out.repairs }]);
    } catch (e) {
      const err = e as Error;
      if (err.name !== 'AbortError' && !/abort/i.test(err.message)) {
        setMessages((m) => [...m, { role: 'assistant', text: err.message, error: true }]);
        notify(err.message, 'error', 8000);
      }
    } finally {
      setBusy(null);
      setStreaming('');
      abort.current = null;
    }
  };

  const useStudy = (result: ValidationResult, prompt: string) => {
    onLoaded({ fileName: 'AI Study Generator', translatorLabel: `AI (${config.model})`, notes: [`Prompt: ${prompt}`] }, result);
  };

  const lastPromptBefore = (i: number) => [...messages.slice(0, i)].reverse().find((m) => m.role === 'user')?.text ?? '';

  const modelLabel =
    config.provider === 'anthropic'
      ? (CLAUDE_MODELS.find((m) => m.id === config.model)?.label.replace(/ \(.*\)$/, '') ?? config.model)
      : config.model || 'No model set';
  const send = () => {
    const p = input;
    setInput('');
    void run(p, spec, true);
  };

  return (
    <>
      <PageTitle
        actions={
          messages.length > 1 && (
            <button className="dm-btn dm-btn-secondary" onClick={() => setMessages((m) => m.slice(0, 1))} disabled={!!busy}>
              New chat
            </button>
          )
        }
      >
        AI Study Assistant
      </PageTitle>

      <section className="dm-box">
        <button className="dm-box-header dm-box-header-btn" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen}>
          <h3 className="dm-box-title">
            <span className="dm-caret-light">{settingsOpen ? '▾' : '▸'}</span> AI Settings
          </h3>
          <span className="dm-settings-summary">
            {modelLabel} · {config.apiKey ? 'key added' : 'no key yet'}
          </span>
        </button>
        {settingsOpen && (
          <div className="dm-box-body">
            <div className="dm-settings-grid">
              <Field label="Provider">
                <select
                  className="dm-input"
                  value={config.provider}
                  onChange={(e) => {
                    const provider = e.target.value as AiConfig['provider'];
                    setConfig((c) => ({ ...c, provider, model: provider === 'anthropic' ? 'claude-opus-5-5' : c.provider === 'anthropic' ? '' : c.model }));
                  }}
                >
                  <option value="anthropic">Claude (Anthropic API)</option>
                  <option value="openai">OpenAI-compatible (Azure AI Foundry, OpenAI, local)</option>
                </select>
              </Field>
              {config.provider === 'anthropic' ? (
                <>
                  <Field label="Model">
                    <select className="dm-input" value={CLAUDE_MODELS.some((m) => m.id === config.model) ? config.model : ''} onChange={(e) => set('model', e.target.value)}>
                      {CLAUDE_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Effort">
                    <select className="dm-input" value={config.effort} onChange={(e) => set('effort', e.target.value as AiConfig['effort'])}>
                      <option value="low">Low (fastest)</option>
                      <option value="medium">Medium</option>
                      <option value="high">High (best for big studies)</option>
                    </select>
                  </Field>
                </>
              ) : (
                <>
                  <Field label="AI URL">
                    <input className="dm-input" value={config.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://…/v1" />
                  </Field>
                  <Field label="Model">
                    <input className="dm-input" value={config.model} onChange={(e) => set('model', e.target.value)} placeholder="Model or deployment name" />
                  </Field>
                </>
              )}
              <Field label="AI API Token">
                <input className="dm-input" type="password" value={config.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder="Enter API key" autoComplete="off" />
              </Field>
            </div>
            <div className="dm-inline dm-inline-tight dm-settings-foot">
              <label className="dm-check">
                <input type="checkbox" checked={rememberKey} onChange={(e) => setRememberKey(e.target.checked)} /> Remember key on this computer
              </label>
              {config.provider === 'openai' && (
                <label className="dm-check">
                  <input type="checkbox" checked={config.useRelay} onChange={(e) => set('useRelay', e.target.checked)} /> Relay through this app
                </label>
              )}
              <span className="dm-hint dm-push-right">
                <Icon name="lock" size={13} /> Your key goes only to the AI provider. Response data is never sent.
              </span>
            </div>
          </div>
        )}
      </section>

      <Box title="Chat" tools={<span className="dm-chat-context">{spec ? `Working on: ${spec['Study.Metadata']['Study.Name']}` : 'No study loaded: a new one will be created'}</span>}>
        <div className="dm-chat">
          {messages.map((m, i) => (
            <div key={i} className={`dm-msg dm-msg-${m.role} ${m.error ? 'is-error' : ''}`}>
              <div className="dm-msg-text">{m.text}</div>
              {m.result && <ResultCard result={m.result} repairs={m.repairs ?? 0} onUse={() => useStudy(m.result!, lastPromptBefore(i))} />}
            </div>
          ))}
          {busy && (
            <div className="dm-msg dm-msg-assistant is-pending">
              {streaming && <div className="dm-msg-text">{streaming}</div>}
              <div className="dm-msg-status">
                <span className="dm-spinner" /> {busy}
                <button className="dm-link-btn" onClick={() => abort.current?.abort()}>
                  Stop
                </button>
              </div>
            </div>
          )}
          <div ref={chatEnd} />
        </div>
        <form
          className="dm-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            rows={2}
            value={input}
            placeholder={spec ? 'Describe a change to this study, or a new study…' : 'Describe the study you want to create…'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="dm-btn dm-btn-primary" type="submit" disabled={!!busy || !input.trim()}>
            Send
          </button>
        </form>
        <div className="dm-chips">
          <button onClick={() => setInput(EXAMPLE_GENERATE)}>Example: generate a study</button>
          <button onClick={() => setInput(EXAMPLE_MODIFY)} disabled={!spec}>
            Example: modify this study
          </button>
          <button onClick={() => setMessages((m) => [...m, { role: 'assistant', text: HELP }])}>What can it do?</button>
          <span className="dm-hint dm-push-right">Enter to send · Shift+Enter for a new line</span>
        </div>
      </Box>
    </>
  );
}

function ResultCard({ result, repairs, onUse }: { result: ValidationResult; repairs: number; onUse(): void }) {
  const spec = result.spec;
  const errors = result.issues.filter((i) => i.severity === 'error');
  if (!spec) {
    return (
      <div className="dm-result is-bad">
        <strong>The proposed spec still has {errors.length} problem(s) after {repairs} repair pass(es).</strong>
        <ul>
          {errors.slice(0, 6).map((e, i) => (
            <li key={i}>
              <code>{e.path}</code> {e.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const models = surveyModels(spec);
  const nq = models.reduce((a, m) => a + m.items.filter(isQuestion).length, 0);
  return (
    <div className={`dm-result ${result.valid ? '' : 'is-bad'}`}>
      <div>
        <strong>{spec['Study.Metadata']['Study.Name']}</strong>
        <div className="dm-hint">
          {models.length} survey(s) · {nq} questions · {models.reduce((a, m) => a + m.branches.length, 0)} skip-logic branches · {spec.schedules.length} schedule(s)
          {repairs ? ` · fixed after ${repairs} repair pass(es)` : ''}
          {result.valid ? ' · valid' : ` · ${errors.length} problem(s)`}
        </div>
      </div>
      <div className="dm-inline dm-inline-tight">
        <button className="dm-btn dm-btn-primary dm-btn-sm" onClick={onUse} disabled={!result.valid}>
          Use this study
        </button>
        <button
          className="dm-btn dm-btn-secondary dm-btn-sm"
          onClick={() => download(`${safeFileName(spec['Study.Metadata']['Study.Name'])}.study.json`, JSON.stringify(spec, null, 2), 'application/json')}
        >
          Download JSON
        </button>
      </div>
    </div>
  );
}

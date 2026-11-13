// Model calls for the AI Study Generator.
// - Claude: the official Anthropic TypeScript SDK, called from the browser
//   (dangerouslyAllowBrowser: the key is the user's own and stays on their machine),
//   streamed so long specs don't hit request timeouts.
// - OpenAI-compatible: for other providers (Azure AI Foundry, OpenAI, local servers),
//   a plain chat-completions request, optionally relayed by the app's local server
//   because most of those endpoints don't allow browser (CORS) calls.
import Anthropic from '@anthropic-ai/sdk';
import { hostRelay, hostUrl } from '../connectors/host';

/** fetch for the Anthropic SDK inside R/Shiny: the R session relays the call and fills in the saved key. */
function relayAnthropic(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-target-url', url);
  headers.set('x-data-manual', '1');
  return fetch(hostUrl('/proxy/http'), { method: init.method ?? 'POST', headers, body: init.body, signal: init.signal });
}

export type AiProvider = 'anthropic' | 'openai';

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  /** Claude only: depth of reasoning. Claude Opus 5.5 defaults to medium. */
  effort: 'low' | 'medium' | 'high';
  /** OpenAI-compatible only: base URL ending in /v1 (or the provider's equivalent). */
  baseUrl: string;
  /** OpenAI-compatible only: route through the local server to avoid CORS. */
  useRelay: boolean;
}

/** A document the researcher attached (IRB protocol, consent form...) for the model to read. */
export interface ChatDocument {
  name: string;
  /** PDFs: base64 without the data: prefix. Sent as a PDF to Claude; other providers can't read it. */
  pdfBase64?: string;
  /** Text and Word documents: their text. */
  text?: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Documents to read with this (user) turn; they go before its text. */
  documents?: ChatDocument[];
}

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recommended)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest)' },
];

// Server-side refusal fallback ("default" picks the fallback model by refusal category).
// Not available for Haiku; other model IDs are sent without it.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1']);

export class AiError extends Error {}

export async function callModel(
  config: AiConfig,
  system: string,
  turns: ChatTurn[],
  { onText, signal }: { onText?(soFar: string): void; signal?: AbortSignal } = {},
): Promise<string> {
  if (!config.apiKey.trim()) throw new AiError('Enter an API key first.');
  return config.provider === 'anthropic' ? callClaude(config, system, turns, onText, signal) : callOpenAiCompatible(config, system, turns, signal);
}

async function callClaude(config: AiConfig, system: string, turns: ChatTurn[], onText?: (s: string) => void, signal?: AbortSignal): Promise<string> {
  // A saved key ("vault:<id>") goes through the app's local server, which swaps in the secret.
  const saved = config.apiKey.trim().startsWith('vault:');
  const client = new Anthropic({
    apiKey: config.apiKey.trim(),
    dangerouslyAllowBrowser: true,
    ...(saved
      ? hostRelay()
        ? // Inside R/Shiny: every call goes through the R session's relay with its real URL.
          { fetch: (url: RequestInfo | URL, init?: RequestInit) => relayAnthropic(String(url instanceof Request ? url.url : url), init) }
        : { baseURL: `${window.location.origin}/proxy/anthropic`, defaultHeaders: { 'x-data-manual': '1' } }
      : {}),
  });
  const model = config.model.trim() || 'claude-opus-5-5';
  const withFallback = FALLBACK_MODELS.has(model);
  try {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 64000,
        // The schema-heavy system prompt is identical on every call, so cache it.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: turns.map((t): Anthropic.Beta.BetaMessageParam => (t.documents?.length ? { role: t.role, content: [...claudeDocuments(t.documents), { type: 'text', text: t.content }] } : { role: t.role, content: t.content })),
        output_config: { effort: config.effort },
        ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );
    let text = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text;
        onText?.(text);
      }
    }
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') {
      throw new AiError('The model declined this request. Try rephrasing it.');
    }
    const out = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (message.stop_reason === 'max_tokens') throw new AiError('The response was cut off before the spec was complete. Try a smaller change or study.');
    return out;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('Claude rejected the API key.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new AiError('This API key cannot use that model.');
    if (e instanceof Anthropic.NotFoundError) throw new AiError(`Model "${model}" was not found.`);
    if (e instanceof Anthropic.RateLimitError) throw new AiError('Rate limited by the API. Wait a moment and try again.');
    if (e instanceof Anthropic.APIUserAbortError) throw e;
    if (e instanceof Anthropic.APIError) throw new AiError(`Claude API error: ${e.message}`);
    throw e;
  }
}

/**
 * Attached documents as Claude document blocks: PDFs whole (Claude reads their text and pages),
 * text as plain-text documents. The last one carries a cache breakpoint, since validation-repair
 * rounds resend the same documents.
 */
function claudeDocuments(docs: ChatDocument[]): Anthropic.Beta.BetaRequestDocumentBlock[] {
  const blocks = docs.flatMap((d): Anthropic.Beta.BetaRequestDocumentBlock[] =>
    d.pdfBase64
      ? [{ type: 'document', title: d.name, source: { type: 'base64', media_type: 'application/pdf', data: d.pdfBase64 } }]
      : d.text?.trim()
        ? [{ type: 'document', title: d.name, source: { type: 'text', media_type: 'text/plain', data: d.text } }]
        : [],
  );
  if (blocks.length) blocks[blocks.length - 1]!.cache_control = { type: 'ephemeral' };
  return blocks;
}

/** Other providers get text documents inline; PDFs are named but not sent. */
function textDocuments(t: ChatTurn): string {
  if (!t.documents?.length) return t.content;
  const parts = t.documents.map((d) =>
    d.text?.trim() ? `<document name="${d.name}">\n${d.text}\n</document>` : `(Attached PDF "${d.name}" was not sent: this provider only receives text. Use Claude to include PDFs.)`,
  );
  return `${parts.join('\n\n')}\n\n${t.content}`;
}

async function callOpenAiCompatible(config: AiConfig, system: string, turns: ChatTurn[], signal?: AbortSignal): Promise<string> {
  const base = config.baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new AiError('Enter the provider\'s base URL (for example https://api.openai.com/v1).');
  const target = `${base}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey.trim()}`,
    'api-key': config.apiKey.trim(), // Azure-style auth; ignored elsewhere
  };
  // Saved keys only work through the local server, which swaps in the secret.
  const relay = config.useRelay || config.apiKey.trim().startsWith('vault:');
  const res = await fetch(relay ? hostUrl('/proxy/http') : target, {
    method: 'POST',
    signal,
    headers: relay ? { ...headers, 'x-target-url': target, 'x-data-manual': '1' } : headers,
    body: JSON.stringify({ model: config.model.trim(), messages: [{ role: 'system', content: system }, ...turns.map((t) => ({ role: t.role, content: textDocuments(t) }))] }),
  }).catch((e: Error) => {
    if (e.name === 'AbortError') throw e;
    throw new AiError(relay ? 'Could not reach the local relay. Is the app running with "npm run dev"?' : 'The request was blocked. Turn on "Relay through this app" and try again.');
  });
  const body = await res.text();
  if (!res.ok) {
    let detail = body.slice(0, 300);
    try {
      detail = JSON.parse(body)?.error?.message ?? detail;
    } catch {
      // keep raw text
    }
    throw new AiError(`Provider error (${res.status}): ${detail}`);
  }
  try {
    const json = JSON.parse(body);
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('no content');
    return content;
  } catch {
    throw new AiError('The provider returned an unexpected response.');
  }
}

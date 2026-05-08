import type { ChatCompletionChunk, ChatMessage, StreamDelta, ToolDefinition, ToolCall, Usage } from "./types.js";

export interface ClientOptions {
  baseURL: string;
  apiKey?: string;
  model?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
}

export class OpenAICompatClient {
  constructor(private readonly options: ClientOptions) {}

  async *streamChat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamDelta> {
    const body = {
      model: this.options.model || undefined,
      messages: req.messages,
      tools: req.tools && req.tools.length > 0 ? req.tools : undefined,
      temperature: req.temperature,
      stream: true
    };

    const response = await fetch(`${this.options.baseURL.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new Error(`chat completion failed (${response.status}): ${text || response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const delta = parseFrame(frame);
        if (delta) yield delta;
        boundary = buffer.indexOf("\n\n");
      }
    }
  }
}

function parseFrame(frame: string): StreamDelta | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");

  if (!data || data === "[DONE]") return null;

  const chunk = JSON.parse(data) as ChatCompletionChunk;
  const choice = chunk.choices?.[0];
  const delta = choice?.delta ?? {};
  return {
    content: delta.content ?? "",
    reasoning: delta.reasoning_content ?? "",
    toolCalls: normalizeToolCalls(delta.tool_calls ?? []),
    usage: normalizeUsage(chunk.usage),
    finishReason: choice?.finish_reason ?? undefined
  };
}

function normalizeUsage(usage?: Usage): Usage | undefined {
  if (!usage || usage.total_tokens === undefined) return usage;
  return usage;
}

function normalizeToolCalls(calls: ToolCall[]): ToolCall[] {
  return calls.map((call, index) => ({
    index: call.index ?? index,
    id: call.id ?? "",
    type: "function",
    function: {
      name: call.function?.name ?? "",
      arguments: call.function?.arguments ?? ""
    }
  }));
}

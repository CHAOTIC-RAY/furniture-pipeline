import { Injectable } from '@angular/core';

export interface OllamaChatResponse {
  message?: { content?: string };
}

function resolveChatUrl(baseUrl: string): string {
  const root = (baseUrl || '/api/ollama').trim().replace(/\/$/, '');
  if (/^https?:\/\//i.test(root)) {
    return `${root}/api/chat`.replace(/([^:]\/)\/+/g, '$1');
  }
  const path = `${root.startsWith('/') ? '' : '/'}${root}/api/chat`.replace(/\/{2,}/g, '/');
  if (typeof window === 'undefined' || !window.location?.origin) {
    return path;
  }
  return new URL(path, window.location.origin).href;
}

@Injectable({ providedIn: 'root' })
export class OllamaService {
  /**
   * Vision naming: POST {base}/api/chat with Ollama chat API (non-streaming).
   * baseUrl example: "/api/ollama" (dev proxy) or "https://your-tunnel.example.com".
   */
  async nameMainObject(
    base64Image: string,
    baseUrl: string,
    model: string,
  ): Promise<string | null> {
    const url = resolveChatUrl(baseUrl);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: 'user',
            content:
              'What is the main physical object in this image? Reply with only a short object name (1 to 3 words). No punctuation or explanation.',
            images: [base64Image],
          },
        ],
      }),
    });
    if (!res.ok) {
      return null;
    }
    const json = (await res.json()) as OllamaChatResponse;
    const raw = json?.message?.content?.trim();
    if (!raw) {
      return null;
    }
    const line = raw.split('\n')[0]?.trim();
    return line || null;
  }
}

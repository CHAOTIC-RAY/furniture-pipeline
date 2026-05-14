import { Injectable } from '@angular/core';

export interface OllamaChatResponse {
  message?: { content?: string };
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
    const root = baseUrl.replace(/\/$/, '');
    const url = `${root}/api/chat`;
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

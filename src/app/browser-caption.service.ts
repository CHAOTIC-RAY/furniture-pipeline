import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Browser-only ESM build (avoids bundling sharp/onnxruntime-node into Angular SSR). */
const TRANSFORMERS_MODULE =
  'https://esm.sh/@xenova/transformers@2.17.2?bundle&target=es2022' as const;

const CAPTION_MODEL = 'Xenova/vit-gpt2-image-captioning';

type CaptionerFn = (
  input: string,
  options?: Record<string, unknown>,
) => Promise<{ generated_text: string }[]>;

type PipelineFn = (
  task: 'image-to-text',
  model: string,
  opts?: { progress_callback?: (info: { status?: string; file?: string; progress?: number }) => void },
) => Promise<CaptionerFn>;

@Injectable({ providedIn: 'root' })
export class BrowserCaptionService {
  private readonly platformId = inject(PLATFORM_ID);
  private loadPromise: Promise<CaptionerFn> | null = null;

  /**
   * Returns a short object-style label (up to 3 words) from an image, fully in-browser.
   * Loads Transformers.js from a CDN on first use (requires network once; then cached by the browser).
   */
  async captionFromBase64(
    base64: string,
    mimeType: string,
    onProgress?: (msg: string) => void,
  ): Promise<string | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    const captioner = await this.getCaptioner(onProgress);
    const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${base64}`;
    const out = await captioner(dataUrl);
    const raw = out?.[0]?.generated_text?.trim();
    if (!raw) {
      return null;
    }
    return this.toShortLabel(raw);
  }

  private toShortLabel(text: string): string {
    const cleaned = text.replace(/[^a-zA-Z0-9\s-]/g, ' ').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    const slice = parts.slice(0, 3).join(' ');
    return slice || 'object';
  }

  private async getCaptioner(onProgress?: (msg: string) => void): Promise<CaptionerFn> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const mod = (await import(/* webpackIgnore: true */ TRANSFORMERS_MODULE)) as {
          pipeline: PipelineFn;
        };
        const pipe = await mod.pipeline('image-to-text', CAPTION_MODEL, {
          progress_callback: (info: { status?: string; file?: string; progress?: number }) => {
            const bits = [
              info.status,
              info.file,
              info.progress != null ? `${Math.round(info.progress * 100)}%` : '',
            ]
              .filter(Boolean)
              .join(' ');
            if (bits) {
              onProgress?.(`Browser model: ${bits}`);
            }
          },
        });
        return pipe as CaptionerFn;
      })();
    }
    try {
      return await this.loadPromise;
    } catch {
      this.loadPromise = null;
      throw new Error('Failed to load in-browser caption model');
    }
  }
}

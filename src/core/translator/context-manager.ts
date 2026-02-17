import type { TranslationContext, GlossaryEntry, UserCorrection } from '@/types';

export class ContextManager {
  private window: string[] = [];
  private maxSize: number;
  private title?: string;
  private channel?: string;
  private glossaryEntries: GlossaryEntry[] = [];
  private userCorrections: UserCorrection[] = [];

  constructor(maxSize: number = 3) {
    this.maxSize = maxSize;
  }

  push(sentence: string): void {
    this.window.push(sentence);
    if (this.window.length > this.maxSize) {
      this.window.shift();
    }
  }

  getContext(): TranslationContext {
    return {
      previousSentences: [...this.window],
      title: this.title,
      channel: this.channel,
      glossaryEntries: this.glossaryEntries,
      userCorrections: this.userCorrections,
    };
  }

  setMetadata(meta: { title?: string; channel?: string }): void {
    if (meta.title !== undefined) this.title = meta.title;
    if (meta.channel !== undefined) this.channel = meta.channel;
  }

  setGlossary(entries: GlossaryEntry[]): void {
    this.glossaryEntries = entries;
  }

  setUserCorrections(corrections: UserCorrection[]): void {
    this.userCorrections = corrections;
  }

  setMaxSize(size: number): void {
    this.maxSize = size;
    while (this.window.length > this.maxSize) {
      this.window.shift();
    }
  }

  clear(): void {
    this.window = [];
    this.title = undefined;
    this.channel = undefined;
  }
}

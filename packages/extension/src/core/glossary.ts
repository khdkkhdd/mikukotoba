import type { GlossaryEntry } from '@/types';

const GLOSSARY_STORAGE_KEY = 'jp_glossary_custom';

// 내장 용어집 없음 — 사용자 커스텀 용어집만 사용
const BUILT_IN_GLOSSARY: GlossaryEntry[] = [];

export class GlossaryManager {
  private customEntries: GlossaryEntry[] = [];
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = await chrome.storage.local.get(GLOSSARY_STORAGE_KEY);
      this.customEntries = data[GLOSSARY_STORAGE_KEY] || [];
      this.loaded = true;
    } catch {
      this.customEntries = [];
      this.loaded = true;
    }
  }

  getBuiltIn(): GlossaryEntry[] {
    return BUILT_IN_GLOSSARY;
  }

  getCustom(): GlossaryEntry[] {
    return this.customEntries;
  }

  getAll(): GlossaryEntry[] {
    return [...BUILT_IN_GLOSSARY, ...this.customEntries];
  }

  async addCustom(entry: GlossaryEntry): Promise<void> {
    await this.load();
    this.customEntries.push(entry);
    await this.save();
  }

  async removeCustom(index: number): Promise<void> {
    await this.load();
    this.customEntries.splice(index, 1);
    await this.save();
  }

  async updateCustom(index: number, entry: GlossaryEntry): Promise<void> {
    await this.load();
    this.customEntries[index] = entry;
    await this.save();
  }

  async importCSV(csv: string): Promise<number> {
    await this.load();
    const lines = csv.split('\n').filter((l) => l.trim());
    let imported = 0;

    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
      if (parts.length >= 2) {
        this.customEntries.push({
          japanese: parts[0],
          korean: parts[1],
          note: parts[2] || undefined,
        });
        imported++;
      }
    }

    await this.save();
    return imported;
  }

  exportCSV(): string {
    return this.customEntries
      .map((e) => `"${e.japanese}","${e.korean}","${e.note || ''}"`)
      .join('\n');
  }

  /**
   * Apply glossary to a translated text.
   * Checks if the original Japanese contains glossary terms and
   * ensures the translation uses the preferred Korean term.
   */
  apply(translation: string, original: string): string {
    const allEntries = this.getAll();
    let result = translation;
    const annotations: string[] = [];

    for (const entry of allEntries) {
      if (!original.includes(entry.japanese)) continue;

      // Check if the translation already contains the preferred Korean term
      if (result.includes(entry.korean)) continue;

      // Term is in the original but missing from translation — add annotation
      const annotation = entry.note
        ? `${entry.japanese}: ${entry.korean} (${entry.note})`
        : `${entry.japanese}: ${entry.korean}`;
      annotations.push(annotation);
    }

    if (annotations.length > 0) {
      result = `${result} (${annotations.join(', ')})`;
    }

    return result;
  }

  /**
   * Get relevant glossary entries for a given text.
   */
  getRelevantEntries(text: string): GlossaryEntry[] {
    const allEntries = this.getAll();
    return allEntries.filter((e) => text.includes(e.japanese));
  }

  private async save(): Promise<void> {
    await chrome.storage.local.set({ [GLOSSARY_STORAGE_KEY]: this.customEntries });
  }
}

export const glossaryManager = new GlossaryManager();

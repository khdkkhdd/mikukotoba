import type { GlossaryEntry } from '@/types';

const GLOSSARY_STORAGE_KEY = 'jp_glossary_custom';

// 기본 내장 용어집
const BUILT_IN_GLOSSARY: GlossaryEntry[] = [
  // 인사말
  { japanese: 'おはようございます', korean: '안녕하세요 (아침)', note: '아침 인사' },
  { japanese: 'こんにちは', korean: '안녕하세요 (낮)', note: '낮 인사' },
  { japanese: 'こんばんは', korean: '안녕하세요 (저녁)', note: '저녁 인사' },
  { japanese: 'お疲れ様です', korean: '수고하셨습니다', note: '업무/활동 후 인사' },
  { japanese: 'お疲れ様でした', korean: '수고하셨습니다', note: '끝난 후 인사' },
  { japanese: 'いただきます', korean: '잘 먹겠습니다', note: '식사 전' },
  { japanese: 'ごちそうさまでした', korean: '잘 먹었습니다', note: '식사 후' },
  { japanese: 'よろしくお願いします', korean: '잘 부탁드립니다' },
  { japanese: 'お邪魔します', korean: '실례합니다', note: '남의 집 방문 시' },
  { japanese: 'ただいま', korean: '다녀왔습니다' },
  { japanese: 'おかえりなさい', korean: '어서 와요' },
  { japanese: 'いってきます', korean: '다녀오겠습니다' },
  { japanese: 'いってらっしゃい', korean: '다녀오세요' },

  // 문화 용어
  { japanese: '先輩', korean: '선배' },
  { japanese: '後輩', korean: '후배' },
  { japanese: 'お花見', korean: '꽃놀이 (하나미)', note: '벚꽃 구경' },
  { japanese: '花火', korean: '불꽃놀이 (하나비)' },
  { japanese: 'お祭り', korean: '축제 (마쯔리)' },
  { japanese: '居酒屋', korean: '이자카야 (일본식 선술집)' },
  { japanese: 'コンビニ', korean: '편의점' },
  { japanese: 'お弁当', korean: '도시락 (오벤토)' },

  // 자주 오역되는 표현
  { japanese: 'やばい', korean: '대박/위험한', note: '상황에 따라 긍정/부정' },
  { japanese: 'マジ', korean: '진짜/정말' },
  { japanese: 'ヤバい', korean: '대박/위험한' },
  { japanese: 'ウケる', korean: '웃기다/재밌다' },
  { japanese: '微妙', korean: '애매한/미묘한', note: '부정적 뉘앙스가 강함' },
  { japanese: 'かわいい', korean: '귀여운' },
  { japanese: '推し', korean: '최애 (추천하는 사람)', note: '좋아하는 아이돌/캐릭터' },
  { japanese: '草', korean: 'ㅋㅋㅋ', note: '인터넷 용어, 웃음' },
  { japanese: 'www', korean: 'ㅋㅋㅋ', note: '인터넷 용어, 웃음' },
];

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

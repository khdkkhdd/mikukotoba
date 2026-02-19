import { getSentenceAtPosition } from '@/content/shared/dom-utils';

/**
 * Captures selection info on contextmenu event (before browser clears it).
 * Kept in a separate module to avoid pulling vocab-add-handler into the main bundle.
 */
let lastSelectionInfo: { text: string; sentence: string } | null = null;

export function captureSelectionOnContextMenu(): void {
  document.addEventListener('contextmenu', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      lastSelectionInfo = null;
      return;
    }

    const text = sel.toString().trim();
    if (!text) {
      lastSelectionInfo = null;
      return;
    }

    const range = sel.getRangeAt(0);
    const container = range.startContainer;
    const fullText = container.textContent || '';
    const sentence = getSentenceAtPosition(fullText, range.startOffset);

    lastSelectionInfo = { text, sentence };
  });
}

export function getLastSelectionInfo(): { text: string; sentence: string } | null {
  return lastSelectionInfo;
}

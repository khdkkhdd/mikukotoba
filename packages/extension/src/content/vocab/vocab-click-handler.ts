import type { MorphemeToken } from '@/types';
import type { VocabAutoFillResult } from './vocab-add-handler';

/**
 * Handle word click from ruby/inline renderers → show vocab modal.
 *
 * This module lazily imports vocab-modal and vocab-add-handler to avoid
 * pulling them into the initial content script bundle.
 */
export async function handleWordClick(
  surface: string,
  reading: string,
  sentence: string,
): Promise<void> {
  // Dynamic imports to keep initial bundle small
  const [{ showVocabModal, updateVocabModal, removeVocabModal }, { autoFillVocab, buildVocabEntry }] =
    await Promise.all([
      import('./vocab-modal'),
      import('./vocab-add-handler'),
    ]);

  // Show loading modal immediately
  showVocabModal(null, () => {});

  try {
    // Import translator lazily
    const { translator } = await import('@/core/translator');

    // Wait for translator to be ready (init may already be done)
    if (!translator.getAnalyzer()) {
      removeVocabModal();
      return;
    }

    const autoFill = await autoFillVocab(surface, translator);

    // Override example sentence with the clicked context if available
    if (sentence) {
      autoFill.exampleSentence = sentence;
    }

    updateVocabModal(autoFill, async (entry) => {
      await chrome.runtime.sendMessage({ type: 'VOCAB_SAVE', payload: entry });
    });
  } catch (e) {
    console.error('[JP Helper] Vocab click handler failed:', e);
    removeVocabModal();
  }
}

import type { WordClickCallback } from '@/content/shared/renderers/ruby-injector';

/**
 * Shared word-click callback that lazily imports the vocab click handler.
 * All renderers use this single callback instance.
 */
export const onWordClick: WordClickCallback = (surface, reading, sentence) => {
  import('./vocab-click-handler').then(({ handleWordClick }) => {
    handleWordClick(surface, reading, sentence);
  });
};

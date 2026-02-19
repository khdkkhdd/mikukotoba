import type { ProcessedTracker } from '@/content/shared/processed-tracker';
import { walkTextNodes, isJapanese, japaneseRatio } from '@/content/shared/dom-utils';

export interface DetectedBlock {
  element: HTMLElement;
  textNodes: Text[];
  text: string;
}

type DetectionCallback = (blocks: DetectedBlock[]) => void;

/**
 * Detects Japanese text in web pages.
 *
 * Handles dynamic SPA content using three complementary strategies:
 *   A. MutationObserver (childList) — new DOM nodes
 *   B. MutationObserver (characterData) — text filled after node insertion
 *   C. IntersectionObserver — viewport-based catch for missed elements
 *
 * Cost guard: ProcessedTracker prevents duplicate callbacks
 * (and therefore duplicate API calls).
 */
export class TextDetector {
  private mutationObserver: MutationObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private onDetected: DetectionCallback;
  private tracker: ProcessedTracker;

  // Mutation queue: accumulate instead of drop
  private pendingNodes = new Set<HTMLElement>();
  private pendingCharDataNodes = new Set<HTMLElement>();
  private scheduled = false;

  constructor(onDetected: DetectionCallback, tracker: ProcessedTracker) {
    this.onDetected = onDetected;
    this.tracker = tracker;
  }

  start(): void {
    // C: IntersectionObserver — processes deferred (off-screen) elements on viewport entry
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          this.intersectionObserver?.unobserve(el);
          if (!this.tracker.isProcessed(el)) {
            this.scan(el);
          }
        }
      },
      { rootMargin: '200px' }
    );

    // A + B: MutationObserver
    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
              if (
                node.hasAttribute('data-jp-translation') ||
                node.hasAttribute('data-jp-processed')
              ) continue;
              this.pendingNodes.add(node);
            } else if (node.nodeType === Node.TEXT_NODE) {
              const parent = this.findBlockParent(node);
              if (parent) {
                this.pendingCharDataNodes.add(parent);
              }
            }
          }
        }

        if (mutation.type === 'characterData') {
          const textNode = mutation.target;
          if (textNode.nodeType !== Node.TEXT_NODE) continue;
          const parent = this.findBlockParent(textNode);
          if (parent) {
            this.pendingCharDataNodes.add(parent);
          }
        }
      }

      this.scheduleFlush();
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Initial scan
    this.scan(document.body);
  }

  stop(): void {
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    this.pendingNodes.clear();
    this.pendingCharDataNodes.clear();
    this.scheduled = false;
  }

  private scheduleFlush(): void {
    if (this.scheduled) return;
    this.scheduled = true;

    requestIdleCallback(() => {
      this.scheduled = false;
      this.flush();
    });
  }

  private flush(): void {
    if (this.pendingNodes.size > 0) {
      const nodes = [...this.pendingNodes];
      this.pendingNodes.clear();
      for (const node of nodes) {
        if (node.isConnected) {
          this.scan(node);
        }
      }
    }

    if (this.pendingCharDataNodes.size > 0) {
      const parents = [...this.pendingCharDataNodes];
      this.pendingCharDataNodes.clear();
      for (const parent of parents) {
        if (!parent.isConnected) continue;
        this.rescanIfChanged(parent);
      }
    }
  }

  private rescanIfChanged(element: HTMLElement): void {
    const currentText = element.innerText?.trim() || '';
    if (!currentText || !isJapanese(currentText)) return;

    if (this.tracker.isProcessedWithSameText(element, currentText)) return;

    this.scan(element);
  }

  scan(root: HTMLElement): void {
    const blocks: DetectedBlock[] = [];
    const blockElements = new Map<HTMLElement, Text[]>();

    walkTextNodes(root, (textNode) => {
      const text = textNode.textContent?.trim();
      if (!text || !isJapanese(text)) return;

      const blockParent = this.findBlockParent(textNode);
      if (!blockParent) return;

      if (this.tracker.isProcessed(blockParent)) {
        const currentText = blockParent.innerText?.trim() || '';
        if (this.tracker.isProcessedWithSameText(blockParent, currentText)) return;
      }

      if (!blockElements.has(blockParent)) {
        blockElements.set(blockParent, []);
      }
      blockElements.get(blockParent)!.push(textNode);
    });

    for (const [element, textNodes] of blockElements) {
      const text = textNodes.map((n) => n.textContent?.trim()).filter(Boolean).join('');
      if (text && japaneseRatio(text) > 0.1) {
        if (this.isNearViewport(element)) {
          this.tracker.markProcessed(element, text);
          blocks.push({ element, textNodes, text });
        } else {
          // Defer: don't mark as processed yet, observe for viewport entry
          this.intersectionObserver?.observe(element);
        }
      }
    }

    if (blocks.length > 0) {
      this.onDetected(blocks);
    }
  }

  /** Check if element is within or near the viewport (200px margin) */
  private isNearViewport(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    return rect.bottom > -200 && rect.top < window.innerHeight + 200;
  }

  /**
   * Find block-level ancestor for a text node.
   * Generic webpage mode — no site-specific selectors.
   */
  private findBlockParent(node: Node): HTMLElement | null {
    let current = node.parentElement;
    while (current) {
      // Skip our own injected elements
      if (current.hasAttribute('data-jp-translation')) return null;

      // Skip user-editable areas
      if (current.isContentEditable || current.matches('[role="textbox"], [role="combobox"]')) return null;

      // Block-level elements
      const display = getComputedStyle(current).display;
      if (display === 'block' || display === 'flex' || display === 'grid' ||
          display === 'list-item' || display === 'table-cell') {
        return current;
      }

      current = current.parentElement;
    }
    return null;
  }

  /**
   * Check if the current page has significant Japanese content
   */
  static hasJapaneseContent(): boolean {
    const bodyText = document.body.innerText?.substring(0, 5000) || '';
    return japaneseRatio(bodyText) > 0.1;
  }
}

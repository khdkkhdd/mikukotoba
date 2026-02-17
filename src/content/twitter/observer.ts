import { SELECTORS, PROCESSED_ATTR, isEditableArea } from './utils';
import { createLogger } from '@/core/logger';

const log = createLogger('Twitter:Observer');

/**
 * Callback types for each handler category.
 */
export interface TwitterObserverCallbacks {
  onTweetText: (element: HTMLElement) => void;
  onCardWrapper: (element: HTMLElement) => void;
  onUserName: (element: HTMLElement) => void;
  onUserNameProfile: (element: HTMLElement) => void;
  onUserDescription: (element: HTMLElement) => void;
  onUserLocation: (element: HTMLElement) => void;
  onUserCell: (element: HTMLElement) => void;
  onSocialContext: (element: HTMLElement) => void;
  onTrend: (element: HTMLElement) => void;
}

/**
 * Single shared MutationObserver for all Twitter translation handlers.
 *
 * Observes document.body for new DOM nodes, then routes elements
 * to the appropriate handler based on data-testid selectors.
 *
 * Uses a batched flush strategy: mutations are accumulated in a Set
 * and processed in a single requestIdleCallback, avoiding per-mutation overhead.
 */
export class TwitterObserver {
  private observer: MutationObserver | null = null;
  private callbacks: TwitterObserverCallbacks;

  // Batch queue
  private pendingNodes = new Set<HTMLElement>();
  private pendingCharDataParents = new Set<HTMLElement>();
  private scheduled = false;

  constructor(callbacks: TwitterObserverCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
              // Skip our own injected elements
              if (node.hasAttribute('data-jp-twitter-translation')) continue;
              if (node.hasAttribute(PROCESSED_ATTR)) continue;
              this.pendingNodes.add(node);
            }
          }
        }

        // characterData: text filled after node insertion (React hydration)
        if (mutation.type === 'characterData') {
          const textNode = mutation.target;
          if (textNode.nodeType !== Node.TEXT_NODE) continue;
          const parent = textNode.parentElement?.closest<HTMLElement>(
            `${SELECTORS.TWEET_TEXT}, ${SELECTORS.USER_DESCRIPTION}`
          );
          if (parent) {
            this.pendingCharDataParents.add(parent);
          }
        }
      }

      this.scheduleFlush();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    log.info('Observer started');

    // Initial scan of existing content
    this.scanExisting();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.pendingNodes.clear();
    this.pendingCharDataParents.clear();
    this.scheduled = false;
    log.info('Observer stopped');
  }

  /**
   * Schedule a batched flush on the next idle callback.
   */
  private scheduleFlush(): void {
    if (this.scheduled) return;
    this.scheduled = true;

    requestIdleCallback(() => {
      this.scheduled = false;
      this.flush();
    });
  }

  /**
   * Process all accumulated pending nodes.
   */
  private flush(): void {
    // Process new DOM nodes
    if (this.pendingNodes.size > 0) {
      const nodes = [...this.pendingNodes];
      log.debug('flush:', nodes.length, 'pending nodes');
      this.pendingNodes.clear();
      for (const node of nodes) {
        if (node.isConnected) {
          this.routeElement(node);
        }
      }
    }

    // Process characterData changes (re-route parents)
    if (this.pendingCharDataParents.size > 0) {
      const parents = [...this.pendingCharDataParents];
      this.pendingCharDataParents.clear();
      for (const parent of parents) {
        if (parent.isConnected) {
          this.routeSingle(parent);
        }
      }
    }
  }

  /**
   * Route a single element to the appropriate handler.
   */
  private routeSingle(element: HTMLElement): void {
    if (isEditableArea(element)) return;

    if (element.matches(SELECTORS.TWEET_TEXT)) {
      this.callbacks.onTweetText(element);
    } else if (element.matches(SELECTORS.USER_DESCRIPTION)) {
      this.callbacks.onUserDescription(element);
    }
  }

  /**
   * Route a newly added DOM subtree to handlers.
   * Checks both the element itself and its descendants.
   */
  private routeElement(root: HTMLElement): void {
    if (isEditableArea(root)) return;

    // Check the root element itself
    this.matchAndRoute(root);

    // Check descendants — use querySelectorAll for each selector
    this.queryAndRoute(root, SELECTORS.TWEET_TEXT, this.callbacks.onTweetText);
    this.queryAndRoute(root, SELECTORS.CARD_WRAPPER, this.callbacks.onCardWrapper);
    this.queryAndRoute(root, SELECTORS.USER_NAME, this.callbacks.onUserName);
    this.queryAndRoute(root, SELECTORS.USER_NAME_PROFILE, this.callbacks.onUserNameProfile);
    this.queryAndRoute(root, SELECTORS.USER_DESCRIPTION, this.callbacks.onUserDescription);
    this.queryAndRoute(root, SELECTORS.USER_LOCATION, this.callbacks.onUserLocation);
    this.queryAndRoute(root, SELECTORS.USER_CELL, this.callbacks.onUserCell);
    this.queryAndRoute(root, SELECTORS.SOCIAL_CONTEXT, this.callbacks.onSocialContext);
    this.queryAndRoute(root, SELECTORS.TREND, this.callbacks.onTrend);
  }

  /**
   * Check if the root element itself matches any selector.
   */
  private matchAndRoute(element: HTMLElement): void {
    if (element.matches(SELECTORS.TWEET_TEXT)) {
      this.callbacks.onTweetText(element);
    } else if (element.matches(SELECTORS.CARD_WRAPPER)) {
      this.callbacks.onCardWrapper(element);
    } else if (element.matches(SELECTORS.USER_NAME)) {
      this.callbacks.onUserName(element);
    } else if (element.matches(SELECTORS.USER_NAME_PROFILE)) {
      this.callbacks.onUserNameProfile(element);
    } else if (element.matches(SELECTORS.USER_DESCRIPTION)) {
      this.callbacks.onUserDescription(element);
    } else if (element.matches(SELECTORS.USER_LOCATION)) {
      this.callbacks.onUserLocation(element);
    } else if (element.matches(SELECTORS.USER_CELL)) {
      this.callbacks.onUserCell(element);
    } else if (element.matches(SELECTORS.SOCIAL_CONTEXT)) {
      this.callbacks.onSocialContext(element);
    } else if (element.matches(SELECTORS.TREND)) {
      this.callbacks.onTrend(element);
    }
  }

  /**
   * Query descendants matching a selector and route each to a callback.
   */
  private queryAndRoute(
    root: HTMLElement,
    selector: string,
    callback: (el: HTMLElement) => void
  ): void {
    const elements = root.querySelectorAll<HTMLElement>(selector);
    if (elements.length > 0) {
      log.debug('routeElement:', selector, '→', elements.length, 'in', root.tagName);
    }
    for (const el of elements) {
      if (!isEditableArea(el)) {
        callback(el);
      }
    }
  }

  /**
   * Scan existing page content on initialization.
   * Twitter is a SPA, so content may already be loaded when our script runs.
   */
  private scanExisting(): void {
    const selectors: Array<[string, (el: HTMLElement) => void]> = [
      [SELECTORS.TWEET_TEXT, this.callbacks.onTweetText],
      [SELECTORS.CARD_WRAPPER, this.callbacks.onCardWrapper],
      [SELECTORS.USER_NAME, this.callbacks.onUserName],
      [SELECTORS.USER_NAME_PROFILE, this.callbacks.onUserNameProfile],
      [SELECTORS.USER_DESCRIPTION, this.callbacks.onUserDescription],
      [SELECTORS.USER_LOCATION, this.callbacks.onUserLocation],
      [SELECTORS.USER_CELL, this.callbacks.onUserCell],
      [SELECTORS.SOCIAL_CONTEXT, this.callbacks.onSocialContext],
      [SELECTORS.TREND, this.callbacks.onTrend],
    ];

    let totalFound = 0;
    for (const [selector, callback] of selectors) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      if (elements.length > 0) {
        log.debug('scanExisting:', selector, '→', elements.length, 'found');
      }
      totalFound += elements.length;
      for (const el of elements) {
        if (!isEditableArea(el)) {
          callback(el);
        }
      }
    }
    log.info('scanExisting done:', totalFound, 'total elements');
  }
}

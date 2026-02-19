import { createLogger } from '@/core/logger';

/**
 * A selector-to-callback route for the BatchedObserver.
 */
export interface SelectorRoute {
  selector: string;
  callback: (element: HTMLElement) => void;
}

export interface BatchedObserverOptions {
  /** Namespace for log messages (e.g. 'Twitter:Observer') */
  logNamespace: string;
  /** Watch for characterData mutations (text content changes) */
  characterData?: boolean;
  /**
   * Resolve a characterData text node to its meaningful ancestor element.
   * Twitter: `.closest(TWEET_TEXT, USER_DESC)`
   * Webpage: `findBlockParent(node)`
   */
  characterDataAncestorResolver?: (node: Node) => HTMLElement | null;
  /** Optional predicate to skip certain elements entirely */
  shouldSkip?: (el: HTMLElement) => boolean;
  /** Scan existing DOM content on start (default: true) */
  scanExisting?: boolean;
}

/**
 * Batched MutationObserver that routes elements to callbacks by CSS selector.
 *
 * Consolidates the identical batching pattern from TwitterObserver and TextDetector:
 * - Accumulates mutations in Sets
 * - Flushes via requestIdleCallback
 * - Routes matched elements to callbacks
 */
export class BatchedObserver {
  private observer: MutationObserver | null = null;
  private routes: SelectorRoute[];
  private options: BatchedObserverOptions;
  private log;

  // Batch queues
  private pendingNodes = new Set<HTMLElement>();
  private pendingCharDataParents = new Set<HTMLElement>();
  private scheduled = false;

  constructor(routes: SelectorRoute[], options: BatchedObserverOptions) {
    this.routes = [...routes];
    this.options = options;
    this.log = createLogger(options.logNamespace);
  }

  start(): void {
    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
              if (this.options.shouldSkip?.(node)) continue;
              this.pendingNodes.add(node);
            }
          }
        }

        if (mutation.type === 'characterData' && this.options.characterDataAncestorResolver) {
          const textNode = mutation.target;
          if (textNode.nodeType !== Node.TEXT_NODE) continue;
          const parent = this.options.characterDataAncestorResolver(textNode);
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
      characterData: this.options.characterData ?? false,
    });

    this.log.info('Observer started');

    if (this.options.scanExisting !== false) {
      this.scanExisting();
    }
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.pendingNodes.clear();
    this.pendingCharDataParents.clear();
    this.scheduled = false;
    this.log.info('Observer stopped');
  }

  /** Add a route dynamically after construction */
  addRoute(route: SelectorRoute): void {
    this.routes.push(route);
  }

  /** Manually trigger a scan of existing DOM content (e.g. after SPA navigation) */
  scan(): void {
    this.scanExisting();
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
    // Process new DOM nodes
    if (this.pendingNodes.size > 0) {
      const nodes = [...this.pendingNodes];
      this.log.debug('flush:', nodes.length, 'pending nodes');
      this.pendingNodes.clear();
      for (const node of nodes) {
        if (node.isConnected) {
          this.routeElement(node);
        }
      }
    }

    // Process characterData changes
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

  /** Route a single element (from characterData) against all selectors */
  private routeSingle(element: HTMLElement): void {
    if (this.options.shouldSkip?.(element)) return;

    for (const route of this.routes) {
      if (element.matches(route.selector)) {
        route.callback(element);
        return;
      }
    }
  }

  /** Route a newly added DOM subtree — check the root and all descendants */
  private routeElement(root: HTMLElement): void {
    if (this.options.shouldSkip?.(root)) return;

    // Check the root element itself
    for (const route of this.routes) {
      if (root.matches(route.selector)) {
        route.callback(root);
        break; // root matches at most one route
      }
    }

    // Check descendants
    for (const route of this.routes) {
      const elements = root.querySelectorAll<HTMLElement>(route.selector);
      for (const el of elements) {
        if (!this.options.shouldSkip?.(el)) {
          route.callback(el);
        }
      }
    }
  }

  /** Scan existing DOM content for all routes */
  private scanExisting(): void {
    let totalFound = 0;
    for (const route of this.routes) {
      const elements = document.querySelectorAll<HTMLElement>(route.selector);
      if (elements.length > 0) {
        this.log.debug('scanExisting:', route.selector, '→', elements.length, 'found');
      }
      totalFound += elements.length;
      for (const el of elements) {
        if (!this.options.shouldSkip?.(el)) {
          route.callback(el);
        }
      }
    }
    this.log.info('scanExisting done:', totalFound, 'total elements');
  }
}

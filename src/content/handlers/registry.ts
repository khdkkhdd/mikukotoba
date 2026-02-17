import type { UserSettings } from '@/types';
import type { SiteHandler } from './types';

/**
 * Registry of all site handlers.
 *
 * Handlers are registered at startup and queried per-page
 * to determine which ones should activate.
 */
export class HandlerRegistry {
  private handlers: SiteHandler[] = [];

  register(handler: SiteHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Returns handlers that match the given URL and are enabled in settings.
   * Sorted by priority descending (highest first).
   */
  getMatchingHandlers(url: URL, settings: UserSettings): SiteHandler[] {
    return this.handlers
      .filter(h => h.matches(url) && h.isEnabled(settings))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  getById(id: string): SiteHandler | undefined {
    return this.handlers.find(h => h.id === id);
  }
}

export const handlerRegistry = new HandlerRegistry();

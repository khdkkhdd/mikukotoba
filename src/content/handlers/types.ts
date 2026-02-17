import type { UserSettings } from '@/types';
import type { StatusIndicator } from '@/content/shared/status-indicator';

/**
 * Common interface for all site-specific translation handlers.
 *
 * Each handler manages its own DOM observation, text detection,
 * and translation rendering for a specific site or feature.
 */
export interface SiteHandler {
  /** Unique identifier: 'twitter', 'youtube-subtitle', 'youtube-page', 'webpage' */
  readonly id: string;
  /** Human-readable name for logging */
  readonly name: string;
  /** Higher priority handlers initialize first (default 0) */
  readonly priority?: number;
  /** If true, handler starts only after Japanese content is detected on the page */
  readonly requiresJapaneseContent?: boolean;

  /** Check if this handler should activate for the given URL */
  matches(url: URL): boolean;
  /** Check if this handler is enabled based on current user settings */
  isEnabled(settings: UserSettings): boolean;
  /** Provide the shared status indicator */
  setStatusIndicator(indicator: StatusIndicator): void;
  /** Start observing and translating */
  start(): void | Promise<void>;
  /** Stop all activity and clean up injected DOM */
  stop(): void;
  /** React to settings changes while running */
  updateSettings(settings: UserSettings): void;
}

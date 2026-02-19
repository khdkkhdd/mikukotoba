import type { UserSettings, SubtitleEntry } from '@/types';
import type { StatusIndicator } from '@/content/shared/status-indicator';
import type { SiteHandler } from '@/content/handlers/types';
import { translator } from '@/core/translator';
import { VideoObserver } from './video-observer';
import { SubtitleExtractor } from './subtitle-extractor';
import { SubtitleOverlay } from './subtitle-overlay';
import { onWordClick } from '@/content/shared/word-click-callback';
import { createLogger } from '@/core/logger';

const log = createLogger('YouTube:Subtitle');

/**
 * YouTube subtitle translation handler.
 *
 * Wraps the existing VideoObserver + SubtitleExtractor + SubtitleOverlay
 * composition into a SiteHandler interface.
 */
export class YouTubeSubtitleHandler implements SiteHandler {
  readonly id = 'youtube-subtitle';
  readonly name = 'YouTube Subtitle';
  readonly priority = 10;

  private settings: UserSettings;
  private videoObserver: VideoObserver | null = null;
  private subtitleExtractor: SubtitleExtractor | null = null;
  private subtitleOverlay: SubtitleOverlay | null = null;
  private prefetchInterval: ReturnType<typeof setInterval> | null = null;

  constructor(settings: UserSettings) {
    this.settings = settings;
  }

  matches(url: URL): boolean {
    return url.hostname.includes('youtube.com');
  }

  isEnabled(settings: UserSettings): boolean {
    return settings.youtubeMode;
  }

  setStatusIndicator(_indicator: StatusIndicator): void {
    // Subtitle overlay manages its own display
  }

  start(): void {
    log.info('YouTube subtitle handler starting');
    this.subtitleOverlay = new SubtitleOverlay(this.settings);
    this.subtitleOverlay.setOnWordClick(onWordClick);

    this.videoObserver = new VideoObserver((meta) => {
      // New video detected — clear stale overlay immediately
      translator.clearContext();
      translator.setMetadata({ title: meta.title, channel: meta.channel });
      this.subtitleOverlay?.hide();

      // Start subtitle extraction
      if (this.subtitleExtractor) this.subtitleExtractor.stop();
      this.subtitleExtractor = new SubtitleExtractor(
        (entry) => this.handleSubtitle(entry),
        () => this.subtitleOverlay?.hide(),
      );
      this.subtitleExtractor.start(meta.videoId);

      // Mount overlay
      this.subtitleOverlay?.mount();

      // Start prefetching
      this.startPrefetch();
    });

    this.videoObserver.start();
  }

  stop(): void {
    log.info('YouTube subtitle handler stopping');
    this.videoObserver?.stop();
    this.subtitleExtractor?.stop();
    this.subtitleOverlay?.unmount();

    if (this.prefetchInterval) {
      clearInterval(this.prefetchInterval);
      this.prefetchInterval = null;
    }

    this.videoObserver = null;
    this.subtitleExtractor = null;
    this.subtitleOverlay = null;
  }

  updateSettings(settings: UserSettings): void {
    this.settings = settings;
    this.subtitleOverlay?.updateSettings(settings);
  }

  private async handleSubtitle(entry: SubtitleEntry): Promise<void> {
    const shortText = entry.text.length > 30 ? entry.text.slice(0, 30) + '...' : entry.text;
    log.debug('Subtitle received:', shortText);
    const t0 = Date.now();
    try {
      const result = await translator.translate(entry.text);
      log.debug('Subtitle translated:', shortText, `engine=${result.engine}`, `${Date.now() - t0}ms`);
      this.subtitleOverlay?.show(result);
    } catch (e) {
      log.error('Translation error:', shortText, `${Date.now() - t0}ms`, e);
    }
  }

  private startPrefetch(): void {
    if (this.prefetchInterval) clearInterval(this.prefetchInterval);
    log.debug('Prefetch timer started');

    this.prefetchInterval = setInterval(() => {
      if (!this.subtitleExtractor) return;
      const video = document.querySelector('video');
      if (!video) return;

      const upcoming = this.subtitleExtractor.getPrefetchEntries(video.currentTime, 3);
      if (upcoming.length > 0) {
        log.debug('Prefetch:', upcoming.length, 'entries');
      }
      for (const entry of upcoming) {
        translator.translate(entry.text).catch(() => {});
      }
    }, 2000);
  }
}

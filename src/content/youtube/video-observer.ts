import { createLogger } from '@/core/logger';

const log = createLogger('Video');

/**
 * Observes YouTube SPA navigation and video element changes.
 * Detects when a new video is loaded and extracts metadata.
 */

export interface VideoMeta {
  videoId: string;
  title: string;
  channel: string;
}

type VideoChangeCallback = (meta: VideoMeta) => void;

export class VideoObserver {
  private observer: MutationObserver | null = null;
  private currentVideoId: string | null = null;
  private onVideoChange: VideoChangeCallback;
  private urlCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(onVideoChange: VideoChangeCallback) {
    this.onVideoChange = onVideoChange;
  }

  start(): void {
    log.info('Observer started');
    // Monitor URL changes (YouTube SPA doesn't trigger normal page loads)
    this.urlCheckInterval = setInterval(() => this.checkUrlChange(), 1000);

    // Also observe DOM mutations for video element
    this.observer = new MutationObserver(() => {
      this.checkUrlChange();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Initial check
    this.checkUrlChange();
  }

  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.urlCheckInterval) {
      clearInterval(this.urlCheckInterval);
      this.urlCheckInterval = null;
    }
    this.currentVideoId = null;
  }

  private checkUrlChange(): void {
    if (!location.pathname.startsWith('/watch')) return;

    const params = new URLSearchParams(location.search);
    const videoId = params.get('v');
    if (!videoId || videoId === this.currentVideoId) return;

    this.currentVideoId = videoId;
    log.info('New video detected, videoId:', videoId);

    // Extract metadata with a small delay to let the page update
    setTimeout(() => {
      const meta = this.extractMetadata(videoId);
      log.info('Video metadata:', `title="${meta.title}"`, `channel="${meta.channel}"`);
      this.onVideoChange(meta);
    }, 500);
  }

  private extractMetadata(videoId: string): VideoMeta {
    // Try to get title from page
    const titleEl =
      document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
      document.querySelector('h1.title');
    const title = titleEl?.textContent?.trim() || document.title.replace(' - YouTube', '');

    // Try to get channel name
    const channelEl =
      document.querySelector('#channel-name yt-formatted-string a') ||
      document.querySelector('ytd-channel-name yt-formatted-string');
    const channel = channelEl?.textContent?.trim() || '';

    return { videoId, title, channel };
  }

  getCurrentVideoId(): string | null {
    return this.currentVideoId;
  }
}

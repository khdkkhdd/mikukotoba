import type { SubtitleEntry } from '@/types';
import { createLogger } from '@/core/logger';
import { containsJapaneseLike } from '@/content/shared/dom-utils';

const log = createLogger('Subtitle');

type SubtitleCallback = (entry: SubtitleEntry) => void;

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText: string };
}

interface TimedTextResponse {
  events?: Array<{
    segs?: Array<{ utf8: string }>;
    tStartMs: number;
    dDurationMs: number;
  }>;
}

/**
 * Extracts Japanese subtitles from YouTube videos.
 * Uses three strategies in priority order:
 * 1. HTML5 TextTrack API
 * 2. YouTube TimedText API
 * 3. DOM-based subtitle capture
 */
export class SubtitleExtractor {
  private onSubtitle: SubtitleCallback;
  private onClear: (() => void) | null;
  private activeMethod: 'texttrack' | 'timedtext' | 'dom' | null = null;
  private domObserver: MutationObserver | null = null;
  private trackListener: (() => void) | null = null;
  private timedTextEntries: SubtitleEntry[] = [];
  private timeUpdateHandler: (() => void) | null = null;
  private lastDisplayedText: string = '';
  private videoElement: HTMLVideoElement | null = null;
  private trackWatcherCleanup: (() => void) | null = null;
  private trackModeCleanup: (() => void) | null = null;
  private upgrading = false;

  constructor(onSubtitle: SubtitleCallback, onClear?: () => void) {
    this.onSubtitle = onSubtitle;
    this.onClear = onClear || null;
  }

  async start(videoId: string): Promise<void> {
    log.info('Extraction starting for videoId:', videoId);
    this.stop();

    // 1. Check if TextTrack already has Japanese track (user manually enabled CC)
    const immediateSuccess = await this.tryTextTrack();
    if (immediateSuccess) {
      this.activeMethod = 'texttrack';
      log.info('Using TextTrack method (already active)');
      return;
    }

    // 2. Programmatically enable Japanese captions via YouTube player API
    const enabled = await this.enableCaptions('ja');
    if (enabled) {
      // Wait for YouTube to load the subtitle data into TextTrack
      await new Promise((r) => setTimeout(r, 1500));

      const textTrackSuccess = await this.tryTextTrack();
      if (textTrackSuccess) {
        this.activeMethod = 'texttrack';
        log.info('Using TextTrack method (auto-enabled)');
        return;
      }
    }

    // 3. Try TimedText API (signed URLs from player response + direct API)
    const timedTextSuccess = await this.tryTimedText(videoId);
    if (timedTextSuccess) {
      this.activeMethod = 'timedtext';
      log.info('Using TimedText method, entries:', this.timedTextEntries.length);
      // Still watch for TextTrack upgrade (preferred over timedtext)
      this.startTrackWatcher();
      return;
    }

    // 4. DOM capture fallback
    this.tryDomCapture();
    this.activeMethod = 'dom';
    log.info('Using DOM capture fallback');

    // 5. Watch for TextTrack to become available later
    this.startTrackWatcher();
  }

  /**
   * Ask the MAIN-world bridge to programmatically enable Japanese captions
   * on the YouTube player. This triggers ASR data loading.
   */
  private enableCaptions(lang: string): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false;

      const handler = (e: Event) => {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('mikukotoba-captions-enabled', handler);
        const data = JSON.parse((e as CustomEvent).detail);
        log.info('enableCaptions:', data.info);
        resolve(data.success);
      };

      window.addEventListener('mikukotoba-captions-enabled', handler);
      window.dispatchEvent(
        new CustomEvent('mikukotoba-enable-captions', { detail: lang }),
      );

      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('mikukotoba-captions-enabled', handler);
        log.info('enableCaptions: bridge timeout');
        resolve(false);
      }, 1000);
    });
  }

  stop(): void {
    this.stopTrackWatcher();
    this.stopTrackModeWatcher();
    if (this.domObserver) {
      this.domObserver.disconnect();
      this.domObserver = null;
    }
    if (this.trackListener) {
      this.trackListener();
      this.trackListener = null;
    }
    if (this.timeUpdateHandler) {
      if (this.videoElement) {
        this.videoElement.removeEventListener('timeupdate', this.timeUpdateHandler);
      }
      this.timeUpdateHandler = null;
    }
    this.videoElement = null;
    this.activeMethod = null;
    this.timedTextEntries = [];
    this.lastDisplayedText = '';
  }

  getActiveMethod(): string | null {
    return this.activeMethod;
  }

  /**
   * Watch for TextTrack to become available after initial start() failed to use it.
   * Listens for addtrack/change events and retries at 3s/8s.
   */
  private startTrackWatcher(): void {
    const video = document.querySelector('video');
    if (!video) return;

    const tryUpgrade = async () => {
      if (this.upgrading || this.activeMethod === 'texttrack' || !this.activeMethod) return;
      this.upgrading = true;
      try {
        const enabled = await this.enableCaptions('ja');
        if (enabled) {
          await new Promise(r => setTimeout(r, 1500));
        }
        const success = await this.tryTextTrack();
        if (!success) return;

        // Clean up previous method (DOM observer / timedtext timeupdate)
        if (this.domObserver) { this.domObserver.disconnect(); this.domObserver = null; }
        if (this.timeUpdateHandler && this.videoElement) {
          this.videoElement.removeEventListener('timeupdate', this.timeUpdateHandler);
          this.timeUpdateHandler = null;
        }
        this.timedTextEntries = [];
        this.activeMethod = 'texttrack';
        log.info('Upgraded to TextTrack method');
        this.stopTrackWatcher();
      } finally {
        this.upgrading = false;
      }
    };

    const handler = () => { tryUpgrade(); };
    video.textTracks.addEventListener('addtrack', handler);
    video.textTracks.addEventListener('change', handler);

    const timers = [
      setTimeout(() => tryUpgrade(), 3000),
      setTimeout(() => tryUpgrade(), 8000),
    ];

    this.trackWatcherCleanup = () => {
      video.textTracks.removeEventListener('addtrack', handler);
      video.textTracks.removeEventListener('change', handler);
      timers.forEach(clearTimeout);
    };
  }

  private stopTrackWatcher(): void {
    this.trackWatcherCleanup?.();
    this.trackWatcherCleanup = null;
  }

  /**
   * Watch for the Japanese TextTrack being disabled (user turns off CC).
   * The 'change' event fires on textTracks when mode changes,
   * but 'cuechange' does NOT fire, so the overlay would stay visible.
   */
  private startTrackModeWatcher(video: HTMLVideoElement, jaTrack: TextTrack): void {
    this.stopTrackModeWatcher();

    const handler = () => {
      if (jaTrack.mode === 'disabled') {
        log.info('TextTrack disabled (CC turned off)');
        if (this.lastDisplayedText) {
          this.lastDisplayedText = '';
          this.onClear?.();
        }
      }
    };

    video.textTracks.addEventListener('change', handler);
    this.trackModeCleanup = () => video.textTracks.removeEventListener('change', handler);
  }

  private stopTrackModeWatcher(): void {
    this.trackModeCleanup?.();
    this.trackModeCleanup = null;
  }

  /**
   * Method 1: HTML5 TextTrack API
   */
  private async tryTextTrack(): Promise<boolean> {
    log.info('tryTextTrack: attempting...');
    const video = document.querySelector('video');
    if (!video) {
      log.info('tryTextTrack: FAIL — no <video> element');
      return false;
    }

    const tracks = video.textTracks;
    if (!tracks || tracks.length === 0) {
      log.info('tryTextTrack: FAIL — no text tracks (0 tracks)');
      return false;
    }

    // Log all available tracks for diagnosis
    const trackInfo = Array.from({ length: tracks.length }, (_, i) => {
      const t = tracks[i];
      return `${t.language}(${t.kind},${t.mode})`;
    });
    log.info('tryTextTrack: found', tracks.length, 'tracks:', trackInfo.join(', '));

    // Find Japanese subtitle track
    let jaTrack: TextTrack | null = null;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (track.language === 'ja' || track.language === 'ja-JP') {
        jaTrack = track;
        break;
      }
    }

    if (!jaTrack) {
      log.info('tryTextTrack: FAIL — no Japanese track');
      return false;
    }

    // Track exists but cue data hasn't loaded yet — don't commit to this method
    if (!jaTrack.cues) {
      log.info('tryTextTrack: FAIL — Japanese track found but cues not loaded yet, lang:', jaTrack.language);
      return false;
    }

    log.info('tryTextTrack: OK — Japanese track found, lang:', jaTrack.language, 'cues:', jaTrack.cues.length);

    // Enable the track
    jaTrack.mode = 'hidden'; // hidden so we render our own overlay

    const handler = () => {
      if (!jaTrack!.activeCues || jaTrack!.activeCues.length === 0) {
        if (this.lastDisplayedText) {
          this.lastDisplayedText = '';
          this.onClear?.();
        }
        return;
      }

      const cue = jaTrack!.activeCues[0] as VTTCue;
      if (!cue) return;

      const text = cue.text.replace(/<[^>]+>/g, '').trim();
      if (text && text !== this.lastDisplayedText) {
        this.lastDisplayedText = text;
        const shortText = text.length > 30 ? text.slice(0, 30) + '…' : text;
        log.debug('TextTrack cue:', shortText);
        this.onSubtitle({
          start: cue.startTime,
          duration: cue.endTime - cue.startTime,
          text,
        });
      }
    };

    jaTrack.addEventListener('cuechange', handler);
    this.trackListener = () => jaTrack!.removeEventListener('cuechange', handler);

    // Watch for track mode changes (user turning off CC → mode becomes 'disabled')
    this.startTrackModeWatcher(video, jaTrack);

    // Immediately check for already-active cues
    // (mode change from 'showing' to 'hidden' doesn't fire cuechange)
    handler();

    return true;
  }

  /**
   * Method 2: YouTube TimedText API
   * Tries player-embedded caption tracks first (includes ASR/auto-generated),
   * then falls back to direct API URLs.
   */
  private async tryTimedText(videoId: string): Promise<boolean> {
    log.info('tryTimedText: attempting for', videoId);

    // 1. Try to get caption tracks from YouTube player response
    const tracks = await this.extractCaptionTracks();
    if (tracks.length > 0) {
      const trackSummary = tracks.map(t => `${t.languageCode}(${t.kind || 'manual'})`).join(', ');
      log.info('tryTimedText: found', tracks.length, 'caption tracks:', trackSummary);

      // Prefer manual Japanese track, then ASR
      const jaTrack = tracks.find(t => t.languageCode === 'ja' && t.kind !== 'asr')
        || tracks.find(t => t.languageCode === 'ja');

      if (jaTrack) {
        const label = jaTrack.name?.simpleText || jaTrack.languageCode;
        log.info('tryTimedText: using track:', label, `(${jaTrack.kind || 'manual'})`);
        const url = jaTrack.baseUrl + (jaTrack.baseUrl.includes('fmt=') ? '' : '&fmt=json3');
        const success = await this.fetchTimedTextFromUrl(url);
        if (success) return true;
      } else {
        log.info('tryTimedText: no Japanese track among available tracks');
      }
    } else {
      log.info('tryTimedText: could not extract caption tracks from player');
    }

    // 2. Fallback: direct API URLs (manual + ASR)
    const urls = [
      `https://www.youtube.com/api/timedtext?v=${videoId}&lang=ja&fmt=json3`,
      `https://www.youtube.com/api/timedtext?v=${videoId}&lang=ja&kind=asr&fmt=json3`,
    ];

    for (const url of urls) {
      const isAsr = url.includes('kind=asr');
      log.info('tryTimedText: trying direct API', isAsr ? '(ASR)' : '(manual)');
      const success = await this.fetchTimedTextFromUrl(url);
      if (success) return true;
    }

    return false;
  }

  /**
   * Extract caption track metadata from YouTube's player response.
   * Communicates with caption-bridge.ts (MAIN world) via window events.
   * Falls back to HTML parsing if the bridge is unavailable.
   */
  private extractCaptionTracks(): Promise<CaptionTrack[]> {
    return new Promise((resolve) => {
      let resolved = false;

      const handler = (e: Event) => {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('mikukotoba-tracks-response', handler);
        try {
          resolve(JSON.parse((e as CustomEvent).detail));
        } catch {
          resolve([]);
        }
      };

      window.addEventListener('mikukotoba-tracks-response', handler);
      window.dispatchEvent(new Event('mikukotoba-get-tracks'));

      // Timeout — if bridge doesn't respond, try HTML parsing fallback
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('mikukotoba-tracks-response', handler);
        log.info('extractCaptionTracks: bridge timeout, trying HTML parsing');
        resolve(this.extractCaptionTracksFromHtml());
      }, 500);
    });
  }

  /**
   * Fallback: parse caption tracks from ytInitialPlayerResponse embedded in page HTML.
   * Works for initial page loads but not for SPA navigation.
   */
  private extractCaptionTracksFromHtml(): CaptionTrack[] {
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (!text || !text.includes('captionTracks')) continue;

        const idx = text.indexOf('"captionTracks":');
        if (idx === -1) continue;

        const start = text.indexOf('[', idx);
        if (start === -1) continue;

        // Find the matching closing bracket
        let depth = 0;
        for (let i = start; i < text.length; i++) {
          if (text[i] === '[') depth++;
          else if (text[i] === ']') {
            depth--;
            if (depth === 0) {
              const jsonStr = text.slice(start, i + 1);
              const tracks: CaptionTrack[] = JSON.parse(jsonStr);
              log.info('extractCaptionTracks: found via HTML parsing');
              return tracks;
            }
          }
        }
      }
    } catch {
      // ignore
    }
    return [];
  }

  /**
   * Fetch text via the MAIN-world bridge (same-origin with YouTube).
   * Falls back to direct fetch if bridge is unavailable.
   */
  private bridgeFetch(url: string): Promise<string> {
    return new Promise((resolve) => {
      let resolved = false;
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

      const handler = (e: Event) => {
        const data = JSON.parse((e as CustomEvent).detail);
        if (data.id !== id) return; // not our response
        if (resolved) return;
        resolved = true;
        window.removeEventListener('mikukotoba-fetch-response', handler);
        log.info('bridgeFetch: HTTP', data.status,
          'bodyLen:', (data.text || '').length,
          data.error ? `err: ${data.error}` : '',
          'url:', url.replace(/&sig[^&]*/g, '&sig=***').slice(0, 120));
        resolve(data.text || '');
      };

      window.addEventListener('mikukotoba-fetch-response', handler);
      window.dispatchEvent(
        new CustomEvent('mikukotoba-fetch-url', {
          detail: JSON.stringify({ url, id }),
        }),
      );

      // Timeout: fall back to direct fetch
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('mikukotoba-fetch-response', handler);
        log.info('bridgeFetch: timeout, trying direct fetch');
        fetch(url)
          .then((r) => (r.ok ? r.text() : ''))
          .then(resolve)
          .catch(() => resolve(''));
      }, 3000);
    });
  }

  /**
   * Fetch and parse timed text from a URL, then set up the timeupdate listener.
   */
  private async fetchTimedTextFromUrl(url: string): Promise<boolean> {
    try {
      const body = await this.bridgeFetch(url);
      if (!body) {
        log.info('fetchTimedText: empty body');
        return false;
      }

      let data: TimedTextResponse;
      try {
        data = JSON.parse(body);
      } catch {
        log.info('fetchTimedText: invalid JSON, length:', body.length);
        return false;
      }

      if (!data.events || data.events.length === 0) {
        log.info('fetchTimedText: no events');
        return false;
      }

      this.timedTextEntries = data.events
        .filter((e) => e.segs)
        .map((e) => ({
          start: e.tStartMs / 1000,
          duration: (e.dDurationMs || 3000) / 1000,
          text: e.segs!.map((s) => s.utf8).join('').trim(),
        }))
        .filter((e) => e.text);

      log.info('fetchTimedText: OK —', this.timedTextEntries.length, 'subtitle entries');

      const video = document.querySelector('video');
      if (!video) return false;
      this.videoElement = video;

      this.timeUpdateHandler = () => {
        const currentTime = video.currentTime;
        const entry = this.timedTextEntries.find(
          (e) => currentTime >= e.start && currentTime < e.start + e.duration
        );

        if (entry) {
          if (entry.text !== this.lastDisplayedText) {
            this.lastDisplayedText = entry.text;
            const shortText = entry.text.length > 30 ? entry.text.slice(0, 30) + '…' : entry.text;
            log.debug('TimedText cue:', shortText);
            this.onSubtitle(entry);
          }
        } else if (this.lastDisplayedText) {
          this.lastDisplayedText = '';
          this.onClear?.();
        }
      };

      video.addEventListener('timeupdate', this.timeUpdateHandler);
      return true;
    } catch (err) {
      log.info('fetchTimedText: error:', err);
      return false;
    }
  }

  /**
   * Method 3: DOM-based subtitle capture (fallback)
   */
  private tryDomCapture(): void {
    const captionContainer = document.querySelector('.ytp-caption-window-container');
    const player = document.querySelector('.html5-video-player');
    log.info('tryDomCapture: captionContainer:', !!captionContainer, 'player:', !!player);

    const checkSubtitle = () => {
      const segments = document.querySelectorAll('.ytp-caption-segment');
      if (segments.length === 0) {
        if (this.lastDisplayedText) {
          this.lastDisplayedText = '';
          this.onClear?.();
        }
        return;
      }

      const text = Array.from(segments)
        .map((s) => s.textContent?.trim())
        .filter(Boolean)
        .join(' ');

      if (text && text !== this.lastDisplayedText && containsJapaneseLike(text)) {
        this.lastDisplayedText = text;
        const shortText = text.length > 30 ? text.slice(0, 30) + '…' : text;
        log.info('DOM cue:', shortText);
        const video = document.querySelector('video');
        const currentTime = video?.currentTime || 0;
        this.onSubtitle({
          start: currentTime,
          duration: 3,
          text,
        });
      }
    };

    this.domObserver = new MutationObserver(checkSubtitle);

    const target = captionContainer || player;
    if (target) {
      this.domObserver.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      log.info('tryDomCapture: observing', captionContainer ? '.ytp-caption-window-container' : '.html5-video-player');
    } else {
      log.warn('tryDomCapture: NO target element found — DOM capture will not work');
    }
  }

  /**
   * Get upcoming subtitles for prefetching.
   * Only works with TimedText method.
   */
  getPrefetchEntries(currentTime: number, count: number = 3): SubtitleEntry[] {
    if (this.activeMethod !== 'timedtext') return [];

    return this.timedTextEntries
      .filter((e) => e.start > currentTime)
      .slice(0, count);
  }
}

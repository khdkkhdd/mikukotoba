import type { UserSettings, MessageType } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { translator } from '@/core/translator';
import { createLogger, setLogEnabled } from '@/core/logger';
import { setApiFetchImpl } from '@/core/translator/api-fetch';

setLogEnabled(false);
import './shared/overlay-styles.css';

const log = createLogger('Content');

import { StatusIndicator } from './shared/status-indicator';
import { TextDetector } from './webpage/text-detector';

// Handler registry
import { handlerRegistry } from './handlers/registry';
import type { SiteHandler } from './handlers/types';
import { TwitterHandler } from './twitter';
import { YouTubeSubtitleHandler } from './youtube/subtitle-handler';
import { YouTubePageHandler } from './youtube/page-handler';
import { WebpageSiteHandler } from './webpage';

// Register all handlers — single point of management
handlerRegistry.register(new TwitterHandler({ ...DEFAULT_SETTINGS }));
handlerRegistry.register(new YouTubeSubtitleHandler({ ...DEFAULT_SETTINGS }));
handlerRegistry.register(new YouTubePageHandler({ ...DEFAULT_SETTINGS }));
handlerRegistry.register(new WebpageSiteHandler({ ...DEFAULT_SETTINGS }));

/**
 * Content Script Entry Point
 *
 * Determines the current site and activates the appropriate handlers
 * using the HandlerRegistry.
 */

let settings: UserSettings = { ...DEFAULT_SETTINGS };

function applyCSSVariables(s: UserSettings): void {
  const root = document.documentElement;
  root.style.setProperty('--jp-inline-color-furigana', s.inlineColorFurigana);
  root.style.setProperty('--jp-inline-color-romaji', s.inlineColorRomaji);
  root.style.setProperty('--jp-inline-color-translation', s.inlineColorTranslation);
  // Unitless scale values — each CSS file multiplies with the appropriate base unit
  root.style.setProperty('--jp-inline-font-scale', String(s.inlineFontScale));
  root.style.setProperty('--jp-inline-furigana-scale', String(s.inlineFuriganaScale));
}

// Status indicator
const statusIndicator = new StatusIndicator();

// Active handler tracking
let activeHandlers: SiteHandler[] = [];

// Lazy init state
let translatorReady = false;
let lazyObserver: MutationObserver | null = null;

async function loadSettingsFromStorage(): Promise<UserSettings> {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get('jp_settings'),
    chrome.storage.local.get('jp_api_keys'),
  ]);

  const saved = syncData['jp_settings'] || {};
  const apiKeys = localData['jp_api_keys'] || {};

  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    papagoClientId: apiKeys.papagoClientId || '',
    papagoClientSecret: apiKeys.papagoClientSecret || '',
    claudeApiKey: apiKeys.claudeApiKey || '',
    openaiApiKey: apiKeys.openaiApiKey || '',
    geminiApiKey: apiKeys.geminiApiKey || '',
  };
}

async function init(): Promise<void> {
  // Load settings directly from chrome.storage (no service worker dependency)
  try {
    settings = await loadSettingsFromStorage();
    applyCSSVariables(settings);
    log.info('Settings loaded, enabled:', settings.enabled, 'youtubeMode:', settings.youtubeMode, 'webpageMode:', settings.webpageMode);
  } catch (e) {
    log.warn('Failed to load settings, using defaults:', e);
  }

  if (!settings.enabled) {
    log.info('Extension disabled, skipping init');
    return;
  }

  const url = new URL(location.href);
  const matching = handlerRegistry.getMatchingHandlers(url, settings);

  const eager = matching.filter(h => !h.requiresJapaneseContent);
  const lazy = matching.filter(h => h.requiresJapaneseContent);

  log.info('Matching handlers — eager:', eager.map(h => h.id), 'lazy:', lazy.map(h => h.id));

  // Eager handlers: initialize translator and start immediately
  if (eager.length > 0) {
    await initTranslator();
    if (!translatorReady) return;

    statusIndicator.reset();
    statusIndicator.mount();

    // Start all eager handlers with error isolation
    const results = await Promise.allSettled(
      eager.map(async h => {
        h.setStatusIndicator(statusIndicator);
        h.updateSettings(settings);
        await h.start();
        return h;
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        activeHandlers.push(r.value);
      } else {
        log.error('[ミク言葉] Handler init failed:', r.reason);
      }
    }
  }

  // Lazy handlers: wait for Japanese content detection
  if (lazy.length > 0) {
    // Check if page already has Japanese content
    if (TextDetector.hasJapaneseContent()) {
      await initTranslator();
      if (!translatorReady) return;

      await startLazyHandlers(lazy);
    } else {
      startLazyWatcher(lazy);
    }
  }
}

/**
 * Initialize translator (kuromoji dictionary load).
 * Called once — either eagerly or on first Japanese text detection.
 */
async function initTranslator(): Promise<void> {
  if (translatorReady) return;

  log.info('Translator init starting...');
  const t0 = Date.now();
  translator.configure(settings);
  try {
    await translator.init();
    translatorReady = true;
    log.info('Translator init complete', `${Date.now() - t0}ms`);
  } catch (e) {
    log.error('Translator init FAILED', `${Date.now() - t0}ms`, e);
  }
}

/**
 * Start lazy handlers (ones requiring Japanese content detection).
 */
async function startLazyHandlers(handlers: SiteHandler[]): Promise<void> {
  statusIndicator.reset();
  statusIndicator.mount();

  const results = await Promise.allSettled(
    handlers.map(async h => {
      h.setStatusIndicator(statusIndicator);
      h.updateSettings(settings);
      await h.start();
      return h;
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled') {
      activeHandlers.push(r.value);
    } else {
      log.error('[ミク言葉] Lazy handler init failed:', r.reason);
    }
  }
}

/**
 * Lightweight MutationObserver that waits for Japanese text to appear.
 * Once detected, tears itself down and runs full initialization.
 */
function startLazyWatcher(handlers: SiteHandler[]): void {
  if (lazyObserver) return;

  lazyObserver = new MutationObserver(() => {
    if (!TextDetector.hasJapaneseContent()) return;

    stopLazyWatcher();

    initTranslator().then(() => {
      if (!translatorReady) return;
      startLazyHandlers(handlers);
    });
  });

  lazyObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function stopLazyWatcher(): void {
  lazyObserver?.disconnect();
  lazyObserver = null;
}

// ──────────────── Cleanup ────────────────

function cleanupAll(): void {
  stopLazyWatcher();

  for (const h of activeHandlers) {
    h.stop();
  }
  activeHandlers = [];

  statusIndicator.unmount();
}

// ──────────────── Message Handling ────────────────

chrome.runtime.onMessage.addListener((message: MessageType) => {
  switch (message.type) {
    case 'SETTINGS_CHANGED':
      // Re-read full settings from storage to ensure API keys are included
      loadSettingsFromStorage()
        .catch(() => ({ ...settings, ...message.payload }))
        .then((loaded) => {
          settings = loaded;
          applyCSSVariables(settings);
          translator.configure(settings);
          for (const h of activeHandlers) {
            h.updateSettings(settings);
          }
        });
      break;

    case 'TOGGLE_ENABLED':
      if (message.payload.enabled) {
        settings.enabled = true;
        init();
      } else {
        settings.enabled = false;
        cleanupAll();
      }
      break;

    case 'MODE_CHANGED': {
      // Update settings and propagate to webpage + youtube-page handlers
      settings.webpageMode = message.payload.mode;
      let handlerFound = false;
      for (const h of activeHandlers) {
        if (h.id === 'webpage' || h.id === 'youtube-page') {
          h.updateSettings(settings);
          handlerFound = true;
        }
      }
      if (!handlerFound && message.payload.mode !== 'off') {
        // Handler wasn't active, restart init
        init();
      }
      break;
    }

    case 'VOCAB_ADD_START': {
      handleVocabAdd(message.payload.text);
      break;
    }

  }
});

// ──────────────── Vocab Add ────────────────

import { autoFillVocab } from './vocab/vocab-add-handler';
import { showVocabModal, updateVocabModal, removeVocabModal } from './vocab/vocab-modal';

async function handleVocabAdd(text: string): Promise<void> {
  try {
    // Use captured selection info if available, fallback to message text
    const selInfo = getLastSelectionInfo();
    const selectedText = selInfo?.text || text;

    // Show loading modal immediately
    showVocabModal(null, () => {});

    // Ensure translator is ready
    await initTranslator();
    if (!translatorReady) {
      removeVocabModal();
      return;
    }

    // Auto-fill with analysis + translation
    const autoFill = await autoFillVocab(selectedText, translator);

    // Update modal with results
    updateVocabModal(autoFill, async (entry) => {
      await chrome.runtime.sendMessage({ type: 'VOCAB_SAVE', payload: entry });
    });
  } catch (e) {
    log.error('Vocab add failed:', e);
    removeVocabModal();
  }
}

// ──────────────── Background Fetch Proxy ────────────────

/**
 * Proxy fetch through background service worker to bypass CORS.
 * Content scripts inherit the page's origin, so direct fetch to
 * external APIs (Papago, Claude, OpenAI, Gemini) gets blocked.
 */
async function bgFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (init?.headers) {
    const h = init.headers;
    if (h instanceof Headers) {
      h.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) headers[k] = v;
    } else {
      Object.assign(headers, h);
    }
  }
  const body = init?.body != null ? String(init.body) : undefined;

  const resp = await chrome.runtime.sendMessage({
    type: 'FETCH_PROXY',
    payload: { url, method, headers, body },
  }) as { ok: boolean; status: number; statusText: string; body: string; headers: Record<string, string> };

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
  });
}

setApiFetchImpl(bgFetch);

// ──────────────── Selection Capture for Vocab ────────────────

import { captureSelectionOnContextMenu, getLastSelectionInfo } from './vocab/selection-capture';
captureSelectionOnContextMenu();

// ──────────────── Start ────────────────

init().catch((e) => log.error('Init error:', e));

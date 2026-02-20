import type { MessageType, UserSettings, UsageStats, DayStats, LLMPlatform, WebpageMode } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { papagoClient } from '@/core/translator/papago';
import { claudeClient } from '@/core/translator/claude';
import { openaiClient } from '@/core/translator/openai';
import { geminiClient } from '@/core/translator/gemini';
import { VocabStorage } from '@/core/vocab-storage';
import { DriveAuth } from '@/core/drive-auth';
import { DriveSync } from '@/core/drive-sync';

const SETTINGS_KEY = 'jp_settings';
const API_KEYS_KEY = 'jp_api_keys';
const STATS_KEY = 'jp_usage_stats';
const CORRECTIONS_KEY = 'jp_user_corrections';

/**
 * Service Worker: handles message routing, settings management,
 * and keyboard shortcut commands.
 */

// Load settings on startup
let currentSettings: UserSettings = { ...DEFAULT_SETTINGS };

async function loadSettings(): Promise<UserSettings> {
  try {
    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get(SETTINGS_KEY),
      chrome.storage.local.get(API_KEYS_KEY),
    ]);

    const savedSettings = syncData[SETTINGS_KEY] || {};
    const apiKeys = localData[API_KEYS_KEY] || {};

    currentSettings = {
      ...DEFAULT_SETTINGS,
      ...savedSettings,
      // API keys from local storage only (security)
      papagoClientId: apiKeys.papagoClientId || '',
      papagoClientSecret: apiKeys.papagoClientSecret || '',
      claudeApiKey: apiKeys.claudeApiKey || '',
      openaiApiKey: apiKeys.openaiApiKey || '',
      geminiApiKey: apiKeys.geminiApiKey || '',
    };

    return currentSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function saveSettings(settings: Partial<UserSettings>): Promise<void> {
  // Separate API keys from other settings
  const {
    papagoClientId, papagoClientSecret, claudeApiKey,
    openaiApiKey, geminiApiKey,
    ...otherSettings
  } = settings;

  // Save non-sensitive settings to sync storage
  if (Object.keys(otherSettings).length > 0) {
    const syncData = await chrome.storage.sync.get(SETTINGS_KEY);
    const existing = syncData[SETTINGS_KEY] || {};
    await chrome.storage.sync.set({
      [SETTINGS_KEY]: { ...existing, ...otherSettings },
    });
  }

  // Save API keys to local storage only
  if (
    papagoClientId !== undefined || papagoClientSecret !== undefined ||
    claudeApiKey !== undefined || openaiApiKey !== undefined || geminiApiKey !== undefined
  ) {
    const localData = await chrome.storage.local.get(API_KEYS_KEY);
    const existingKeys = localData[API_KEYS_KEY] || {};
    await chrome.storage.local.set({
      [API_KEYS_KEY]: {
        ...existingKeys,
        ...(papagoClientId !== undefined && { papagoClientId }),
        ...(papagoClientSecret !== undefined && { papagoClientSecret }),
        ...(claudeApiKey !== undefined && { claudeApiKey }),
        ...(openaiApiKey !== undefined && { openaiApiKey }),
        ...(geminiApiKey !== undefined && { geminiApiKey }),
      },
    });
  }

  // Update in-memory settings
  currentSettings = { ...currentSettings, ...settings };
}

async function updateStats(engine: 'papago' | LLMPlatform): Promise<void> {
  try {
    const data = await chrome.storage.local.get(STATS_KEY);
    const stats: UsageStats = data[STATS_KEY] || {
      totalTranslations: 0,
      papagoCount: 0,
      claudeCount: 0,
      openaiCount: 0,
      geminiCount: 0,
      cacheHits: 0,
      dailyStats: {},
      wordFrequency: {},
    };

    stats.totalTranslations++;
    if (engine === 'papago') stats.papagoCount++;
    else if (engine === 'claude') stats.claudeCount++;
    else if (engine === 'openai') stats.openaiCount++;
    else if (engine === 'gemini') stats.geminiCount++;

    // Update daily stats
    const today = new Date().toISOString().split('T')[0];
    if (!stats.dailyStats[today]) {
      stats.dailyStats[today] = { translations: 0, papago: 0, claude: 0, openai: 0, gemini: 0 };
    }
    stats.dailyStats[today].translations++;
    if (engine === 'papago' || engine === 'claude' || engine === 'openai' || engine === 'gemini') {
      stats.dailyStats[today][engine]++;
    }

    // Clean up old daily stats (keep 90 days)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    for (const date of Object.keys(stats.dailyStats)) {
      if (date < cutoffStr) delete stats.dailyStats[date];
    }

    await chrome.storage.local.set({ [STATS_KEY]: stats });
  } catch {
    // Best effort
  }
}

// Message handler
chrome.runtime.onMessage.addListener(
  (message: MessageType, _sender, sendResponse) => {
    handleMessage(message, sendResponse);
    return true; // Keep channel open for async response
  }
);

async function handleMessage(
  message: MessageType,
  sendResponse: (response: unknown) => void
): Promise<void> {
  switch (message.type) {
    case 'GET_SETTINGS': {
      const settings = await loadSettings();
      sendResponse({ type: 'SETTINGS_RESPONSE', payload: settings });
      break;
    }

    case 'SETTINGS_CHANGED': {
      await saveSettings(message.payload);
      await broadcastToAllTabs({ type: 'SETTINGS_CHANGED', payload: message.payload });
      sendResponse({ success: true });
      break;
    }

    case 'TOGGLE_ENABLED': {
      await saveSettings({ enabled: message.payload.enabled });
      sendResponse({ success: true });
      break;
    }

    case 'CLEAR_CACHE': {
      await chrome.storage.local.remove('jp_cache_index');
      // Clear all cache entries
      const allKeys = await chrome.storage.local.get(null);
      const cacheKeys = Object.keys(allKeys).filter((k) => k.startsWith('jp_cache_'));
      if (cacheKeys.length > 0) {
        await chrome.storage.local.remove(cacheKeys);
      }
      sendResponse({ success: true });
      break;
    }

    case 'GET_STATS': {
      const data = await chrome.storage.local.get(STATS_KEY);
      const stats: UsageStats = data[STATS_KEY] || {
        totalTranslations: 0,
        papagoCount: 0,
        claudeCount: 0,
        openaiCount: 0,
        geminiCount: 0,
        cacheHits: 0,
        dailyStats: {},
        wordFrequency: {},
      };
      sendResponse({ type: 'STATS_RESPONSE', payload: stats });
      break;
    }

    case 'TEST_PAPAGO': {
      try {
        const result = await papagoClient.testConnection(
          message.payload.clientId,
          message.payload.clientSecret
        );
        sendResponse({
          type: 'TEST_RESULT',
          payload: {
            success: result.success,
            message: result.success
              ? 'Papago 연결 성공!'
              : `Papago 연결 실패: ${result.error || 'API 키를 확인해주세요.'}`,
          },
        });
      } catch (err) {
        sendResponse({
          type: 'TEST_RESULT',
          payload: { success: false, message: `오류: ${err}` },
        });
      }
      break;
    }

    case 'TEST_CLAUDE': {
      try {
        const success = await claudeClient.testConnection(message.payload.apiKey);
        sendResponse({
          type: 'TEST_RESULT',
          payload: {
            success,
            message: success ? 'Claude 연결 성공!' : 'Claude 연결 실패. API 키를 확인해주세요.',
          },
        });
      } catch (err) {
        sendResponse({
          type: 'TEST_RESULT',
          payload: { success: false, message: `오류: ${err}` },
        });
      }
      break;
    }

    case 'TEST_OPENAI': {
      try {
        const success = await openaiClient.testConnection(message.payload.apiKey);
        sendResponse({
          type: 'TEST_RESULT',
          payload: {
            success,
            message: success ? 'OpenAI 연결 성공!' : 'OpenAI 연결 실패. API 키를 확인해주세요.',
          },
        });
      } catch (err) {
        sendResponse({
          type: 'TEST_RESULT',
          payload: { success: false, message: `오류: ${err}` },
        });
      }
      break;
    }

    case 'TEST_GEMINI': {
      try {
        const success = await geminiClient.testConnection(message.payload.apiKey);
        sendResponse({
          type: 'TEST_RESULT',
          payload: {
            success,
            message: success ? 'Gemini 연결 성공!' : 'Gemini 연결 실패. API 키를 확인해주세요.',
          },
        });
      } catch (err) {
        sendResponse({
          type: 'TEST_RESULT',
          payload: { success: false, message: `오류: ${err}` },
        });
      }
      break;
    }

    case 'FETCH_PROXY': {
      const { url, method, headers, body } = message.payload;
      try {
        const resp = await fetch(url, {
          method,
          headers,
          ...(body !== undefined && { body }),
        });
        const respBody = await resp.text();
        const respHeaders: Record<string, string> = {};
        resp.headers.forEach((v, k) => { respHeaders[k] = v; });
        sendResponse({
          ok: resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          body: respBody,
          headers: respHeaders,
        });
      } catch (err) {
        sendResponse({
          ok: false,
          status: 0,
          statusText: String(err),
          body: '',
          headers: {},
        });
      }
      break;
    }

    case 'DRIVE_LOGIN': {
      try {
        const status = await DriveAuth.login();
        sendResponse({ success: true, payload: status });
      } catch (err) {
        sendResponse({ success: false, message: String(err) });
      }
      break;
    }

    case 'DRIVE_LOGOUT': {
      await DriveAuth.logout();
      sendResponse({ success: true });
      break;
    }

    case 'DRIVE_GET_STATUS': {
      const status = await DriveAuth.getStatus();
      sendResponse({ payload: status });
      break;
    }

    case 'SYNC_PULL': {
      try {
        const result = await DriveSync.pull();
        sendResponse({ success: true, payload: result });
      } catch (err) {
        sendResponse({ success: false, message: String(err) });
      }
      break;
    }

    case 'SYNC_GET_STATUS': {
      const meta = await DriveSync.getMetadata();
      const driveStatus = await DriveAuth.getStatus();
      sendResponse({ payload: { ...driveStatus, lastSync: meta.lastSyncTimestamp } });
      break;
    }

    case 'VOCAB_SAVE': {
      await VocabStorage.addEntry(message.payload);
      // Auto-add to glossary: vocab → glossary sync
      await addVocabToGlossary(message.payload.word, message.payload.meaning);
      // Update recent tags
      const saveTags = message.payload.tags ?? [];
      if (saveTags.length > 0) {
        await updateRecentTags(saveTags);
      }
      sendResponse({ success: true });
      // Fire-and-forget: push to Drive
      DriveSync.pushPartition(message.payload.dateAdded).catch(() => {});
      break;
    }

    case 'VOCAB_GET_INDEX': {
      const index = await VocabStorage.getIndex();
      sendResponse({ payload: index });
      break;
    }

    case 'VOCAB_GET_ENTRIES': {
      const entries = await VocabStorage.getEntriesByDates(message.payload.dates);
      sendResponse({ payload: entries });
      break;
    }

    case 'VOCAB_UPDATE': {
      await VocabStorage.updateEntry(message.payload);
      sendResponse({ success: true });
      DriveSync.pushPartition(message.payload.dateAdded).catch(() => {});
      break;
    }

    case 'VOCAB_DELETE': {
      await VocabStorage.deleteEntry(message.payload.id, message.payload.date);
      sendResponse({ success: true });
      DriveSync.pushPartitionWithDeletion(message.payload.id, message.payload.date).catch(() => {});
      break;
    }

    case 'VOCAB_SEARCH': {
      const results = await VocabStorage.search(message.payload.query);
      sendResponse({ payload: results });
      break;
    }

    case 'VOCAB_EXPORT': {
      const all = await VocabStorage.exportAll();
      sendResponse({ payload: all });
      break;
    }

    case 'VOCAB_IMPORT': {
      const added = await VocabStorage.importEntries(message.payload.entries);
      sendResponse({ payload: { added } });
      break;
    }

    case 'VOCAB_GET_TAGS': {
      const tags = await VocabStorage.getAllTags();
      sendResponse({ payload: tags });
      break;
    }

    case 'VOCAB_GET_BY_TAG': {
      const tagEntries = await VocabStorage.getEntriesByTag(message.payload.tag);
      sendResponse({ payload: tagEntries });
      break;
    }
  }
}

// Broadcast a message to all tabs
async function broadcastToAllTabs(message: MessageType): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  }
}

// Keyboard shortcut commands
chrome.commands.onCommand.addListener(async (command) => {
  switch (command) {
    case 'toggle-extension':
      currentSettings.enabled = !currentSettings.enabled;
      await saveSettings({ enabled: currentSettings.enabled });
      await broadcastToAllTabs({
        type: 'TOGGLE_ENABLED',
        payload: { enabled: currentSettings.enabled },
      });
      break;

    case 'toggle-furigana':
      currentSettings.showFurigana = !currentSettings.showFurigana;
      await saveSettings({ showFurigana: currentSettings.showFurigana });
      await broadcastToAllTabs({ type: 'SETTINGS_CHANGED', payload: currentSettings });
      break;

    case 'toggle-translation':
      currentSettings.showTranslation = !currentSettings.showTranslation;
      await saveSettings({ showTranslation: currentSettings.showTranslation });
      await broadcastToAllTabs({ type: 'SETTINGS_CHANGED', payload: currentSettings });
      break;

    case 'toggle-romaji':
      currentSettings.showRomaji = !currentSettings.showRomaji;
      await saveSettings({ showRomaji: currentSettings.showRomaji });
      await broadcastToAllTabs({ type: 'SETTINGS_CHANGED', payload: currentSettings });
      break;

    case 'cycle-webpage-mode': {
      const modes: WebpageMode[] = ['hover', 'inline', 'furigana-only'];
      const idx = modes.indexOf(currentSettings.webpageMode);
      currentSettings.webpageMode = modes[(idx + 1) % modes.length];
      await saveSettings({ webpageMode: currentSettings.webpageMode });
      await broadcastToAllTabs({ type: 'SETTINGS_CHANGED', payload: currentSettings });
      // Also send MODE_CHANGED for content script handling
      await broadcastToAllTabs({
        type: 'MODE_CHANGED',
        payload: { mode: currentSettings.webpageMode },
      });
      break;
    }
  }
});

// Sync on browser startup
chrome.runtime.onStartup.addListener(() => {
  DriveSync.pull().catch(() => {});
});

// Watch for settings changes from other contexts
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[SETTINGS_KEY]) {
    loadSettings();
  }
});

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  await loadSettings();

  // Re-register context menus (removeAll first to avoid duplicate ID errors on update)
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: 'jp-add-to-vocab',
    title: 'JP 단어장에 추가',
    contexts: ['selection'],
  });

  // Rebuild search index for existing vocab data (migration)
  VocabStorage.rebuildSearchIndex().catch(() => {});
});

/**
 * Add a vocab entry to the custom glossary (auto-sync).
 * Skips if the word already exists in the glossary.
 */
const RECENT_TAGS_KEY = 'jp_vocab_recent_tags';
const MAX_RECENT_TAGS = 5;

async function updateRecentTags(tags: string[]): Promise<void> {
  try {
    const data = await chrome.storage.local.get(RECENT_TAGS_KEY);
    const recent: string[] = data[RECENT_TAGS_KEY] || [];
    // Prepend new tags, deduplicate, keep max
    const updated = [...new Set([...tags, ...recent])].slice(0, MAX_RECENT_TAGS);
    await chrome.storage.local.set({ [RECENT_TAGS_KEY]: updated });
  } catch {
    // Best effort
  }
}

const GLOSSARY_STORAGE_KEY = 'jp_glossary_custom';

async function addVocabToGlossary(japanese: string, korean: string): Promise<void> {
  if (!japanese || !korean) return;
  try {
    const data = await chrome.storage.local.get(GLOSSARY_STORAGE_KEY);
    const entries: Array<{ japanese: string; korean: string; note?: string }> = data[GLOSSARY_STORAGE_KEY] || [];
    // Skip if already exists
    if (entries.some(e => e.japanese === japanese)) return;
    entries.push({ japanese, korean, note: '단어장에서 자동 추가' });
    await chrome.storage.local.set({ [GLOSSARY_STORAGE_KEY]: entries });
  } catch {
    // Best effort — don't fail vocab save
  }
}

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'jp-add-to-vocab' || !info.selectionText || !tab?.id) return;

  chrome.tabs.sendMessage(tab.id, {
    type: 'VOCAB_ADD_START',
    payload: { text: info.selectionText },
  }).catch(() => {});
});

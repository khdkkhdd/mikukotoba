import type { MessageType, UserSettings, UsageStats, DayStats, LLMPlatform } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { papagoClient } from '@/core/translator/papago';
import { claudeClient } from '@/core/translator/claude';
import { openaiClient } from '@/core/translator/openai';
import { geminiClient } from '@/core/translator/gemini';

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
      // Notify all content scripts
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'SETTINGS_CHANGED',
            payload: message.payload,
          }).catch(() => {});
        }
      }
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
  }
}

// Keyboard shortcut commands
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  switch (command) {
    case 'toggle-extension':
      currentSettings.enabled = !currentSettings.enabled;
      await saveSettings({ enabled: currentSettings.enabled });
      chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_ENABLED',
        payload: { enabled: currentSettings.enabled },
      }).catch(() => {});
      break;

    case 'toggle-furigana':
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_FURIGANA' }).catch(() => {});
      break;

    case 'toggle-translation':
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_TRANSLATION' }).catch(() => {});
      break;

    case 'toggle-romaji':
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_ROMAJI' }).catch(() => {});
      break;
  }
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
});

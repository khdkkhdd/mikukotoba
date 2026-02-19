import type { UserSettings, UsageStats, GlossaryEntry, LLMPlatform, DriveStatus, SyncResult } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { getModelsForPlatform } from '@/core/translator/llm-registry';

let settings: UserSettings = { ...DEFAULT_SETTINGS };

// ──────────────── Load & Save ────────────────

async function loadSettings(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (response?.payload) {
      settings = response.payload;
    }
  } catch {
    // Use defaults
  }
  updateUI();
}

async function saveSettings(changes: Partial<UserSettings>): Promise<void> {
  settings = { ...settings, ...changes };
  await chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED', payload: changes });
}

// ──────────────── UI Update ────────────────

function updateUI(): void {
  // API keys
  setInputValue('papagoClientId', settings.papagoClientId);
  setInputValue('papagoClientSecret', settings.papagoClientSecret);
  setInputValue('claudeApiKey', settings.claudeApiKey);
  setInputValue('openaiApiKey', settings.openaiApiKey);
  setInputValue('geminiApiKey', settings.geminiApiKey);

  // Display settings
  setRangeWithLabel('fontSize', settings.fontSize, 'fontSizeValue');
  setRangeWithLabel('backgroundOpacity', settings.backgroundOpacity, 'opacityValue');
  setColorValue('colorOriginal', settings.colorOriginal);
  setColorValue('colorFurigana', settings.colorFurigana);
  setColorValue('colorRomaji', settings.colorRomaji);
  setColorValue('colorTranslation', settings.colorTranslation);

  setColorValue('inlineColorFurigana', settings.inlineColorFurigana);
  setColorValue('inlineColorRomaji', settings.inlineColorRomaji);
  setColorValue('inlineColorTranslation', settings.inlineColorTranslation);

  setRangeWithLabel('inlineFontScale', settings.inlineFontScale, 'inlineFontScaleValue');
  setRangeWithLabel('inlineFuriganaScale', settings.inlineFuriganaScale, 'inlineFuriganaScaleValue');

  // Translation settings
  setRangeWithLabel('complexityThreshold', settings.complexityThreshold, 'thresholdValue');
  setRangeWithLabel('contextWindowSize', settings.contextWindowSize, 'contextValue');
  setRangeWithLabel('keigoWeight', settings.keigoWeight, 'keigoValue');
  setRangeWithLabel('lengthWeight', settings.lengthWeight, 'lengthValue');
  setRangeWithLabel('idiomWeight', settings.idiomWeight, 'idiomValue');

  // LLM platform/model dropdowns
  const platformSelect = document.getElementById('llmPlatform') as HTMLSelectElement;
  platformSelect.value = settings.llmPlatform;
  populateModelDropdown(settings.llmPlatform, settings.llmModel);

  // Update previews
  updatePreview();
  updateInlinePreview();

  // Load additional data
  loadGlossary();
  loadStats();
  loadCacheStats();
  loadDriveStatus();
}

function populateModelDropdown(platform: LLMPlatform, selectedModel?: string): void {
  const modelSelect = document.getElementById('llmModel') as HTMLSelectElement;
  const models = getModelsForPlatform(platform);
  modelSelect.innerHTML = '';
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    modelSelect.appendChild(option);
  }
  if (selectedModel && models.some((m) => m.id === selectedModel)) {
    modelSelect.value = selectedModel;
  } else if (models.length > 0) {
    modelSelect.value = models[0].id;
  }
}

function updatePreview(): void {
  const preview = document.getElementById('preview');
  if (!preview) return;

  preview.style.background = `rgba(0, 0, 0, ${settings.backgroundOpacity / 100})`;

  const original = preview.querySelector('.preview-original') as HTMLElement;
  if (original) {
    original.style.color = settings.colorOriginal;
    original.style.fontSize = `${settings.fontSize}px`;
    const rt = original.querySelector('rt');
    if (rt) {
      rt.style.color = settings.colorFurigana;
      rt.style.fontSize = `${Math.round(settings.fontSize * 0.5)}px`;
    }
  }

  const romaji = preview.querySelector('.preview-romaji') as HTMLElement;
  if (romaji) {
    romaji.style.color = settings.colorRomaji;
    romaji.style.fontSize = `${Math.round(settings.fontSize * 0.65)}px`;
  }

  const translation = preview.querySelector('.preview-translation') as HTMLElement;
  if (translation) {
    translation.style.color = settings.colorTranslation;
    translation.style.fontSize = `${Math.round(settings.fontSize * 0.8)}px`;
  }
}

function updateInlinePreview(): void {
  const preview = document.getElementById('previewInline');
  if (!preview) return;

  // Apply font scale to the preview container
  preview.style.fontSize = `${settings.inlineFontScale}em`;

  const original = preview.querySelector('.preview-inline-original') as HTMLElement;
  if (original) {
    const rt = original.querySelector('rt');
    if (rt) {
      rt.style.color = settings.inlineColorFurigana;
      rt.style.fontSize = `${settings.inlineFuriganaScale}em`;
    }
  }

  const romaji = preview.querySelector('.preview-inline-romaji') as HTMLElement;
  if (romaji) {
    romaji.style.color = settings.inlineColorRomaji;
  }

  const translation = preview.querySelector('.preview-inline-translation') as HTMLElement;
  if (translation) {
    translation.style.color = settings.inlineColorTranslation;
  }
}

// ──────────────── Glossary ────────────────

async function loadGlossary(): Promise<void> {
  // Built-in glossary
  const builtInContainer = document.getElementById('builtInGlossary')!;
  try {
    const data = await chrome.storage.local.get('jp_glossary_builtin_display');
    // Use built-in list from glossary manager (loaded via storage)
    const builtIn: GlossaryEntry[] = [
      { japanese: 'おはようございます', korean: '안녕하세요 (아침)', note: '아침 인사' },
      { japanese: 'お疲れ様です', korean: '수고하셨습니다', note: '업무/활동 후' },
      { japanese: 'よろしくお願いします', korean: '잘 부탁드립니다' },
      { japanese: 'やばい', korean: '대박/위험한', note: '상황에 따라' },
      { japanese: '推し', korean: '최애', note: '좋아하는 대상' },
      { japanese: '草', korean: 'ㅋㅋㅋ', note: '인터넷 웃음' },
    ];
    builtInContainer.innerHTML = builtIn
      .map(
        (e) => `<div class="glossary-item">
          <span class="g-jp">${esc(e.japanese)}</span>
          <span class="g-ko">${esc(e.korean)}</span>
          <span class="g-note">${esc(e.note || '')}</span>
        </div>`
      )
      .join('');
  } catch {
    builtInContainer.innerHTML = '<p class="help-text">로드 실패</p>';
  }

  // Custom glossary
  loadCustomGlossary();
}

async function loadCustomGlossary(): Promise<void> {
  const container = document.getElementById('customGlossary')!;
  try {
    const data = await chrome.storage.local.get('jp_glossary_custom');
    const entries: GlossaryEntry[] = data['jp_glossary_custom'] || [];

    if (entries.length === 0) {
      container.innerHTML = '<p class="help-text">커스텀 용어가 없습니다.</p>';
      return;
    }

    container.innerHTML = entries
      .map(
        (e, i) => `<div class="glossary-item">
          <span class="g-jp">${esc(e.japanese)}</span>
          <span class="g-ko">${esc(e.korean)}</span>
          <span class="g-note">${esc(e.note || '')}</span>
          <button class="g-delete" data-idx="${i}" title="삭제">✕</button>
        </div>`
      )
      .join('');

    // Delete handlers
    container.querySelectorAll('.g-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = parseInt((btn as HTMLElement).dataset.idx || '0', 10);
        entries.splice(idx, 1);
        await chrome.storage.local.set({ 'jp_glossary_custom': entries });
        loadCustomGlossary();
      });
    });
  } catch {
    container.innerHTML = '<p class="help-text">로드 실패</p>';
  }
}

// ──────────────── Stats ────────────────

async function loadStats(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
    const stats: UsageStats = response?.payload || {
      totalTranslations: 0,
      papagoCount: 0,
      claudeCount: 0,
      openaiCount: 0,
      geminiCount: 0,
      cacheHits: 0,
      dailyStats: {},
      wordFrequency: {},
    };

    document.getElementById('totalTranslations')!.textContent = String(stats.totalTranslations);
    document.getElementById('papagoCount')!.textContent = String(stats.papagoCount);
    document.getElementById('claudeCount')!.textContent = String(stats.claudeCount);
    document.getElementById('openaiCount')!.textContent = String(stats.openaiCount || 0);
    document.getElementById('geminiCount')!.textContent = String(stats.geminiCount || 0);
    document.getElementById('cacheHits')!.textContent = String(stats.cacheHits);

    const total = stats.papagoCount + stats.claudeCount + (stats.openaiCount || 0) + (stats.geminiCount || 0) || 1;
    const papagoPercent = Math.round((stats.papagoCount / total) * 100);
    const claudePercent = Math.round((stats.claudeCount / total) * 100);
    const openaiPercent = Math.round(((stats.openaiCount || 0) / total) * 100);
    const geminiPercent = 100 - papagoPercent - claudePercent - openaiPercent;

    (document.getElementById('usagePapago') as HTMLElement).style.width = `${papagoPercent}%`;
    (document.getElementById('usageClaude') as HTMLElement).style.width = `${claudePercent}%`;
    (document.getElementById('usageOpenai') as HTMLElement).style.width = `${openaiPercent}%`;
    (document.getElementById('usageGemini') as HTMLElement).style.width = `${geminiPercent}%`;
  } catch {
    // Silently fail
  }
}

async function loadCacheStats(): Promise<void> {
  try {
    const data = await chrome.storage.local.get('jp_cache_index');
    const index = data['jp_cache_index'] || { keys: [] };
    document.getElementById('cacheCount')!.textContent = String(index.keys?.length || 0);
    document.getElementById('cacheSize')!.textContent = String(Math.round((index.keys?.length || 0) * 0.5));
  } catch {
    // Silently fail
  }
}

// ──────────────── Event Listeners ────────────────

function setupEventListeners(): void {
  // API key save
  document.getElementById('saveApiKeys')!.addEventListener('click', () => {
    saveSettings({
      papagoClientId: getInputValue('papagoClientId'),
      papagoClientSecret: getInputValue('papagoClientSecret'),
      claudeApiKey: getInputValue('claudeApiKey'),
      openaiApiKey: getInputValue('openaiApiKey'),
      geminiApiKey: getInputValue('geminiApiKey'),
    });
  });

  // API key visibility toggles
  setupPasswordToggle('togglePapagoId', 'papagoClientId');
  setupPasswordToggle('togglePapagoSecret', 'papagoClientSecret');
  setupPasswordToggle('toggleClaudeKey', 'claudeApiKey');
  setupPasswordToggle('toggleOpenaiKey', 'openaiApiKey');
  setupPasswordToggle('toggleGeminiKey', 'geminiApiKey');

  // Test buttons
  document.getElementById('testPapago')!.addEventListener('click', async () => {
    const resultEl = document.getElementById('papagoTestResult')!;
    resultEl.textContent = '테스트 중...';
    resultEl.className = 'test-result';

    const response = await chrome.runtime.sendMessage({
      type: 'TEST_PAPAGO',
      payload: {
        clientId: getInputValue('papagoClientId'),
        clientSecret: getInputValue('papagoClientSecret'),
      },
    });

    const result = response?.payload;
    resultEl.textContent = result?.message || '오류';
    resultEl.className = `test-result ${result?.success ? 'success' : 'error'}`;
  });

  document.getElementById('testClaude')!.addEventListener('click', async () => {
    const resultEl = document.getElementById('claudeTestResult')!;
    resultEl.textContent = '테스트 중...';
    resultEl.className = 'test-result';

    const response = await chrome.runtime.sendMessage({
      type: 'TEST_CLAUDE',
      payload: { apiKey: getInputValue('claudeApiKey') },
    });

    const result = response?.payload;
    resultEl.textContent = result?.message || '오류';
    resultEl.className = `test-result ${result?.success ? 'success' : 'error'}`;
  });

  document.getElementById('testOpenai')!.addEventListener('click', async () => {
    const resultEl = document.getElementById('openaiTestResult')!;
    resultEl.textContent = '테스트 중...';
    resultEl.className = 'test-result';

    const response = await chrome.runtime.sendMessage({
      type: 'TEST_OPENAI',
      payload: { apiKey: getInputValue('openaiApiKey') },
    });

    const result = response?.payload;
    resultEl.textContent = result?.message || '오류';
    resultEl.className = `test-result ${result?.success ? 'success' : 'error'}`;
  });

  document.getElementById('testGemini')!.addEventListener('click', async () => {
    const resultEl = document.getElementById('geminiTestResult')!;
    resultEl.textContent = '테스트 중...';
    resultEl.className = 'test-result';

    const response = await chrome.runtime.sendMessage({
      type: 'TEST_GEMINI',
      payload: { apiKey: getInputValue('geminiApiKey') },
    });

    const result = response?.payload;
    resultEl.textContent = result?.message || '오류';
    resultEl.className = `test-result ${result?.success ? 'success' : 'error'}`;
  });

  // Display settings
  setupRange('fontSize', 'fontSizeValue', (v) => {
    saveSettings({ fontSize: v });
    updatePreview();
  });
  setupRange('backgroundOpacity', 'opacityValue', (v) => {
    saveSettings({ backgroundOpacity: v });
    updatePreview();
  });

  for (const colorId of ['colorOriginal', 'colorFurigana', 'colorRomaji', 'colorTranslation'] as const) {
    document.getElementById(colorId)!.addEventListener('input', (e) => {
      const value = (e.target as HTMLInputElement).value;
      const hexLabel = document.querySelector(`.color-hex[data-for="${colorId}"]`);
      if (hexLabel) hexLabel.textContent = value.toUpperCase();
      saveSettings({ [colorId]: value });
      updatePreview();
    });
  }

  for (const colorId of ['inlineColorFurigana', 'inlineColorRomaji', 'inlineColorTranslation'] as const) {
    document.getElementById(colorId)!.addEventListener('input', (e) => {
      const value = (e.target as HTMLInputElement).value;
      const hexLabel = document.querySelector(`.color-hex[data-for="${colorId}"]`);
      if (hexLabel) hexLabel.textContent = value.toUpperCase();
      saveSettings({ [colorId]: value });
      updateInlinePreview();
    });
  }

  // Inline font scale ranges (float values)
  for (const rangeId of ['inlineFontScale', 'inlineFuriganaScale'] as const) {
    const labelId = rangeId + 'Value';
    const input = document.getElementById(rangeId) as HTMLInputElement;
    input.addEventListener('input', () => {
      document.getElementById(labelId)!.textContent = input.value;
    });
    input.addEventListener('change', () => {
      saveSettings({ [rangeId]: parseFloat(input.value) });
      updateInlinePreview();
    });
  }

  // Translation settings
  setupRange('complexityThreshold', 'thresholdValue', (v) => {
    saveSettings({ complexityThreshold: v });
  });
  setupRange('contextWindowSize', 'contextValue', (v) => {
    saveSettings({ contextWindowSize: v });
  });
  setupRange('keigoWeight', 'keigoValue', (v) => {
    saveSettings({ keigoWeight: v });
  });
  setupRange('lengthWeight', 'lengthValue', (v) => {
    saveSettings({ lengthWeight: v });
  });
  setupRange('idiomWeight', 'idiomValue', (v) => {
    saveSettings({ idiomWeight: v });
  });

  // LLM platform dropdown
  const platformSelect = document.getElementById('llmPlatform') as HTMLSelectElement;
  platformSelect.addEventListener('change', () => {
    const platform = platformSelect.value as LLMPlatform;
    populateModelDropdown(platform);
    const modelSelect = document.getElementById('llmModel') as HTMLSelectElement;
    saveSettings({ llmPlatform: platform, llmModel: modelSelect.value });
  });

  // LLM model dropdown
  const modelSelect = document.getElementById('llmModel') as HTMLSelectElement;
  modelSelect.addEventListener('change', () => {
    saveSettings({ llmModel: modelSelect.value });
  });

  // Glossary add
  document.getElementById('addGlossary')!.addEventListener('click', async () => {
    const jp = getInputValue('glossaryJp');
    const ko = getInputValue('glossaryKo');
    const note = getInputValue('glossaryNote');

    if (!jp || !ko) return;

    const data = await chrome.storage.local.get('jp_glossary_custom');
    const entries: GlossaryEntry[] = data['jp_glossary_custom'] || [];
    entries.push({ japanese: jp, korean: ko, note: note || undefined });
    await chrome.storage.local.set({ 'jp_glossary_custom': entries });

    // Clear inputs
    (document.getElementById('glossaryJp') as HTMLInputElement).value = '';
    (document.getElementById('glossaryKo') as HTMLInputElement).value = '';
    (document.getElementById('glossaryNote') as HTMLInputElement).value = '';

    loadCustomGlossary();
  });

  // Glossary import/export
  document.getElementById('importGlossary')!.addEventListener('click', () => {
    document.getElementById('glossaryFile')!.click();
  });

  document.getElementById('glossaryFile')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const text = await file.text();
    const lines = text.split('\n').filter((l) => l.trim());
    const data = await chrome.storage.local.get('jp_glossary_custom');
    const entries: GlossaryEntry[] = data['jp_glossary_custom'] || [];

    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
      if (parts.length >= 2) {
        entries.push({
          japanese: parts[0],
          korean: parts[1],
          note: parts[2] || undefined,
        });
      }
    }

    await chrome.storage.local.set({ 'jp_glossary_custom': entries });
    loadCustomGlossary();
  });

  document.getElementById('exportGlossary')!.addEventListener('click', async () => {
    const data = await chrome.storage.local.get('jp_glossary_custom');
    const entries: GlossaryEntry[] = data['jp_glossary_custom'] || [];
    const csv = entries
      .map((e) => `"${e.japanese}","${e.korean}","${e.note || ''}"`)
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jp-helper-glossary.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Cache clear
  document.getElementById('clearCache')!.addEventListener('click', async () => {
    if (!confirm('캐시를 전체 삭제하시겠습니까?')) return;
    await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
    loadCacheStats();
  });

  // Google Drive sync
  setupDriveListeners();
}

// ──────────────── Google Drive Sync ────────────────

const DRIVE_CLIENT_ID_KEY = 'jp_drive_client_id';

async function loadDriveClientId(): Promise<void> {
  const data = await chrome.storage.local.get(DRIVE_CLIENT_ID_KEY);
  const value = data[DRIVE_CLIENT_ID_KEY] || '';
  (document.getElementById('driveClientId') as HTMLInputElement).value = value;

  // Show redirect URI for GCP configuration
  const redirectUri = chrome.identity.getRedirectURL();
  (document.getElementById('driveRedirectUri') as HTMLInputElement).value = redirectUri;
}

async function loadDriveStatus(): Promise<void> {
  await loadDriveClientId();
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SYNC_GET_STATUS' });
    const status = resp?.payload as (DriveStatus & { lastSync?: number }) | undefined;

    const notConnected = document.getElementById('driveNotConnected')!;
    const connected = document.getElementById('driveConnected')!;

    if (status?.loggedIn) {
      notConnected.style.display = 'none';
      connected.style.display = '';
      document.getElementById('driveEmail')!.textContent = status.email || '';
      if (status.lastSync) {
        document.getElementById('lastSyncTime')!.textContent =
          `마지막 동기화: ${new Date(status.lastSync).toLocaleString('ko-KR')}`;
      }
    } else {
      notConnected.style.display = '';
      connected.style.display = 'none';
    }
  } catch {
    // Drive status check failed — leave default (not connected)
  }
}

function showSyncMessage(text: string, type: 'success' | 'error' | 'syncing'): void {
  const msg = document.getElementById('syncResultMsg')!;
  msg.textContent = text;
  msg.className = `sync-result ${type}`;
}

function setupDriveListeners(): void {
  // Client ID save & toggle
  setupPasswordToggle('toggleDriveClientId', 'driveClientId');

  document.getElementById('copyRedirectUri')!.addEventListener('click', () => {
    const input = document.getElementById('driveRedirectUri') as HTMLInputElement;
    navigator.clipboard.writeText(input.value);
    const btn = document.getElementById('copyRedirectUri')!;
    btn.textContent = '복사됨';
    setTimeout(() => { btn.textContent = '복사'; }, 1500);
  });

  document.getElementById('saveDriveClientId')!.addEventListener('click', async () => {
    const value = (document.getElementById('driveClientId') as HTMLInputElement).value.trim();
    await chrome.storage.local.set({ [DRIVE_CLIENT_ID_KEY]: value });
    const btn = document.getElementById('saveDriveClientId')!;
    btn.textContent = '저장됨';
    setTimeout(() => { btn.textContent = '저장'; }, 1500);
  });

  document.getElementById('driveLoginBtn')!.addEventListener('click', async () => {
    const btn = document.getElementById('driveLoginBtn') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '연결 중...';

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'DRIVE_LOGIN' });
      if (resp?.success) {
        await loadDriveStatus();
      } else {
        btn.textContent = 'Google 계정 연결';
        btn.disabled = false;
        showSyncMessage(resp?.message || '로그인 실패', 'error');
      }
    } catch {
      btn.textContent = 'Google 계정 연결';
      btn.disabled = false;
    }
  });

  document.getElementById('driveLogoutBtn')!.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'DRIVE_LOGOUT' });
    loadDriveStatus();
  });

  document.getElementById('syncNowBtn')!.addEventListener('click', async () => {
    showSyncMessage('동기화 중...', 'syncing');

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SYNC_PULL' });
      if (resp?.success) {
        const result = resp.payload as SyncResult;
        if (result.changed) {
          showSyncMessage(`동기화 완료: ${result.pulled}개 받음, ${result.pushed}개 보냄`, 'success');
        } else {
          showSyncMessage('이미 최신 상태입니다.', 'success');
        }
      } else {
        showSyncMessage(resp?.message || '동기화 실패', 'error');
      }
      await loadDriveStatus();
    } catch {
      showSyncMessage('동기화 중 오류 발생', 'error');
    }
  });
}

// ──────────────── Helpers ────────────────

function getInputValue(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value;
}

function setInputValue(id: string, value: string): void {
  (document.getElementById(id) as HTMLInputElement).value = value;
}

function setColorValue(id: string, value: string): void {
  (document.getElementById(id) as HTMLInputElement).value = value;
  const hexLabel = document.querySelector(`.color-hex[data-for="${id}"]`);
  if (hexLabel) hexLabel.textContent = value.toUpperCase();
}

function setRangeWithLabel(id: string, value: number, labelId: string): void {
  (document.getElementById(id) as HTMLInputElement).value = String(value);
  document.getElementById(labelId)!.textContent = String(value);
}

function setupRange(id: string, labelId: string, onChange: (value: number) => void): void {
  const input = document.getElementById(id) as HTMLInputElement;
  input.addEventListener('input', () => {
    document.getElementById(labelId)!.textContent = input.value;
  });
  input.addEventListener('change', () => {
    onChange(parseInt(input.value, 10));
  });
}

function setupPasswordToggle(btnId: string, inputId: string): void {
  document.getElementById(btnId)!.addEventListener('click', () => {
    const input = document.getElementById(inputId) as HTMLInputElement;
    const btn = document.getElementById(btnId)!;
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '숨김';
    } else {
      input.type = 'password';
      btn.textContent = '표시';
    }
  });
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ──────────────── Init ────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
});

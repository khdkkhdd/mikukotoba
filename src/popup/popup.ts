import type { UserSettings, LearningLevel, WebpageMode, LLMPlatform } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { getModelsForPlatform } from '@/core/translator/llm-registry';

let settings: UserSettings = { ...DEFAULT_SETTINGS };

const PLATFORM_LABELS: Record<LLMPlatform, string> = {
  claude: 'Claude',
  openai: 'GPT',
  gemini: 'Gemini',
};

// Learning level presets
const LEVEL_PRESETS: Record<LearningLevel, Partial<UserSettings>> = {
  beginner: { showFurigana: true, showRomaji: true, showTranslation: true },
  elementary: { showFurigana: true, showRomaji: false, showTranslation: true },
  intermediate: { showFurigana: true, showRomaji: false, showTranslation: true },
  advanced: { showFurigana: true, showRomaji: false, showTranslation: true },
};

// Estimated LLM usage ratio based on threshold
function estimateLLMRatio(threshold: number): number {
  // Rough estimate: lower threshold = more LLM usage
  if (threshold === 0) return 100;
  if (threshold >= 11) return 0;
  const ratios = [100, 85, 70, 55, 45, 35, 25, 15, 10, 5, 2];
  return ratios[threshold] ?? 0;
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
    // Select first model if current model doesn't belong to this platform
    modelSelect.value = models[0].id;
  }
}

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

function updateUI(): void {
  // Enable toggle
  const enableToggle = document.getElementById('enableToggle') as HTMLInputElement;
  enableToggle.checked = settings.enabled;

  // YouTube toggle (independent)
  const youtubeToggle = document.getElementById('youtubeToggle') as HTMLInputElement;
  youtubeToggle.checked = settings.youtubeMode;

  // Webpage mode radios
  const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="mode"]');
  for (const radio of modeRadios) {
    radio.checked = radio.value === settings.webpageMode;
  }

  // Learning level
  const levelSelect = document.getElementById('learningLevel') as HTMLSelectElement;
  levelSelect.value = settings.learningLevel;

  // Display checkboxes
  (document.getElementById('showFurigana') as HTMLInputElement).checked = settings.showFurigana;
  (document.getElementById('showTranslation') as HTMLInputElement).checked = settings.showTranslation;
  (document.getElementById('showRomaji') as HTMLInputElement).checked = settings.showRomaji;

  // Complexity slider
  const slider = document.getElementById('complexityThreshold') as HTMLInputElement;
  slider.value = String(settings.complexityThreshold);
  document.getElementById('thresholdValue')!.textContent = String(settings.complexityThreshold);
  document.getElementById('llmRatio')!.textContent = String(estimateLLMRatio(settings.complexityThreshold));

  // Platform/model display
  const platformLabel = PLATFORM_LABELS[settings.llmPlatform] || 'AI';
  document.getElementById('llmSliderLabel')!.textContent = platformLabel;
  document.getElementById('llmName')!.textContent = platformLabel;

  // LLM platform/model dropdowns
  const platformSelect = document.getElementById('llmPlatform') as HTMLSelectElement;
  platformSelect.value = settings.llmPlatform;
  populateModelDropdown(settings.llmPlatform, settings.llmModel);

  // API status indicators
  const papagoStatus = document.getElementById('papagoStatus')!;
  const claudeStatus = document.getElementById('claudeStatus')!;
  const openaiStatus = document.getElementById('openaiStatus')!;
  const geminiStatus = document.getElementById('geminiStatus')!;
  papagoStatus.className = `status-dot ${settings.papagoClientId ? 'on' : 'off'}`;
  claudeStatus.className = `status-dot ${settings.claudeApiKey ? 'on' : 'off'}`;
  openaiStatus.className = `status-dot ${settings.openaiApiKey ? 'on' : 'off'}`;
  geminiStatus.className = `status-dot ${settings.geminiApiKey ? 'on' : 'off'}`;
}

async function saveAndBroadcast(changes: Partial<UserSettings>): Promise<void> {
  settings = { ...settings, ...changes };
  await chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED', payload: changes });
  updateUI();
}

function setupEventListeners(): void {
  // Open options page
  document.getElementById('openOptions')!.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Enable toggle
  document.getElementById('enableToggle')!.addEventListener('change', (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', payload: { enabled } });
    settings.enabled = enabled;

    // Also notify the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'TOGGLE_ENABLED',
          payload: { enabled },
        }).catch(() => {});
      }
    });
  });

  // YouTube toggle (independent of webpage mode)
  document.getElementById('youtubeToggle')!.addEventListener('change', (e) => {
    const youtubeMode = (e.target as HTMLInputElement).checked;
    saveAndBroadcast({ youtubeMode });
  });

  // Webpage mode radios (independent of YouTube mode)
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const value = (e.target as HTMLInputElement).value as WebpageMode;
      saveAndBroadcast({ webpageMode: value });

      // Notify content script about mode change
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'MODE_CHANGED',
            payload: { mode: value },
          }).catch(() => {});
        }
      });
    });
  });

  // Learning level
  document.getElementById('learningLevel')!.addEventListener('change', (e) => {
    const level = (e.target as HTMLSelectElement).value as LearningLevel;
    const preset = LEVEL_PRESETS[level];
    saveAndBroadcast({ learningLevel: level, ...preset });
  });

  // Display checkboxes
  document.getElementById('showFurigana')!.addEventListener('change', (e) => {
    saveAndBroadcast({ showFurigana: (e.target as HTMLInputElement).checked });
  });
  document.getElementById('showTranslation')!.addEventListener('change', (e) => {
    saveAndBroadcast({ showTranslation: (e.target as HTMLInputElement).checked });
  });
  document.getElementById('showRomaji')!.addEventListener('change', (e) => {
    saveAndBroadcast({ showRomaji: (e.target as HTMLInputElement).checked });
  });

  // Complexity slider
  const slider = document.getElementById('complexityThreshold') as HTMLInputElement;
  slider.addEventListener('input', () => {
    const value = parseInt(slider.value, 10);
    document.getElementById('thresholdValue')!.textContent = String(value);
    document.getElementById('llmRatio')!.textContent = String(estimateLLMRatio(value));
  });
  slider.addEventListener('change', () => {
    saveAndBroadcast({ complexityThreshold: parseInt(slider.value, 10) });
  });

  // LLM platform dropdown
  const platformSelect = document.getElementById('llmPlatform') as HTMLSelectElement;
  platformSelect.addEventListener('change', () => {
    const platform = platformSelect.value as LLMPlatform;
    populateModelDropdown(platform);
    const modelSelect = document.getElementById('llmModel') as HTMLSelectElement;
    saveAndBroadcast({ llmPlatform: platform, llmModel: modelSelect.value });

    // Update labels
    const label = PLATFORM_LABELS[platform] || 'AI';
    document.getElementById('llmSliderLabel')!.textContent = label;
    document.getElementById('llmName')!.textContent = label;
  });

  // LLM model dropdown
  const modelSelect = document.getElementById('llmModel') as HTMLSelectElement;
  modelSelect.addEventListener('change', () => {
    saveAndBroadcast({ llmModel: modelSelect.value });
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
});

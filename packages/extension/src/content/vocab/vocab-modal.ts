import type { VocabEntry } from '@/types';
import type { VocabAutoFillResult } from './vocab-add-handler';
import { buildVocabEntry } from './vocab-add-handler';

let modalContainer: HTMLDivElement | null = null;

async function loadAllTags(): Promise<string[]> {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'VOCAB_GET_TAGS' });
    return resp?.payload ?? [];
  } catch {
    return [];
  }
}

export function showVocabModal(
  autoFill: VocabAutoFillResult | null,
  onSave: (entry: VocabEntry) => void,
): void {
  removeVocabModal();

  modalContainer = document.createElement('div');
  modalContainer.id = 'jp-vocab-modal-host';
  modalContainer.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647;';
  const shadow = modalContainer.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = getModalStyles();
  shadow.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'vm-overlay';

  const modal = document.createElement('div');
  modal.className = 'vm-modal';

  const isLoading = !autoFill;

  modal.innerHTML = `
    <div class="vm-header">단어장에 추가</div>
    ${isLoading ? `
      <div class="vm-loading">
        <span class="vm-spinner"></span> 분석 중...
      </div>
    ` : `
      <div class="vm-form">
        <label class="vm-label">단어
          <input class="vm-input" id="vm-word" value="${esc(autoFill.word)}">
        </label>
        <label class="vm-label">읽기 (히라가나)
          <input class="vm-input" id="vm-reading" value="${esc(autoFill.reading)}">
        </label>
        <label class="vm-label">뜻 (한국어)
          <input class="vm-input" id="vm-meaning" value="${esc(autoFill.meaning)}">
        </label>
        <label class="vm-label">품사
          <input class="vm-input" id="vm-pos" value="${esc(autoFill.pos)}">
        </label>
        <label class="vm-label">예문
          <input class="vm-input" id="vm-example" value="${esc(autoFill.exampleSentence)}">
        </label>
        <label class="vm-label">메모
          <input class="vm-input" id="vm-note" value="" placeholder="선택 입력">
        </label>
        <div class="vm-tag-section">
          <div class="vm-label">태그</div>
          <div class="vm-tag-chips" id="vm-tag-chips"></div>
          <div class="vm-tag-input-row">
            <input class="vm-input vm-tag-input" id="vm-tag-input" placeholder="태그 입력..." list="vm-tag-list">
            <datalist id="vm-tag-list"></datalist>
            <button class="vm-btn vm-btn-add-tag" id="vm-add-tag">+</button>
          </div>
        </div>
        <div class="vm-buttons">
          <button class="vm-btn vm-btn-cancel" id="vm-cancel">취소</button>
          <button class="vm-btn vm-btn-save" id="vm-save">저장</button>
        </div>
      </div>
    `}
  `;

  overlay.appendChild(modal);
  shadow.appendChild(overlay);
  document.body.appendChild(modalContainer);

  // Stop keyboard events from reaching the host page
  for (const evt of ['keydown', 'keyup', 'keypress'] as const) {
    modalContainer.addEventListener(evt, (e) => {
      if ((e as KeyboardEvent).key !== 'Escape') {
        e.stopPropagation();
      }
    });
  }

  // Event listeners
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) removeVocabModal();
  });

  if (!isLoading) {
    const selectedTags: string[] = ['community'];
    renderTagChips();

    // Load existing tags for autocomplete
    loadAllTags().then((tags) => {
      const datalist = shadow.getElementById('vm-tag-list');
      if (datalist) {
        datalist.innerHTML = tags.map(t => `<option value="${esc(t)}">`).join('');
      }
    });

    function renderTagChips(): void {
      const container = shadow.getElementById('vm-tag-chips')!;
      container.innerHTML = selectedTags.map((tag, i) =>
        `<span class="vm-tag-chip">${esc(tag)}<button class="vm-tag-remove" data-idx="${i}">&times;</button></span>`
      ).join('');
      container.querySelectorAll('.vm-tag-remove').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = parseInt((btn as HTMLElement).dataset.idx!);
          selectedTags.splice(idx, 1);
          renderTagChips();
        });
      });
    }

    function addTag(): void {
      const input = shadow.getElementById('vm-tag-input') as HTMLInputElement;
      const tag = input.value.trim();
      if (tag && !selectedTags.includes(tag)) {
        selectedTags.push(tag);
        renderTagChips();
      }
      input.value = '';
      input.focus();
    }

    shadow.getElementById('vm-add-tag')?.addEventListener('click', addTag);

    // Enter key in tag input adds tag
    shadow.getElementById('vm-tag-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag();
      }
    });

    const cancelBtn = shadow.getElementById('vm-cancel');
    const saveBtn = shadow.getElementById('vm-save');

    cancelBtn?.addEventListener('click', () => removeVocabModal());
    saveBtn?.addEventListener('click', () => {
      const entry = buildVocabEntry({
        word: (shadow.getElementById('vm-word') as HTMLInputElement).value.trim(),
        reading: (shadow.getElementById('vm-reading') as HTMLInputElement).value.trim(),
        romaji: autoFill.romaji,
        meaning: (shadow.getElementById('vm-meaning') as HTMLInputElement).value.trim(),
        pos: (shadow.getElementById('vm-pos') as HTMLInputElement).value.trim(),
        exampleSentence: (shadow.getElementById('vm-example') as HTMLInputElement).value.trim(),
        exampleSource: location.href,
        note: (shadow.getElementById('vm-note') as HTMLInputElement).value.trim(),
        tags: [...selectedTags],
      });
      onSave(entry);
      removeVocabModal();
    });

    // Focus word field and auto-select
    const wordInput = shadow.getElementById('vm-word') as HTMLInputElement;
    wordInput?.focus();
    wordInput?.select();

    // Focus trap: keep Tab within modal inputs
    const focusableEls = modal.querySelectorAll<HTMLElement>('input, button');
    const firstEl = focusableEls[0];
    const lastEl = focusableEls[focusableEls.length - 1];
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey && shadow.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && shadow.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    });

    // Escape key
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        removeVocabModal();
        document.removeEventListener('keydown', keyHandler);
      }
    };
    document.addEventListener('keydown', keyHandler);
  }
}

/**
 * Update the modal from loading state to filled state.
 */
export function updateVocabModal(
  autoFill: VocabAutoFillResult,
  onSave: (entry: VocabEntry) => void,
): void {
  // Just re-show with data
  showVocabModal(autoFill, onSave);
}

export function removeVocabModal(): void {
  modalContainer?.remove();
  modalContainer = null;
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getModalStyles(): string {
  return `
    .vm-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Noto Sans JP', sans-serif;
    }

    .vm-modal {
      background: #FFFFFF;
      border: 1px solid #DEE6EA;
      border-radius: 12px;
      padding: 20px 24px;
      min-width: 360px;
      max-width: 480px;
      width: 90vw;
      box-shadow: 0 8px 32px rgba(60, 100, 110, 0.15);
      color: #5A6570;
    }

    .vm-header {
      font-size: 16px;
      font-weight: 700;
      color: #2D3436;
      margin-bottom: 16px;
    }

    .vm-loading {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 20px 0;
      color: #8E9AA4;
      font-size: 14px;
    }

    .vm-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid #DEE6EA;
      border-top-color: #39C5BB;
      border-radius: 50%;
      animation: vm-spin 0.6s linear infinite;
    }

    @keyframes vm-spin {
      to { transform: rotate(360deg); }
    }

    .vm-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .vm-label {
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 11px;
      color: #8E9AA4;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .vm-input {
      background: #F2F7F7;
      border: 1px solid #DEE6EA;
      border-radius: 6px;
      padding: 8px 10px;
      color: #2D3436;
      font-size: 14px;
      outline: none;
      transition: border-color 150ms;
      font-family: inherit;
    }

    .vm-input:focus {
      border-color: #39C5BB;
    }

    .vm-tag-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .vm-tag-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .vm-tag-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(57, 197, 187, 0.15);
      color: #39C5BB;
      font-size: 12px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 12px;
    }

    .vm-tag-remove {
      background: none;
      border: none;
      color: #39C5BB;
      font-size: 14px;
      cursor: pointer;
      padding: 0 2px;
      line-height: 1;
    }

    .vm-tag-remove:hover {
      color: #C94040;
    }

    .vm-tag-input-row {
      display: flex;
      gap: 6px;
    }

    .vm-tag-input {
      flex: 1;
    }

    .vm-btn-add-tag {
      padding: 6px 12px;
      font-size: 16px;
      font-weight: 700;
      line-height: 1;
    }

    .vm-buttons {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 8px;
    }

    .vm-btn {
      padding: 8px 20px;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      font-weight: 600;
      transition: background 150ms;
    }

    .vm-btn-cancel {
      background: #EBF0F2;
      color: #5A6570;
    }

    .vm-btn-cancel:hover {
      background: #DEE6EA;
    }

    .vm-btn-save {
      background: #39C5BB;
      color: #FFFFFF;
    }

    .vm-btn-save:hover {
      background: #2EADA3;
    }
  `;
}

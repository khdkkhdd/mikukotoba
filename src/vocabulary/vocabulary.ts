import type { VocabEntry, VocabStorageIndex } from '@/types';

const INITIAL_LOAD_DAYS = 7;
const LOAD_MORE_DAYS = 7;

type QuizMode = 'normal' | 'hide-meaning' | 'hide-word';

let allDates: string[] = [];
let loadedDateCount = 0;
let searchQuery = '';
let quizMode: QuizMode = 'normal';

// ──────────────── Message helpers ────────────────

async function sendMessage<T>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

async function getIndex(): Promise<VocabStorageIndex> {
  const resp = await sendMessage<{ payload: VocabStorageIndex }>({ type: 'VOCAB_GET_INDEX' });
  return resp.payload;
}

async function getEntries(dates: string[]): Promise<Record<string, VocabEntry[]>> {
  const resp = await sendMessage<{ payload: Record<string, VocabEntry[]> }>({
    type: 'VOCAB_GET_ENTRIES',
    payload: { dates },
  });
  return resp.payload;
}

async function searchEntries(query: string): Promise<VocabEntry[]> {
  const resp = await sendMessage<{ payload: VocabEntry[] }>({
    type: 'VOCAB_SEARCH',
    payload: { query },
  });
  return resp.payload;
}

async function deleteEntry(id: string, date: string): Promise<void> {
  await sendMessage({ type: 'VOCAB_DELETE', payload: { id, date } });
}

async function updateEntry(entry: VocabEntry): Promise<void> {
  await sendMessage({ type: 'VOCAB_UPDATE', payload: entry });
}

async function exportAll(): Promise<VocabEntry[]> {
  const resp = await sendMessage<{ payload: VocabEntry[] }>({ type: 'VOCAB_EXPORT' });
  return resp.payload;
}

// ──────────────── Rendering ────────────────

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlightMatch(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const q = escapeHtml(query);
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(re, '<span class="search-match">$1</span>');
}

function quizHidden(visibleHtml: string): string {
  return `<span class="quiz-hidden"><span class="quiz-placeholder">클릭하여 확인</span><span class="quiz-answer">${visibleHtml}</span></span>`;
}

function renderEntry(entry: VocabEntry, query: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.dataset.id = entry.id;
  card.dataset.date = entry.dateAdded;

  const isQuiz = quizMode !== 'normal';
  if (isQuiz) card.classList.add('quiz-card');

  const hl = (text: string) => highlightMatch(text, query);

  const hideWord = quizMode === 'hide-word';
  const hideMeaning = quizMode === 'hide-meaning';

  const hideReading = hideWord || hideMeaning;
  const wordHtml = hideWord ? quizHidden(hl(entry.word)) : hl(entry.word);
  const readingHtml = hideReading ? quizHidden(hl(entry.reading)) : hl(entry.reading);
  const meaningHtml = hideMeaning ? quizHidden(hl(entry.meaning)) : hl(entry.meaning);

  let sourceHtml = '';
  if (entry.exampleSource && !isQuiz) {
    try {
      const url = new URL(entry.exampleSource);
      sourceHtml = `<div class="entry-source">출처: <a href="${escapeHtml(entry.exampleSource)}" target="_blank">${escapeHtml(url.hostname)}</a></div>`;
    } catch {
      sourceHtml = `<div class="entry-source">${escapeHtml(entry.exampleSource)}</div>`;
    }
  }

  // Hide example sentence in quiz modes (hint prevention)
  const showExample = !isQuiz && entry.exampleSentence;
  const showNote = !hideMeaning && entry.note;

  card.innerHTML = `
    <div class="entry-top">
      <span class="entry-word">${wordHtml}</span>
      <span class="entry-reading">${readingHtml}</span>
      ${entry.pos ? `<span class="entry-pos">${escapeHtml(entry.pos)}</span>` : ''}
    </div>
    <div class="entry-meaning">${meaningHtml}</div>
    ${showExample ? `<div class="entry-example">${hl(entry.exampleSentence!)}</div>` : ''}
    ${showNote ? `<div class="entry-note">${hl(entry.note!)}</div>` : ''}
    ${sourceHtml}
    ${!isQuiz ? `<div class="entry-actions">
      <button class="edit-btn">편집</button>
      <button class="delete-btn">삭제</button>
    </div>` : ''}
  `;

  if (!isQuiz) {
    // Delete button
    card.querySelector('.delete-btn')!.addEventListener('click', () => {
      showConfirmDelete(entry, card);
    });

    // Edit button
    card.querySelector('.edit-btn')!.addEventListener('click', () => {
      startInlineEdit(entry, card);
    });
  } else {
    // Quiz card click to reveal
    card.addEventListener('click', () => {
      card.classList.toggle('revealed');
    });
  }

  return card;
}

function renderDateGroup(date: string, entries: VocabEntry[], query: string): HTMLElement {
  const group = document.createElement('div');
  group.className = 'date-group';

  const header = document.createElement('div');
  header.className = 'date-header';
  header.innerHTML = `${date} <span class="date-count">${entries.length}개</span>`;
  group.appendChild(header);

  // Sort entries within date by timestamp descending
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
  for (const entry of sorted) {
    group.appendChild(renderEntry(entry, query));
  }

  return group;
}

// ──────────────── Inline edit ────────────────

function startInlineEdit(entry: VocabEntry, card: HTMLElement): void {
  card.classList.add('editing');

  const fields: Array<{ key: keyof VocabEntry; label: string }> = [
    { key: 'word', label: '단어' },
    { key: 'reading', label: '읽기' },
    { key: 'meaning', label: '뜻' },
    { key: 'pos', label: '품사' },
    { key: 'exampleSentence', label: '예문' },
    { key: 'note', label: '메모' },
  ];

  const editForm = document.createElement('div');
  editForm.className = 'edit-form';

  const inputs: Record<string, HTMLInputElement> = {};
  for (const f of fields) {
    const input = document.createElement('input');
    input.className = 'entry-edit-input';
    input.placeholder = f.label;
    input.value = String(entry[f.key] || '');
    inputs[f.key] = input;
    editForm.appendChild(input);
  }

  const btnRow = document.createElement('div');
  btnRow.className = 'entry-actions';
  btnRow.innerHTML = `
    <button class="save-edit-btn">저장</button>
    <button class="cancel-edit-btn">취소</button>
  `;
  editForm.appendChild(btnRow);

  // Replace card content
  const originalContent = card.innerHTML;
  card.innerHTML = '';
  card.appendChild(editForm);

  btnRow.querySelector('.cancel-edit-btn')!.addEventListener('click', () => {
    card.classList.remove('editing');
    card.innerHTML = originalContent;
    // Reattach listeners
    card.querySelector('.delete-btn')!.addEventListener('click', () => showConfirmDelete(entry, card));
    card.querySelector('.edit-btn')!.addEventListener('click', () => startInlineEdit(entry, card));
  });

  btnRow.querySelector('.save-edit-btn')!.addEventListener('click', async () => {
    const updated: VocabEntry = {
      ...entry,
      word: inputs.word.value.trim(),
      reading: inputs.reading.value.trim(),
      meaning: inputs.meaning.value.trim(),
      pos: inputs.pos.value.trim(),
      exampleSentence: inputs.exampleSentence.value.trim(),
      note: inputs.note.value.trim(),
    };
    await updateEntry(updated);
    card.classList.remove('editing');

    // Replace with updated rendered card
    const newCard = renderEntry(updated, searchQuery);
    card.replaceWith(newCard);
  });
}

// ──────────────── Confirm delete ────────────────

function showConfirmDelete(entry: VocabEntry, card: HTMLElement): void {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <p>"${escapeHtml(entry.word)}" 을(를) 삭제하시겠습니까?</p>
      <div class="confirm-buttons">
        <button class="btn" id="confirmCancel">취소</button>
        <button class="btn btn-danger" id="confirmDelete">삭제</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#confirmCancel')!.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#confirmDelete')!.addEventListener('click', async () => {
    await deleteEntry(entry.id, entry.dateAdded);
    card.remove();
    overlay.remove();

    // Update count
    const index = await getIndex();
    document.getElementById('totalCount')!.textContent = `${index.totalCount}개`;

    // Show empty state if nothing left
    if (index.totalCount === 0) {
      document.getElementById('emptyState')!.style.display = '';
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ──────────────── Main ────────────────

async function loadInitial(): Promise<void> {
  const index = await getIndex();
  document.getElementById('totalCount')!.textContent = `${index.totalCount}개`;
  allDates = index.dates;

  if (allDates.length === 0) {
    document.getElementById('emptyState')!.style.display = '';
    return;
  }

  document.getElementById('emptyState')!.style.display = 'none';
  await loadMoreDates(INITIAL_LOAD_DAYS);
}

async function loadMoreDates(count: number): Promise<void> {
  const datesToLoad = allDates.slice(loadedDateCount, loadedDateCount + count);
  if (datesToLoad.length === 0) return;

  const entriesByDate = await getEntries(datesToLoad);
  const content = document.getElementById('content')!;

  for (const date of datesToLoad) {
    const entries = entriesByDate[date] || [];
    if (entries.length > 0) {
      content.appendChild(renderDateGroup(date, entries, ''));
    }
  }

  loadedDateCount += datesToLoad.length;

  // Show/hide load more button
  const loadMoreWrap = document.getElementById('loadMoreWrap')!;
  loadMoreWrap.style.display = loadedDateCount < allDates.length ? '' : 'none';
}

async function performSearch(query: string): Promise<void> {
  searchQuery = query;
  const content = document.getElementById('content')!;

  // Clear existing content except empty state
  const emptyState = document.getElementById('emptyState')!;
  content.innerHTML = '';
  content.appendChild(emptyState);

  if (!query) {
    // Reset and reload
    loadedDateCount = 0;
    emptyState.style.display = allDates.length === 0 ? '' : 'none';
    await loadMoreDates(INITIAL_LOAD_DAYS);
    return;
  }

  const results = await searchEntries(query);
  if (results.length === 0) {
    emptyState.style.display = '';
    emptyState.querySelector('p')!.textContent = `"${query}"에 대한 결과가 없습니다.`;
    document.getElementById('loadMoreWrap')!.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  document.getElementById('loadMoreWrap')!.style.display = 'none';

  // Group by date
  const grouped: Record<string, VocabEntry[]> = {};
  for (const entry of results) {
    (grouped[entry.dateAdded] ||= []).push(entry);
  }

  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  for (const date of dates) {
    content.appendChild(renderDateGroup(date, grouped[date], query));
  }
}

// ──────────────── Export ────────────────

async function handleExport(): Promise<void> {
  const all = await exportAll();
  const json = JSON.stringify(all, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jp-vocab-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ──────────────── Import ────────────────

async function handleImport(): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const entries: VocabEntry[] = JSON.parse(text);
      if (!Array.isArray(entries)) {
        alert('올바른 JSON 형식이 아닙니다.');
        return;
      }
      // Validate at least first entry has required fields
      if (entries.length > 0 && (!entries[0].id || !entries[0].word)) {
        alert('단어장 형식이 올바르지 않습니다.');
        return;
      }
      const resp = await sendMessage<{ payload: { added: number } }>({
        type: 'VOCAB_IMPORT',
        payload: { entries },
      });
      alert(`${resp.payload.added}개의 단어를 가져왔습니다.`);
      if (resp.payload.added > 0) {
        // Reload page to show new entries
        allDates = [];
        loadedDateCount = 0;
        loadInitial();
      }
    } catch {
      alert('파일을 읽는 중 오류가 발생했습니다.');
    }
  });
  input.click();
}

// ──────────────── Quiz mode ────────────────

function reRenderAllCards(): void {
  if (searchQuery) {
    performSearch(searchQuery);
  } else {
    const content = document.getElementById('content')!;
    const emptyState = document.getElementById('emptyState')!;
    content.innerHTML = '';
    content.appendChild(emptyState);
    loadedDateCount = 0;
    if (allDates.length > 0) {
      emptyState.style.display = 'none';
      loadMoreDates(INITIAL_LOAD_DAYS);
    }
  }
}

function setQuizMode(mode: QuizMode): void {
  quizMode = mode;

  // Update button active state
  document.querySelectorAll('.quiz-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
  });

  reRenderAllCards();
}

// ──────────────── Init ────────────────

async function syncOnLoad(): Promise<void> {
  const indicator = document.getElementById('syncIndicator')!;

  try {
    // Check if logged in
    const statusResp = await sendMessage<{ payload: { loggedIn: boolean } }>({
      type: 'DRIVE_GET_STATUS',
    });

    if (!statusResp?.payload?.loggedIn) {
      indicator.className = 'sync-indicator';
      indicator.title = 'Drive 미연결';
      return;
    }

    indicator.className = 'sync-indicator syncing';
    indicator.title = '동기화 중...';

    const resp = await sendMessage<{ success: boolean; payload?: { changed: boolean } }>({
      type: 'SYNC_PULL',
    });

    if (resp?.success && resp.payload?.changed) {
      indicator.className = 'sync-indicator synced';
      indicator.title = '동기화 완료 (변경사항 적용됨)';
      // Reload data
      allDates = [];
      loadedDateCount = 0;
      await loadInitial();
    } else {
      indicator.className = 'sync-indicator synced';
      indicator.title = '최신 상태';
    }
  } catch {
    indicator.className = 'sync-indicator sync-error';
    indicator.title = '동기화 실패';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadInitial();
  syncOnLoad();

  // Quiz mode selector
  document.querySelectorAll('.quiz-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as QuizMode;
      setQuizMode(mode);
    });
  });

  // Search with debounce
  let searchTimer: ReturnType<typeof setTimeout>;
  document.getElementById('searchInput')!.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const query = (e.target as HTMLInputElement).value.trim();
    searchTimer = setTimeout(() => performSearch(query), 300);
  });

  // Load more
  document.getElementById('loadMoreBtn')!.addEventListener('click', () => {
    loadMoreDates(LOAD_MORE_DAYS);
  });

  // Import / Export
  document.getElementById('importBtn')!.addEventListener('click', handleImport);
  document.getElementById('exportBtn')!.addEventListener('click', handleExport);
});

/**
 * Floating status indicator for ミク言葉.
 * Shows current state: detecting → translating (N/M) → done / error.
 * Uses Shadow DOM for style isolation from host page.
 */

type Status = 'idle' | 'detecting' | 'translating' | 'done' | 'error';

interface StatusCounts {
  detected: number;
  translating: number;
  done: number;
  failed: number;
}

const STYLES = /* css */ `
  :host {
    all: initial;
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    pointer-events: auto;
  }

  .pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 20px;
    background: rgba(15, 15, 26, 0.92);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #ccc;
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    transition: opacity 0.3s, transform 0.3s;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
  }

  .pill:hover {
    background: rgba(20, 20, 36, 0.96);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .pill.hidden {
    opacity: 0;
    transform: translateY(8px);
    pointer-events: none;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot.idle      { background: #666; }
  .dot.detecting { background: #fbbc04; animation: pulse 1.2s infinite; }
  .dot.translating { background: #4a7dff; animation: pulse 0.8s infinite; }
  .dot.done      { background: #4caf50; }
  .dot.error     { background: #f44336; }

  .label {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .counts {
    color: #888;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
`;

export class StatusIndicator {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private pill: HTMLElement;
  private dot: HTMLElement;
  private label: HTMLElement;
  private countsEl: HTMLElement;

  private status: Status = 'idle';
  private counts: StatusCounts = { detected: 0, translating: 0, done: 0, failed: 0 };
  private mounted = false;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.host = document.createElement('mikukotoba-status');
    this.shadow = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLES;

    this.pill = document.createElement('div');
    this.pill.className = 'pill hidden';

    this.dot = document.createElement('span');
    this.dot.className = 'dot idle';

    this.label = document.createElement('span');
    this.label.className = 'label';
    this.label.textContent = 'ミク言葉';

    this.countsEl = document.createElement('span');
    this.countsEl.className = 'counts';

    this.pill.append(this.dot, this.label, this.countsEl);
    this.shadow.append(style, this.pill);

    // Click to toggle visibility (manual dismiss)
    this.pill.addEventListener('click', () => {
      this.pill.classList.add('hidden');
    });
  }

  mount(): void {
    if (this.mounted) return;
    document.documentElement.appendChild(this.host);
    this.mounted = true;
  }

  unmount(): void {
    if (!this.mounted) return;
    this.host.remove();
    this.mounted = false;
  }

  /** Reset all counts (e.g. on page navigation or mode switch) */
  reset(): void {
    this.counts = { detected: 0, translating: 0, done: 0, failed: 0 };
    this.setStatus('idle');
    this.render();
  }

  /** Japanese text blocks detected by TextDetector */
  detected(count: number): void {
    this.counts.detected += count;
    this.setStatus('detecting');
    this.render();
  }

  /** A block started translating */
  translating(): void {
    this.counts.translating++;
    this.setStatus('translating');
    this.render();
  }

  /** A block finished translating successfully */
  translated(): void {
    this.counts.translating = Math.max(0, this.counts.translating - 1);
    this.counts.done++;
    if (this.counts.translating === 0) {
      this.setStatus(this.counts.failed > 0 ? 'error' : 'done');
    }
    this.render();
  }

  /** A block failed to translate */
  failed(): void {
    this.counts.translating = Math.max(0, this.counts.translating - 1);
    this.counts.failed++;
    if (this.counts.translating === 0) {
      this.setStatus('error');
    }
    this.render();
  }

  private setStatus(status: Status): void {
    this.status = status;

    // Cancel any pending fade
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }

    // Show pill
    this.pill.classList.remove('hidden');

    // Auto-hide after completion
    if (status === 'done') {
      this.fadeTimer = setTimeout(() => {
        this.pill.classList.add('hidden');
      }, 4000);
    }
  }

  private render(): void {
    // Dot
    this.dot.className = `dot ${this.status}`;

    // Label
    const labels: Record<Status, string> = {
      idle: 'ミク言葉',
      detecting: '일본어 감지',
      translating: '번역 중',
      done: '번역 완료',
      error: '번역 오류',
    };
    this.label.textContent = labels[this.status];

    // Counts
    const { detected, translating, done, failed } = this.counts;
    const total = done + failed + translating;
    switch (this.status) {
      case 'detecting':
        this.countsEl.textContent = `(${detected})`;
        break;
      case 'translating':
        this.countsEl.textContent = `(${done}/${total})`;
        break;
      case 'done':
        this.countsEl.textContent = `(${done})`;
        break;
      case 'error':
        this.countsEl.textContent = `(${done}/${total}, ${failed} fail)`;
        break;
      default:
        this.countsEl.textContent = '';
    }
  }
}

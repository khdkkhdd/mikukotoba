import type { Card } from 'ts-fsrs';
import { State } from 'ts-fsrs';
import type { VocabEntry } from '@mikukotoba/shared';

// --- 타입 ---

export interface StudyItem {
  vocabId: string;
  card: Card;
  entry: VocabEntry;
}

interface WaitingItem {
  item: StudyItem;
  dueAt: number; // ms timestamp
}

export interface SessionState {
  learningQueue: StudyItem[];
  waitingQueue: WaitingItem[]; // dueAt 오름차순
  reviewQueue: StudyItem[];
  newQueue: StudyItem[];
  reviewsSinceLastNew: number;
}

export type SessionView =
  | { type: 'card'; item: StudyItem; source: 'learning' | 'review' | 'new' }
  | { type: 'waiting'; nextDueMs: number }
  | { type: 'complete' };

export interface SessionCounts {
  newCount: number;
  learningCount: number; // learning + waiting
  reviewCount: number;
}

// --- 순수 함수 ---

const NEW_INTERLEAVE_INTERVAL = 5;

export function createSession(
  dueCards: { item: StudyItem; isLearning: boolean }[],
  newCards: StudyItem[]
): SessionState {
  const learningQueue: StudyItem[] = [];
  const reviewQueue: StudyItem[] = [];

  for (const { item, isLearning } of dueCards) {
    if (isLearning) {
      learningQueue.push(item);
    } else {
      reviewQueue.push(item);
    }
  }

  return {
    learningQueue,
    waitingQueue: [],
    reviewQueue,
    newQueue: newCards,
    reviewsSinceLastNew: 0,
  };
}

export function selectNextCard(state: SessionState, now: number): SessionView {
  // 1. waiting → learning 승격
  const promoted = promoteWaiting(state, now);

  // 2. learning 우선
  if (promoted.learningQueue.length > 0) {
    return { type: 'card', item: promoted.learningQueue[0], source: 'learning' };
  }

  // 3. review 인터리빙 new
  const shouldShowNew =
    promoted.newQueue.length > 0 &&
    (promoted.reviewQueue.length === 0 ||
      promoted.reviewsSinceLastNew >= NEW_INTERLEAVE_INTERVAL);

  if (shouldShowNew) {
    return { type: 'card', item: promoted.newQueue[0], source: 'new' };
  }

  if (promoted.reviewQueue.length > 0) {
    return { type: 'card', item: promoted.reviewQueue[0], source: 'review' };
  }

  // new만 남은 경우
  if (promoted.newQueue.length > 0) {
    return { type: 'card', item: promoted.newQueue[0], source: 'new' };
  }

  // 4. waiting이 있으면 대기
  if (promoted.waitingQueue.length > 0) {
    return { type: 'waiting', nextDueMs: promoted.waitingQueue[0].dueAt };
  }

  // 5. 완료
  return { type: 'complete' };
}

export function applyGrade(
  state: SessionState,
  vocabId: string,
  nextCard: Card,
  source: 'learning' | 'review' | 'new',
  now: number
): SessionState {
  let { learningQueue, waitingQueue, reviewQueue, newQueue, reviewsSinceLastNew } = state;

  // 소스 큐에서 제거
  switch (source) {
    case 'learning':
      learningQueue = learningQueue.filter((i) => i.vocabId !== vocabId);
      break;
    case 'review':
      reviewQueue = reviewQueue.filter((i) => i.vocabId !== vocabId);
      reviewsSinceLastNew += 1;
      break;
    case 'new':
      newQueue = newQueue.filter((i) => i.vocabId !== vocabId);
      reviewsSinceLastNew = 0;
      break;
  }

  // 원본 entry 찾기
  const originalItem =
    state.learningQueue.find((i) => i.vocabId === vocabId) ??
    state.reviewQueue.find((i) => i.vocabId === vocabId) ??
    state.newQueue.find((i) => i.vocabId === vocabId);

  if (!originalItem) {
    return { learningQueue, waitingQueue, reviewQueue, newQueue, reviewsSinceLastNew };
  }

  const updatedItem: StudyItem = { ...originalItem, card: nextCard };

  // Learning/Relearning → waiting 또는 learning에 삽입
  // Review/완료 → 세션에서 제거
  if (nextCard.state === State.Learning || nextCard.state === State.Relearning) {
    const dueMs = nextCard.due.getTime();
    if (dueMs <= now) {
      // 즉시 재출현
      learningQueue = [...learningQueue, updatedItem];
    } else {
      // waiting에 삽입 (dueAt 오름차순 유지)
      const newWaiting: WaitingItem = { item: updatedItem, dueAt: dueMs };
      waitingQueue = insertSorted([...waitingQueue], newWaiting);
    }
  }
  // Review/New 상태로 졸업한 카드는 세션에서 제거됨

  return { learningQueue, waitingQueue, reviewQueue, newQueue, reviewsSinceLastNew };
}

export function promoteWaiting(state: SessionState, now: number): SessionState {
  const { waitingQueue, learningQueue } = state;
  if (waitingQueue.length === 0 || waitingQueue[0].dueAt > now) {
    return state;
  }

  const promoted: StudyItem[] = [];
  let splitIdx = 0;
  for (let i = 0; i < waitingQueue.length; i++) {
    if (waitingQueue[i].dueAt <= now) {
      promoted.push(waitingQueue[i].item);
      splitIdx = i + 1;
    } else {
      break;
    }
  }

  return {
    ...state,
    learningQueue: [...learningQueue, ...promoted],
    waitingQueue: waitingQueue.slice(splitIdx),
  };
}

export function getCounts(state: SessionState): SessionCounts {
  return {
    newCount: state.newQueue.length,
    learningCount: state.learningQueue.length + state.waitingQueue.length,
    reviewCount: state.reviewQueue.length,
  };
}

export function getNextWaitingTime(state: SessionState): number | null {
  return state.waitingQueue.length > 0 ? state.waitingQueue[0].dueAt : null;
}

// --- 헬퍼 ---

function insertSorted(queue: WaitingItem[], item: WaitingItem): WaitingItem[] {
  let idx = queue.length;
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].dueAt > item.dueAt) {
      idx = i;
      break;
    }
  }
  queue.splice(idx, 0, item);
  return queue;
}

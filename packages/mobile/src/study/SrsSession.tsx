import { View, Text, Pressable, StyleSheet, AppState, Alert } from 'react-native';
import { useEffect, useReducer, useRef, useCallback } from 'react';
import { State as FsrsState } from 'ts-fsrs';
import type { Card, Grade } from 'ts-fsrs';
import { useDatabase } from '../components/DatabaseContext';
import { useSettingsStore } from '../stores/settings-store';
import { computeReview, getSchedulingPreview, Rating, saveCardState } from '../fsrs';
import { getDueCardsWithEntries, getNewCardsWithEntries, getTodayNewCardCount } from '../db/queries';
import { markFsrsDirty, markReviewLogDirty } from '../services/sync-manager';
import { StudyCard } from './StudyCard';
import {
  createSession,
  selectNextCard,
  applyGrade,
  promoteWaiting,
  getCounts,
  getNextWaitingTime,
  type SessionState,
  type StudyItem,
} from './study-session';
import { colors, spacing, fontSize } from '../components/theme';

// --- Reducer ---

interface StudyViewState {
  session: SessionState | null;
  showAnswer: boolean;
  showReadingHint: boolean;
  showExampleHint: boolean;
  stats: { reviewed: number; correct: number };
  isLoading: boolean;
}

type StudyAction =
  | { type: 'INIT'; session: SessionState }
  | { type: 'GRADE'; vocabId: string; nextCard: Card; source: 'learning' | 'review' | 'new'; grade: Grade }
  | { type: 'TICK' }
  | { type: 'SHOW_ANSWER' }
  | { type: 'TOGGLE_READING_HINT' }
  | { type: 'TOGGLE_EXAMPLE_HINT' };

function studyReducer(state: StudyViewState, action: StudyAction): StudyViewState {
  const now = Date.now();

  switch (action.type) {
    case 'INIT':
      return {
        ...state,
        session: action.session,
        showAnswer: false,
        showReadingHint: false,
        showExampleHint: false,
        isLoading: false,
      };

    case 'GRADE': {
      if (!state.session) return state;
      const nextSession = applyGrade(
        state.session,
        action.vocabId,
        action.nextCard,
        action.source,
        now
      );
      return {
        ...state,
        session: nextSession,
        showAnswer: false,
        showReadingHint: false,
        showExampleHint: false,
        stats: {
          reviewed: state.stats.reviewed + 1,
          correct: action.grade >= Rating.Good ? state.stats.correct + 1 : state.stats.correct,
        },
      };
    }

    case 'TICK': {
      if (!state.session) return state;
      const promoted = promoteWaiting(state.session, now);
      if (promoted === state.session) return state; // 리렌더링 방지
      return { ...state, session: promoted };
    }

    case 'SHOW_ANSWER':
      return { ...state, showAnswer: true };

    case 'TOGGLE_READING_HINT':
      return { ...state, showReadingHint: !state.showReadingHint };

    case 'TOGGLE_EXAMPLE_HINT':
      return { ...state, showExampleHint: !state.showExampleHint };
  }
}

const initialState: StudyViewState = {
  session: null,
  showAnswer: false,
  showReadingHint: false,
  showExampleHint: false,
  stats: { reviewed: 0, correct: 0 },
  isLoading: true,
};

// --- 컴포넌트 ---

interface SrsSessionProps {
  onExit: () => void;
  onStartRelay?: () => void;
}

export function SrsSession({ onExit, onStartRelay }: SrsSessionProps) {
  const database = useDatabase();
  const dailyNewCards = useSettingsStore((s) => s.dailyNewCards);
  const [state, dispatch] = useReducer(studyReducer, initialState);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gradingRef = useRef(false);

  // 세션 초기화
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // 오늘 이미 학습한 새 카드 수를 차감하여 일일 한도 유지
      const todayNew = await getTodayNewCardCount(database);
      const remainingNew = Math.max(0, dailyNewCards - todayNew);

      const [dueResults, newResults] = await Promise.all([
        getDueCardsWithEntries(database),
        getNewCardsWithEntries(database, remainingNew),
      ]);

      if (cancelled) return;

      const dueCards = dueResults.map(({ entry, card }) => ({
        item: { vocabId: entry.id, card, entry } as StudyItem,
        isLearning:
          card.state === FsrsState.Learning || card.state === FsrsState.Relearning,
      }));

      const newCards = newResults.map(
        ({ entry, card }) => ({ vocabId: entry.id, card, entry }) as StudyItem
      );

      dispatch({ type: 'INIT', session: createSession(dueCards, newCards) });
    }

    init();
    return () => { cancelled = true; };
  }, [database, dailyNewCards]);

  // 동적 setTimeout — waiting 타이머
  useEffect(() => {
    if (!state.session) return;

    const nextDue = getNextWaitingTime(state.session);
    if (nextDue === null) return;

    const delay = Math.max(0, nextDue - Date.now());
    timerRef.current = setTimeout(() => {
      dispatch({ type: 'TICK' });
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.session?.waitingQueue]);

  // AppState 복귀 시 TICK
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        dispatch({ type: 'TICK' });
      }
    });
    return () => sub.remove();
  }, []);

  const handleGrade = useCallback(
    async (grade: Grade, item: StudyItem, source: 'learning' | 'review' | 'new') => {
      if (gradingRef.current) return;
      gradingRef.current = true;

      const now = new Date();
      const { nextCard } = computeReview(item.card, grade, now);

      // 동기 UI 업데이트
      dispatch({ type: 'GRADE', vocabId: item.vocabId, nextCard, source, grade });

      // 다음 프레임까지 이중 탭 방지
      requestAnimationFrame(() => { gradingRef.current = false; });

      // 비동기 DB 저장 — 성공 시에만 dirty 마킹
      try {
        await saveCardState(database, item.vocabId, nextCard, now, grade);
        markFsrsDirty();
        markReviewLogDirty();
      } catch (e) {
        console.error('[SRS] Failed to save card state:', e);
      }
    },
    [database]
  );

  const handleHeaderExit = useCallback(() => {
    if (!state.session) return onExit();
    const v = selectNextCard(state.session, Date.now());
    if (v.type === 'complete') return onExit();
    Alert.alert(
      '학습을 중단할까요?',
      '진행한 내용은 저장됩니다.',
      [
        { text: '계속 학습', style: 'cancel' },
        { text: '중단하기', style: 'destructive', onPress: onExit },
      ],
    );
  }, [state.session, onExit]);

  // --- 렌더링 ---

  if (state.isLoading || !state.session) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>카드 준비 중...</Text>
      </View>
    );
  }

  const now = Date.now();
  const view = selectNextCard(state.session, now);
  const counts = getCounts(state.session);

  // 대기 화면
  if (view.type === 'waiting') {
    const remainSec = Math.max(0, Math.ceil((view.nextDueMs - now) / 1000));
    const min = Math.floor(remainSec / 60);
    const sec = remainSec % 60;
    return (
      <View style={styles.container}>
        <SessionHeader title="오늘의 학습" onClose={handleHeaderExit} />
        <CountBar counts={counts} />
        <View style={styles.waitingCard}>
          <Text style={styles.waitingIcon}>⏳</Text>
          <Text style={styles.waitingTitle}>다음 카드 대기 중</Text>
          <Text style={styles.waitingTime}>
            {min > 0 ? `${min}분 ` : ''}{sec}초 후
          </Text>
        </View>
        <Pressable style={styles.exitButton} onPress={onExit}>
          <Text style={styles.exitText}>학습 종료</Text>
        </Pressable>
      </View>
    );
  }

  // 완료 화면
  if (view.type === 'complete') {
    return (
      <View style={styles.container}>
        <SessionHeader title="오늘의 학습" onClose={onExit} />
        <View style={styles.completeCard}>
          <Text style={styles.completeIcon}>🎉</Text>
          <Text style={styles.completeTitle}>학습 완료!</Text>
          <Text style={styles.completeStats}>
            {state.stats.reviewed}개 복습 / {state.stats.correct}개 정답
          </Text>
          <View style={styles.completeButtons}>
            <Pressable style={styles.exitButton} onPress={onExit}>
              <Text style={styles.exitText}>돌아가기</Text>
            </Pressable>
            {onStartRelay && (
              <Pressable style={styles.relayButton} onPress={onStartRelay}>
                <Text style={styles.relayButtonText}>자유 복습 →</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    );
  }

  // 카드 표시
  const { item } = view;
  const preview = state.showAnswer ? getSchedulingPreview(item.card) : [];

  return (
    <View style={styles.container}>
      <SessionHeader title="오늘의 학습" onClose={handleHeaderExit} />
      <CountBar counts={counts} />

      <View style={styles.cardArea}>
        <StudyCard
          entry={item.entry}
          showAnswer={state.showAnswer}
          showReadingHint={state.showReadingHint}
          showExampleHint={state.showExampleHint}
          onToggleReadingHint={() => dispatch({ type: 'TOGGLE_READING_HINT' })}
          onToggleExampleHint={() => dispatch({ type: 'TOGGLE_EXAMPLE_HINT' })}
          onRevealAnswer={() => dispatch({ type: 'SHOW_ANSWER' })}
        />
      </View>

      {state.showAnswer && (
        <View style={styles.gradeButtons}>
          {preview.map(({ grade, interval }) => (
            <GradeButton
              key={grade}
              grade={grade}
              interval={interval}
              onPress={() => handleGrade(grade, item, view.source)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// --- 하위 컴포넌트 ---

function SessionHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={styles.sessionHeader}>
      <Pressable style={styles.closeButton} onPress={onClose} hitSlop={8}>
        <Text style={styles.closeText}>✕ 종료</Text>
      </Pressable>
      <Text style={styles.sessionTitle}>{title}</Text>
      <View style={styles.closeButton} />
    </View>
  );
}

function CountBar({ counts }: { counts: { newCount: number; learningCount: number; reviewCount: number } }) {
  return (
    <View style={styles.countBar}>
      <View style={styles.countItem}>
        <View style={[styles.countDot, { backgroundColor: colors.accent }]} />
        <Text style={[styles.countLabel, { color: colors.accent }]}>N:{counts.newCount}</Text>
      </View>
      <View style={styles.countItem}>
        <View style={[styles.countDot, { backgroundColor: colors.warning }]} />
        <Text style={[styles.countLabel, { color: colors.warning }]}>L:{counts.learningCount}</Text>
      </View>
      <View style={styles.countItem}>
        <View style={[styles.countDot, { backgroundColor: colors.success }]} />
        <Text style={[styles.countLabel, { color: colors.success }]}>R:{counts.reviewCount}</Text>
      </View>
    </View>
  );
}

const GRADE_CONFIG: Record<number, { label: string; color: string }> = {
  [Rating.Again]: { label: 'Again', color: colors.danger },
  [Rating.Hard]: { label: 'Hard', color: colors.warning },
  [Rating.Good]: { label: 'Good', color: colors.success },
  [Rating.Easy]: { label: 'Easy', color: colors.accent },
};

function GradeButton({
  grade,
  interval,
  onPress,
}: {
  grade: Grade;
  interval: string;
  onPress: () => void;
}) {
  const config = GRADE_CONFIG[grade];
  return (
    <Pressable
      style={({ pressed }) => [
        styles.gradeBtn,
        { borderColor: config.color },
        pressed && { backgroundColor: config.color + '20' },
      ]}
      onPress={onPress}
    >
      <Text style={[styles.gradeLabel, { color: config.color }]}>{config.label}</Text>
      <Text style={styles.gradeInterval}>{interval}</Text>
    </Pressable>
  );
}

// --- 스타일 ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: 60,
  },
  loadingText: {
    textAlign: 'center',
    fontSize: fontSize.md,
    color: colors.textMuted,
    marginTop: 100,
  },
  countBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  countItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  countDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  countLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  cardArea: {
    flex: 1,
    marginBottom: spacing.lg,
  },
  gradeButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  gradeBtn: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  gradeLabel: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  gradeInterval: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  waitingCard: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  waitingIcon: { fontSize: 64, marginBottom: spacing.lg },
  waitingTitle: {
    fontSize: fontSize.xl,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  waitingTime: {
    fontSize: fontSize.lg,
    color: colors.textSecondary,
  },
  completeCard: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  completeIcon: { fontSize: 64, marginBottom: spacing.lg },
  completeTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  completeStats: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  closeButton: {
    minWidth: 60,
  },
  closeText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  sessionTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  completeButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  exitButton: {
    backgroundColor: colors.borderLight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  exitText: { fontSize: fontSize.md, color: colors.text },
  relayButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  relayButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useDatabase } from '../components/DatabaseContext';
import { getRandomEntriesByDateRange, getDateRange, getCountByDateRange, getDateGroups } from '../db/queries';
import { Calendar, type CalendarMarking } from '../components/Calendar';
import { StudyCard } from './StudyCard';
import type { VocabEntry } from '@mikukotoba/shared';
import { colors, spacing, fontSize } from '../components/theme';

const BATCH_SIZE = 50;

interface RelaySessionProps {
  onExit: () => void;
}

type RelayPhase = 'date-select' | 'studying';

function fmtToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function monthStart(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export function RelaySession({ onExit }: RelaySessionProps) {
  const database = useDatabase();
  const [phase, setPhase] = useState<RelayPhase>('date-select');

  // 날짜 선택
  const [dateMin, setDateMin] = useState('');
  const [dateMax, setDateMax] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [isLoadingDates, setIsLoadingDates] = useState(true);
  const [dateGroups, setDateGroups] = useState<{ date: string; count: number }[]>([]);

  // 학습
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showReadingHint, setShowReadingHint] = useState(false);
  const [showExampleHint, setShowExampleHint] = useState(false);
  const [viewedCount, setViewedCount] = useState(0);

  // 캘린더 마킹 데이터
  const markings = useMemo<CalendarMarking>(() => {
    const m: CalendarMarking = {};
    for (const g of dateGroups) {
      m[g.date] = { dotCount: g.count >= 10 ? 3 : g.count >= 5 ? 2 : 1 };
    }
    return m;
  }, [dateGroups]);

  // 날짜 범위 + 그룹 로드
  useEffect(() => {
    async function load() {
      const [range, groups] = await Promise.all([
        getDateRange(database),
        getDateGroups(database),
      ]);
      setDateGroups(groups);
      if (range) {
        setDateMin(range.min);
        setDateMax(range.max);
        setStartDate(range.min);
        setEndDate(range.max);
        const count = await getCountByDateRange(database, range.min, range.max);
        setTotalCount(count);
      }
      setIsLoadingDates(false);
    }
    load();
  }, [database]);

  // 날짜 변경 시 카운트 업데이트
  const updateCount = useCallback(async (start: string, end: string) => {
    if (!start || !end) {
      setTotalCount(0);
      return;
    }
    const count = await getCountByDateRange(database, start, end);
    setTotalCount(count);
  }, [database]);

  // 캘린더 범위 선택 핸들러
  const handleRangeSelect = useCallback((start: string, end: string | null) => {
    setStartDate(start);
    if (end) {
      setEndDate(end);
      updateCount(start, end);
    } else {
      setEndDate('');
      setTotalCount(0);
    }
  }, [updateCount]);

  // 프리셋 선택
  const handlePreset = useCallback((start: string, end: string) => {
    const clampedStart = start < dateMin ? dateMin : start;
    const clampedEnd = end > dateMax ? dateMax : end;
    setStartDate(clampedStart);
    setEndDate(clampedEnd);
    updateCount(clampedStart, clampedEnd);
  }, [dateMin, dateMax, updateCount]);

  // 배치 로드
  const loadBatch = useCallback(async () => {
    const batch = await getRandomEntriesByDateRange(database, startDate, endDate, BATCH_SIZE);
    setEntries(batch);
    setCurrentIndex(0);
    setShowAnswer(false);
    setShowReadingHint(false);
    setShowExampleHint(false);
  }, [database, startDate, endDate]);

  // 학습 시작
  const handleStart = useCallback(async () => {
    await loadBatch();
    setPhase('studying');
    setViewedCount(0);
  }, [loadBatch]);

  // 다음 카드
  const handleNext = useCallback(async () => {
    setViewedCount((c) => c + 1);
    const nextIdx = currentIndex + 1;
    if (nextIdx < entries.length) {
      setCurrentIndex(nextIdx);
      setShowAnswer(false);
      setShowReadingHint(false);
      setShowExampleHint(false);
    } else {
      await loadBatch();
    }
  }, [currentIndex, entries.length, loadBatch]);

  const today = fmtToday();
  const hasRange = startDate && endDate;

  // --- 날짜 선택 화면 ---
  if (phase === 'date-select') {
    if (isLoadingDates) {
      return (
        <View style={styles.container}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      );
    }

    if (!dateMin) {
      return (
        <View style={styles.container}>
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>단어가 없습니다</Text>
            <Pressable style={styles.backButton} onPress={onExit}>
              <Text style={styles.backText}>돌아가기</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>자유 복습</Text>
        <Text style={styles.subtitle}>날짜 범위를 선택하세요</Text>

        <Calendar
          mode="range"
          startDate={hasRange ? startDate : undefined}
          endDate={hasRange ? endDate : undefined}
          onSelectRange={handleRangeSelect}
          markings={markings}
        />

        {/* 빠른 선택 프리셋 */}
        <View style={styles.presetRow}>
          <PresetChip label="최근 7일" onPress={() => handlePreset(daysAgo(6), today)} />
          <PresetChip label="최근 30일" onPress={() => handlePreset(daysAgo(29), today)} />
          <PresetChip label="이번 달" onPress={() => handlePreset(monthStart(), today)} />
          <PresetChip label="전체" onPress={() => handlePreset(dateMin, dateMax)} />
        </View>

        <Text style={styles.countText}>
          {hasRange ? `총 ${totalCount}개 단어` : '종료일을 선택하세요'}
        </Text>

        <View style={styles.bottomButtons}>
          <Pressable
            style={[styles.startButton, (!hasRange || totalCount === 0) && styles.startButtonDisabled]}
            onPress={handleStart}
            disabled={!hasRange || totalCount === 0}
          >
            <Text style={styles.startText}>시작하기</Text>
          </Pressable>
          <Pressable style={styles.backButton} onPress={onExit}>
            <Text style={styles.backText}>돌아가기</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // --- 학습 화면 ---
  if (entries.length === 0) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const current = entries[currentIndex];

  return (
    <View style={styles.container}>
      <View style={styles.sessionHeader}>
        <Pressable style={styles.closeButton} onPress={onExit} hitSlop={8}>
          <Text style={styles.closeText}>✕ 종료</Text>
        </Pressable>
        <Text style={styles.sessionTitle}>자유 복습</Text>
        <View style={styles.closeButton} />
      </View>

      <View style={styles.relayHeader}>
        <Text style={styles.relayCount}>
          {viewedCount + 1}번째 카드 · 총 {totalCount}개
        </Text>
      </View>

      <View style={styles.cardArea}>
        <StudyCard
          entry={current}
          showAnswer={showAnswer}
          showReadingHint={showReadingHint}
          showExampleHint={showExampleHint}
          onToggleReadingHint={() => setShowReadingHint((v) => !v)}
          onToggleExampleHint={() => setShowExampleHint((v) => !v)}
          onRevealAnswer={() => setShowAnswer(true)}
          borderColor={colors.warning}
        />
      </View>

      {showAnswer && (
        <View style={styles.bottomButtons}>
          <Pressable style={styles.nextButton} onPress={handleNext}>
            <Text style={styles.nextText}>다음 →</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function PresetChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.presetChip, pressed && styles.presetChipPressed]}
      onPress={onPress}
    >
      <Text style={styles.presetText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: 60,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  presetRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    flexWrap: 'wrap',
  },
  presetChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 16,
    backgroundColor: colors.borderLight,
  },
  presetChipPressed: {
    backgroundColor: colors.accentLight,
  },
  presetText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  countText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.accent,
    textAlign: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  bottomButtons: {
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  startButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: 12,
    alignItems: 'center',
  },
  startButtonDisabled: {
    opacity: 0.5,
  },
  startText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  backButton: {
    backgroundColor: colors.borderLight,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  backText: { fontSize: fontSize.md, color: colors.text },
  emptyCard: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
  emptyText: {
    fontSize: fontSize.lg,
    color: colors.textMuted,
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
  relayHeader: {
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  relayCount: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  cardArea: {
    flex: 1,
    marginBottom: spacing.lg,
  },
  nextButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: 12,
    alignItems: 'center',
  },
  nextText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

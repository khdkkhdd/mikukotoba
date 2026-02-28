import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useDatabase } from '../components/DatabaseContext';
import { getDateRange, getDateGroups, getAllTagCounts, getShuffledIdsByFilters, getEntriesByIds, getCountByFilters } from '../db/queries';
import type { RelayFilters } from '../db/queries';
import { Calendar, type CalendarMarking } from '../components/Calendar';
import { StudyCard } from './StudyCard';
import type { VocabEntry } from '@mikukotoba/shared';
import { colors, spacing, fontSize } from '../components/theme';

const BATCH_SIZE = 50;

/** Ref state for cycle-based batching */
interface CycleState {
  ids: string[];
  offset: number;
}

interface RelaySessionProps {
  onExit: () => void;
}

type RelayPhase = 'filter-select' | 'studying';

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
  const [phase, setPhase] = useState<RelayPhase>('filter-select');

  // 날짜 선택
  const [dateMin, setDateMin] = useState('');
  const [dateMax, setDateMax] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [isLoadingDates, setIsLoadingDates] = useState(true);
  const [dateGroups, setDateGroups] = useState<{ date: string; count: number }[]>([]);

  // 태그 선택
  const [selectedTag, setSelectedTag] = useState<string | undefined>(undefined);
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({});

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

  // 날짜 범위 + 그룹 + 태그 로드
  useEffect(() => {
    async function load() {
      const [range, groups, tags] = await Promise.all([
        getDateRange(database),
        getDateGroups(database),
        getAllTagCounts(database),
      ]);
      setDateGroups(groups);
      setTagCounts(tags);
      if (range) {
        setDateMin(range.min);
        setDateMax(range.max);
        // 초기: 날짜/태그 필터 없이 전체 카운트
        const count = await getCountByFilters(database, {});
        setTotalCount(count);
      }
      setIsLoadingDates(false);
    }
    load();
  }, [database]);

  // 복합 필터 카운트 업데이트
  const updateCount = useCallback(async (tag: string | undefined, start: string, end: string) => {
    const filters: RelayFilters = {};
    if (tag !== undefined) filters.tag = tag;
    if (start && end) { filters.startDate = start; filters.endDate = end; }
    const count = await getCountByFilters(database, filters);
    setTotalCount(count);
  }, [database]);

  // 캘린더 범위 선택 핸들러
  const handleRangeSelect = useCallback((start: string, end: string | null) => {
    setStartDate(start);
    if (end) {
      setEndDate(end);
      updateCount(selectedTag, start, end);
    } else {
      setEndDate('');
      updateCount(selectedTag, '', '');
    }
  }, [updateCount, selectedTag]);

  // 프리셋 선택
  const handlePreset = useCallback((start: string, end: string) => {
    const clampedStart = start < dateMin ? dateMin : start;
    const clampedEnd = end > dateMax ? dateMax : end;
    setStartDate(clampedStart);
    setEndDate(clampedEnd);
    updateCount(selectedTag, clampedStart, clampedEnd);
  }, [dateMin, dateMax, updateCount, selectedTag]);

  // 태그 선택 핸들러
  const handleTagSelect = useCallback((tag: string | undefined) => {
    setSelectedTag(tag);
    updateCount(tag, startDate, endDate);
  }, [updateCount, startDate, endDate]);

  // 사이클 기반 배치 로드
  const cycleRef = useRef<CycleState>({ ids: [], offset: 0 });

  const loadNextBatch = useCallback(async (freshCycle: boolean) => {
    const filters: RelayFilters = {};
    if (selectedTag !== undefined) filters.tag = selectedTag;
    if (startDate && endDate) { filters.startDate = startDate; filters.endDate = endDate; }

    if (freshCycle || cycleRef.current.offset >= cycleRef.current.ids.length) {
      // 새 사이클: 전체 ID를 랜덤 순서로 가져옴
      const ids = await getShuffledIdsByFilters(database, filters);
      cycleRef.current = { ids, offset: 0 };
    }

    const { ids, offset } = cycleRef.current;
    const batchIds = ids.slice(offset, offset + BATCH_SIZE);
    cycleRef.current.offset = offset + batchIds.length;

    const batch = await getEntriesByIds(database, batchIds);
    setEntries(batch);
    setCurrentIndex(0);
    setShowAnswer(false);
    setShowReadingHint(false);
    setShowExampleHint(false);
  }, [database, startDate, endDate, selectedTag]);

  // 학습 시작
  const handleStart = useCallback(async () => {
    await loadNextBatch(true);
    setPhase('studying');
    setViewedCount(0);
  }, [loadNextBatch]);

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
      await loadNextBatch(false);
    }
  }, [currentIndex, entries.length, loadNextBatch]);

  const today = fmtToday();
  const hasDateRange = startDate && endDate;

  // 태그 목록
  const tagList = useMemo(() => {
    const tags = Object.keys(tagCounts).sort();
    return tags;
  }, [tagCounts]);

  // --- 필터 선택 화면 ---
  if (phase === 'filter-select') {
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

        {/* 태그 선택 */}
        {tagList.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>태그 선택 (선택사항)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagScrollRow}>
              <View style={styles.tagRow}>
                <Pressable
                  style={[styles.tagChip, selectedTag === undefined && styles.tagChipSelected]}
                  onPress={() => handleTagSelect(undefined)}
                >
                  <Text style={[styles.tagChipText, selectedTag === undefined && styles.tagChipTextSelected]}>전체</Text>
                </Pressable>
                {tagList.map((tag) => (
                  <Pressable
                    key={tag}
                    style={[styles.tagChip, selectedTag === tag && styles.tagChipSelected]}
                    onPress={() => handleTagSelect(tag)}
                  >
                    <Text style={[styles.tagChipText, selectedTag === tag && styles.tagChipTextSelected]}>
                      {tag} ({tagCounts[tag]})
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  style={[styles.tagChip, selectedTag === '' && styles.tagChipSelected]}
                  onPress={() => handleTagSelect('')}
                >
                  <Text style={[styles.tagChipText, selectedTag === '' && styles.tagChipTextSelected]}>태그 없음</Text>
                </Pressable>
              </View>
            </ScrollView>
          </>
        )}

        {/* 날짜 범위 선택 */}
        <Text style={styles.sectionLabel}>날짜 범위 선택 (선택사항)</Text>

        <Calendar
          mode="range"
          startDate={hasDateRange ? startDate : undefined}
          endDate={hasDateRange ? endDate : undefined}
          onSelectRange={handleRangeSelect}
          markings={markings}
        />

        {/* 빠른 선택 프리셋 */}
        <View style={styles.presetRow}>
          <PresetChip label="최근 7일" onPress={() => handlePreset(daysAgo(6), today)} />
          <PresetChip label="최근 30일" onPress={() => handlePreset(daysAgo(29), today)} />
          <PresetChip label="이번 달" onPress={() => handlePreset(monthStart(), today)} />
          <PresetChip
            label="전체 기간"
            onPress={() => {
              setStartDate('');
              setEndDate('');
              updateCount(selectedTag, '', '');
            }}
            active={!hasDateRange}
          />
        </View>

        <Text style={styles.countText}>
          총 {totalCount}개 단어
        </Text>

        <View style={styles.bottomButtons}>
          <Pressable
            style={[styles.startButton, totalCount === 0 && styles.startButtonDisabled]}
            onPress={handleStart}
            disabled={totalCount === 0}
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
      <View style={[styles.container, styles.studyContainer]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const current = entries[currentIndex];

  return (
    <View style={[styles.container, styles.studyContainer]}>
      <View style={styles.sessionHeader}>
        <Pressable style={styles.closeButton} onPress={onExit} hitSlop={8}>
          <Text style={styles.closeText}>✕ 종료</Text>
        </Pressable>
        <Text style={styles.sessionTitle}>
          자유 복습{selectedTag !== undefined ? ` · ${selectedTag || '태그 없음'}` : ''}
        </Text>
        <View style={styles.closeButton} />
      </View>

      <View style={styles.relayHeader}>
        <Text style={styles.relayCount}>
          {(viewedCount % totalCount) + 1}/{totalCount}
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
          borderColor={undefined}
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

function PresetChip({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.presetChip, (pressed || active) && styles.presetChipActive]}
      onPress={onPress}
    >
      <Text style={[styles.presetText, active && styles.presetTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  studyContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: 60,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: 80,
    paddingBottom: spacing.xl,
  },
  sectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  tagScrollRow: {
    marginBottom: spacing.md,
  },
  tagRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tagChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 16,
    backgroundColor: colors.borderLight,
  },
  tagChipSelected: {
    backgroundColor: colors.accent,
  },
  tagChipText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  tagChipTextSelected: {
    color: '#FFFFFF',
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
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
  presetChipActive: {
    backgroundColor: colors.accent,
  },
  presetText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  presetTextActive: {
    color: '#FFFFFF',
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

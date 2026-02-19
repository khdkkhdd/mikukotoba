import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDatabase } from '../components/DatabaseContext';
import { Calendar } from '../components/Calendar';
import type { CalendarHeatmap } from '../components/Calendar';
import {
  getDailyReviewStats,
  getOverallStats,
  getStreak,
  getMasteredCount,
  type DailyStats,
  type OverallStats,
} from '../db/queries';
import { colors, spacing, fontSize } from '../components/theme';

interface StatsScreenProps {
  onExit?: () => void;
}

type PeriodTab = 'today' | 'week' | 'month';

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function StatsScreen({ onExit }: StatsScreenProps = {}) {
  const database = useDatabase();
  const [isLoading, setIsLoading] = useState(true);
  const [overall, setOverall] = useState<OverallStats | null>(null);
  const [streak, setStreak] = useState({ current: 0, longest: 0 });
  const [mastered, setMastered] = useState(0);
  const [monthlyStats, setMonthlyStats] = useState<DailyStats[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const [periodTab, setPeriodTab] = useState<PeriodTab>('today');

  // 현재 보고 있는 월의 통계 로드용
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());

  // 초기 로드
  useEffect(() => {
    async function load() {
      const [o, s, m] = await Promise.all([
        getOverallStats(database),
        getStreak(database),
        getMasteredCount(database),
      ]);
      setOverall(o);
      setStreak(s);
      setMastered(m);
      setIsLoading(false);
    }
    load();
  }, [database]);

  // 월별 히트맵 데이터 로드
  useEffect(() => {
    async function loadMonth() {
      const start = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
      const end = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${lastDay}`;
      const stats = await getDailyReviewStats(database, start, end);
      setMonthlyStats(stats);
    }
    loadMonth();
  }, [database, viewYear, viewMonth]);

  // 캘린더 히트맵 데이터
  const heatmap = useMemo<CalendarHeatmap>(() => {
    const h: CalendarHeatmap = {};
    for (const s of monthlyStats) {
      h[s.date] = s.total;
    }
    return h;
  }, [monthlyStats]);

  // 선택된 날짜의 상세 통계
  const selectedDayStats = useMemo(() => {
    if (!selectedDate) return null;
    return monthlyStats.find((s) => s.date === selectedDate) ?? null;
  }, [selectedDate, monthlyStats]);

  // 기간별 통계
  const periodStats = useMemo(() => {
    const today = fmtDate(new Date());
    let filteredDays: DailyStats[];

    if (periodTab === 'today') {
      filteredDays = monthlyStats.filter((s) => s.date === today);
    } else if (periodTab === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 6);
      const weekStart = fmtDate(weekAgo);
      filteredDays = monthlyStats.filter((s) => s.date >= weekStart && s.date <= today);
    } else {
      filteredDays = monthlyStats;
    }

    const total = filteredDays.reduce((sum, d) => sum + d.total, 0);
    const good = filteredDays.reduce((sum, d) => sum + d.good + d.easy, 0);
    const days = filteredDays.length;

    return { total, accuracy: total > 0 ? Math.round((good / total) * 100) : 0, days };
  }, [periodTab, monthlyStats]);

  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate((prev) => (prev === date ? undefined : date));
  }, []);

  if (isLoading || !overall) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const overallAccuracy =
    overall.totalReviews > 0
      ? Math.round(((overall.good + overall.easy) / overall.totalReviews) * 100)
      : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* 헤더 */}
      {onExit ? (
        <View style={styles.header}>
          <Pressable onPress={onExit} hitSlop={8}>
            <Text style={styles.backText}>← 돌아가기</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={styles.title}>학습 통계</Text>

      {/* 요약 카드 */}
      <View style={styles.summaryRow}>
        <SummaryCard icon="🔥" label="연속" value={`${streak.current}일`} />
        <SummaryCard icon="📚" label="총 학습" value={`${overall.totalReviews}`} />
        <SummaryCard icon="✅" label="정확도" value={`${overallAccuracy}%`} />
      </View>

      <View style={styles.summaryRow}>
        <SummaryCard icon="🏆" label="최장 연속" value={`${streak.longest}일`} />
        <SummaryCard icon="📅" label="학습일" value={`${overall.totalDays}일`} />
        <SummaryCard icon="⭐" label="마스터" value={`${mastered}`} />
      </View>

      {/* 캘린더 히트맵 */}
      <Text style={styles.sectionTitle}>학습 히트맵</Text>
      <Calendar
        mode="single"
        selectedDate={selectedDate}
        onSelectDate={handleSelectDate}
        heatmap={heatmap}
        onMonthChange={(y, m) => {
          setViewYear(y);
          setViewMonth(m);
        }}
      />

      {/* 선택된 날짜 상세 */}
      {selectedDayStats && (
        <View style={styles.dayDetail}>
          <Text style={styles.dayDetailTitle}>{selectedDate}</Text>
          <View style={styles.dayDetailRow}>
            <Text style={styles.dayDetailLabel}>학습한 카드</Text>
            <Text style={styles.dayDetailValue}>{selectedDayStats.total}개</Text>
          </View>
          <View style={styles.dayDetailRow}>
            <Text style={styles.dayDetailLabel}>정답률</Text>
            <Text style={styles.dayDetailValue}>
              {selectedDayStats.total > 0
                ? Math.round(
                    ((selectedDayStats.good + selectedDayStats.easy) / selectedDayStats.total) * 100
                  )
                : 0}
              %
            </Text>
          </View>
          <View style={styles.gradeBarSection}>
            <GradeBar label="Again" count={selectedDayStats.again} total={selectedDayStats.total} color={colors.danger} />
            <GradeBar label="Hard" count={selectedDayStats.hard} total={selectedDayStats.total} color={colors.warning} />
            <GradeBar label="Good" count={selectedDayStats.good} total={selectedDayStats.total} color={colors.success} />
            <GradeBar label="Easy" count={selectedDayStats.easy} total={selectedDayStats.total} color={colors.accent} />
          </View>
        </View>
      )}

      {/* 기간별 통계 */}
      <Text style={styles.sectionTitle}>기간별 통계</Text>
      <View style={styles.periodTabs}>
        <PeriodChip label="오늘" active={periodTab === 'today'} onPress={() => setPeriodTab('today')} />
        <PeriodChip label="이번 주" active={periodTab === 'week'} onPress={() => setPeriodTab('week')} />
        <PeriodChip label="이번 달" active={periodTab === 'month'} onPress={() => setPeriodTab('month')} />
      </View>
      <View style={styles.periodCard}>
        <View style={styles.periodRow}>
          <Text style={styles.periodLabel}>총 학습 카드</Text>
          <Text style={styles.periodValue}>{periodStats.total}개</Text>
        </View>
        <View style={styles.periodRow}>
          <Text style={styles.periodLabel}>정답률</Text>
          <Text style={styles.periodValue}>{periodStats.accuracy}%</Text>
        </View>
        <View style={styles.periodRow}>
          <Text style={styles.periodLabel}>학습한 날</Text>
          <Text style={styles.periodValue}>{periodStats.days}일</Text>
        </View>
        {periodStats.days > 0 && (
          <View style={styles.periodRow}>
            <Text style={styles.periodLabel}>일 평균</Text>
            <Text style={styles.periodValue}>
              {Math.round(periodStats.total / periodStats.days)}개
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// --- 하위 컴포넌트 ---

function SummaryCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryIcon}>{icon}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function GradeBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <View style={styles.gradeBarRow}>
      <Text style={[styles.gradeBarLabel, { color }]}>{label}</Text>
      <View style={styles.gradeBarTrack}>
        <View style={[styles.gradeBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.gradeBarCount}>{count}개 ({Math.round(pct)}%)</Text>
    </View>
  );
}

function PeriodChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.periodChip, active && styles.periodChipActive]}
      onPress={onPress}
    >
      <Text style={[styles.periodChipText, active && styles.periodChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

// --- 스타일 ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: 80,
  },
  scrollContent: {
    paddingBottom: spacing.xl * 2,
  },
  header: {
    marginBottom: spacing.sm,
  },
  backText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
  },
  summaryIcon: { fontSize: 20, marginBottom: 4 },
  summaryValue: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  summaryLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  dayDetail: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  dayDetailTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  dayDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  dayDetailLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  dayDetailValue: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  gradeBarSection: {
    marginTop: spacing.sm,
    gap: 6,
  },
  gradeBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  gradeBarLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    width: 38,
  },
  gradeBarTrack: {
    flex: 1,
    height: 8,
    backgroundColor: colors.borderLight,
    borderRadius: 4,
    overflow: 'hidden',
  },
  gradeBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  gradeBarCount: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    minWidth: 70,
    textAlign: 'right',
  },
  periodTabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  periodChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 16,
    backgroundColor: colors.borderLight,
  },
  periodChipActive: {
    backgroundColor: colors.accent,
  },
  periodChipText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  periodChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  periodCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  periodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  periodLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  periodValue: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
});

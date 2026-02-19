import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useState, useMemo, useCallback } from 'react';
import { colors, spacing, fontSize } from './theme';

// --- 유틸리티 ---

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function startDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay(); // 0=일 ~ 6=토
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// --- 타입 ---

/** dot 마킹: 해당 날짜에 데이터 존재 여부 */
export interface CalendarMarking {
  [date: string]: { dotCount?: number };
}

/** 히트맵: 해당 날짜의 수치 (학습량 등) */
export interface CalendarHeatmap {
  [date: string]: number;
}

interface CalendarBaseProps {
  /** 마킹할 날짜들 (dot 표시) */
  markings?: CalendarMarking;
  /** 히트맵 데이터 (색상 농도) */
  heatmap?: CalendarHeatmap;
  /** 오늘 날짜 하이라이트 (기본: true) */
  showToday?: boolean;
  /** 월 변경 시 콜백 (year: 0-indexed가 아닌 실제 연도, month: 0-indexed) */
  onMonthChange?: (year: number, month: number) => void;
}

export interface SingleSelectCalendarProps extends CalendarBaseProps {
  mode: 'single';
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
}

export interface RangeSelectCalendarProps extends CalendarBaseProps {
  mode: 'range';
  startDate?: string;
  endDate?: string;
  onSelectRange?: (start: string, end: string | null) => void;
}

export type CalendarProps = SingleSelectCalendarProps | RangeSelectCalendarProps;

// --- 컴포넌트 ---

export function Calendar(props: CalendarProps) {
  const today = useMemo(() => {
    const d = new Date();
    return fmt(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  const [viewYear, setViewYear] = useState(() => {
    if (props.mode === 'single' && props.selectedDate) {
      return parseInt(props.selectedDate.slice(0, 4), 10);
    }
    return new Date().getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    if (props.mode === 'single' && props.selectedDate) {
      return parseInt(props.selectedDate.slice(5, 7), 10) - 1;
    }
    return new Date().getMonth();
  });

  // 범위 선택 내부 상태: 첫 탭 → 시작일만, 두 번째 탭 → 종료일
  const [rangeStart, setRangeStart] = useState<string | null>(
    props.mode === 'range' ? (props.startDate ?? null) : null
  );

  const goPrev = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => {
          props.onMonthChange?.(y - 1, 11);
          return y - 1;
        });
        return 11;
      }
      props.onMonthChange?.(viewYear, m - 1);
      return m - 1;
    });
  }, [props.onMonthChange, viewYear]);

  const goNext = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => {
          props.onMonthChange?.(y + 1, 0);
          return y + 1;
        });
        return 0;
      }
      props.onMonthChange?.(viewYear, m + 1);
      return m + 1;
    });
  }, [props.onMonthChange, viewYear]);

  const handleDayPress = useCallback(
    (dateStr: string) => {
      if (props.mode === 'single') {
        props.onSelectDate?.(dateStr);
      } else {
        // range mode: 첫 탭 = 시작, 두 번째 탭 = 종료
        if (!rangeStart || (rangeStart && props.endDate)) {
          // 새 범위 시작
          setRangeStart(dateStr);
          props.onSelectRange?.(dateStr, null);
        } else {
          // 종료일 설정
          const start = dateStr < rangeStart ? dateStr : rangeStart;
          const end = dateStr < rangeStart ? rangeStart : dateStr;
          setRangeStart(start);
          props.onSelectRange?.(start, end);
        }
      }
    },
    [props, rangeStart]
  );

  const totalDays = daysInMonth(viewYear, viewMonth);
  const startDay = startDayOfWeek(viewYear, viewMonth);
  const showToday = props.showToday !== false;

  // 날짜 셀 생성
  const cells = useMemo(() => {
    const result: (number | null)[] = [];
    for (let i = 0; i < startDay; i++) result.push(null);
    for (let d = 1; d <= totalDays; d++) result.push(d);
    return result;
  }, [startDay, totalDays]);

  // 히트맵 최대값
  const heatmapMax = useMemo(() => {
    if (!props.heatmap) return 0;
    return Math.max(1, ...Object.values(props.heatmap));
  }, [props.heatmap]);

  return (
    <View style={styles.container}>
      {/* 헤더: 월 이동 */}
      <View style={styles.header}>
        <Pressable onPress={goPrev} hitSlop={12} style={styles.navButton}>
          <Text style={styles.navText}>◀</Text>
        </Pressable>
        <Text style={styles.monthTitle}>
          {viewYear}년 {viewMonth + 1}월
        </Text>
        <Pressable onPress={goNext} hitSlop={12} style={styles.navButton}>
          <Text style={styles.navText}>▶</Text>
        </Pressable>
      </View>

      {/* 요일 헤더 */}
      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <View key={w} style={styles.weekCell}>
            <Text style={[styles.weekText, i === 0 && styles.sundayText]}>
              {w}
            </Text>
          </View>
        ))}
      </View>

      {/* 날짜 그리드 */}
      <View style={styles.grid}>
        {cells.map((day, idx) => {
          if (day === null) {
            return <View key={`empty-${idx}`} style={styles.dayCell} />;
          }

          const dateStr = fmt(viewYear, viewMonth, day);
          const isToday = showToday && dateStr === today;
          const marking = props.markings?.[dateStr];
          const heatValue = props.heatmap?.[dateStr];

          // 선택 상태
          let isSelected = false;
          let isRangeMiddle = false;
          let isRangeStart = false;
          let isRangeEnd = false;

          if (props.mode === 'single') {
            isSelected = dateStr === props.selectedDate;
          } else {
            const rs = props.startDate ?? rangeStart;
            const re = props.endDate;
            if (rs && re) {
              isRangeStart = dateStr === rs;
              isRangeEnd = dateStr === re;
              isRangeMiddle = dateStr > rs && dateStr < re;
              isSelected = isRangeStart || isRangeEnd;
            } else if (rs) {
              isSelected = dateStr === rs;
              isRangeStart = isSelected;
            }
          }

          // 히트맵 배경색
          let heatBg: string | undefined;
          if (heatValue !== undefined && heatValue > 0) {
            const intensity = Math.min(heatValue / heatmapMax, 1);
            const alpha = 0.15 + intensity * 0.55; // 0.15 ~ 0.7
            heatBg = `rgba(201, 107, 79, ${alpha})`;
          }

          return (
            <View key={dateStr} style={styles.dayCell}>
              {/* 범위 중간 배경 */}
              {isRangeMiddle && <View style={styles.rangeBg} />}
              {isRangeStart && props.mode === 'range' && props.endDate && (
                <View style={[styles.rangeBg, styles.rangeBgStart]} />
              )}
              {isRangeEnd && (
                <View style={[styles.rangeBg, styles.rangeBgEnd]} />
              )}

              <Pressable
                style={[
                  styles.dayButton,
                  heatBg ? { backgroundColor: heatBg } : undefined,
                  isSelected && styles.daySelected,
                  isToday && !isSelected && styles.dayToday,
                ]}
                onPress={() => handleDayPress(dateStr)}
              >
                <Text
                  style={[
                    styles.dayText,
                    idx % 7 === 0 && styles.sundayText,
                    isSelected && styles.dayTextSelected,
                    isToday && !isSelected && styles.dayTextToday,
                  ]}
                >
                  {day}
                </Text>
              </Pressable>

              {/* dot 마킹 */}
              {marking && (
                <View style={styles.dotRow}>
                  {Array.from({ length: Math.min(marking.dotCount ?? 1, 3) }).map((_, i) => (
                    <View key={i} style={styles.dot} />
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

// --- 외부에서 월 이동을 제어할 필요가 있을 때 사용하는 유틸 ---

/** 날짜 문자열 → { year, month } */
export function parseYearMonth(date: string): { year: number; month: number } {
  return {
    year: parseInt(date.slice(0, 4), 10),
    month: parseInt(date.slice(5, 7), 10) - 1,
  };
}

// --- 스타일 ---

const DAY_SIZE = 40;

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  navButton: {
    padding: spacing.sm,
  },
  navText: {
    fontSize: fontSize.md,
    color: colors.accent,
  },
  monthTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  weekCell: {
    flex: 1,
    alignItems: 'center',
  },
  weekText: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: '600',
  },
  sundayText: {
    color: colors.danger,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    marginBottom: 2,
    position: 'relative',
  },
  dayButton: {
    width: DAY_SIZE,
    height: DAY_SIZE,
    borderRadius: DAY_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySelected: {
    backgroundColor: colors.accent,
  },
  dayToday: {
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  dayText: {
    fontSize: fontSize.sm,
    color: colors.text,
  },
  dayTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  dayTextToday: {
    color: colors.accent,
    fontWeight: '600',
  },
  rangeBg: {
    position: 'absolute',
    top: 4,
    left: 0,
    right: 0,
    height: DAY_SIZE - 8,
    backgroundColor: colors.accentLight,
  },
  rangeBgStart: {
    left: '50%',
    right: 0,
  },
  rangeBgEnd: {
    left: 0,
    right: '50%',
  },
  dotRow: {
    flexDirection: 'row',
    gap: 2,
    marginTop: -2,
    height: 6,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
});

import { View, Text, TextInput, Pressable, StyleSheet, SectionList } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useMemo, useCallback } from 'react';
import { useDatabase } from '../../src/components/DatabaseContext';
import { useVocabStore } from '../../src/stores/vocab-store';
import { Calendar, type CalendarMarking } from '../../src/components/Calendar';
import type { VocabEntry } from '@mikukotoba/shared';
import { colors, spacing, fontSize } from '../../src/components/theme';

type ViewMode = 'all' | 'date';

export default function VocabScreen() {
  const router = useRouter();
  const database = useDatabase();
  const { entries, dateGroups, totalCount, search } = useVocabStore();
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const [calendarOpen, setCalendarOpen] = useState(false);

  const handleSearch = useCallback(
    (text: string) => {
      setQuery(text);
      search(database, text);
    },
    [database, search]
  );

  // 캘린더 마킹
  const markings = useMemo<CalendarMarking>(() => {
    const m: CalendarMarking = {};
    for (const g of dateGroups) {
      m[g.date] = { dotCount: g.count >= 10 ? 3 : g.count >= 5 ? 2 : 1 };
    }
    return m;
  }, [dateGroups]);

  // 날짜 선택
  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date);
    setViewMode('date');
  }, []);

  // 전체 보기로 복귀
  const handleShowAll = useCallback(() => {
    setViewMode('all');
    setSelectedDate(undefined);
  }, []);

  // 필터링된 entries
  const filteredEntries = useMemo(() => {
    if (viewMode === 'date' && selectedDate) {
      return entries.filter((e) => e.dateAdded === selectedDate);
    }
    return entries;
  }, [entries, viewMode, selectedDate]);

  // 날짜별 그룹
  const sections = useMemo(() => {
    const grouped = new Map<string, VocabEntry[]>();
    for (const entry of filteredEntries) {
      const list = grouped.get(entry.dateAdded) ?? [];
      list.push(entry);
      grouped.set(entry.dateAdded, list);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, data]) => ({ title: date, data }));
  }, [filteredEntries]);

  const displayCount = viewMode === 'date' ? filteredEntries.length : totalCount;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>단어장</Text>
        <Text style={styles.count}>{displayCount}개</Text>
        <View style={{ flex: 1 }} />
        <Pressable
          style={[styles.calendarToggle, calendarOpen && styles.calendarToggleActive]}
          onPress={() => setCalendarOpen((v) => !v)}
        >
          <Text style={styles.calendarToggleText}>📅</Text>
        </Pressable>
      </View>

      {/* 모드 토글 */}
      {calendarOpen && (
        <View style={styles.calendarSection}>
          <Calendar
            mode="single"
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
            markings={markings}
          />
          {viewMode === 'date' && (
            <Pressable style={styles.showAllButton} onPress={handleShowAll}>
              <Text style={styles.showAllText}>전체 보기</Text>
            </Pressable>
          )}
        </View>
      )}

      <TextInput
        style={styles.searchInput}
        placeholder="검색..."
        placeholderTextColor={colors.textPlaceholder}
        value={query}
        onChangeText={handleSearch}
      />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionDate}>{section.title}</Text>
            <Text style={styles.sectionCount}>{section.data.length}개</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable
            style={styles.entryCard}
            onPress={() => router.push(`/vocab/${item.id}`)}
          >
            <View style={styles.entryTop}>
              <Text style={styles.entryWord}>{item.word}</Text>
              {item.reading ? <Text style={styles.entryReading}>{item.reading}</Text> : null}
              {item.pos ? <Text style={styles.entryPos}>{item.pos}</Text> : null}
            </View>
            <Text style={styles.entryMeaning}>{item.meaning}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📚</Text>
            <Text style={styles.emptyText}>
              {viewMode === 'date' ? '이 날짜에 단어가 없습니다' : '저장된 단어가 없습니다'}
            </Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: 80,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: fontSize.xxl, fontWeight: '700', color: colors.text },
  count: { fontSize: fontSize.sm, color: colors.textMuted },
  calendarToggle: {
    padding: spacing.xs,
    borderRadius: 6,
  },
  calendarToggleActive: {
    backgroundColor: colors.accentLight,
  },
  calendarToggleText: {
    fontSize: 20,
  },
  calendarSection: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  showAllButton: {
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 16,
    backgroundColor: colors.borderLight,
  },
  showAllText: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '600',
  },
  searchInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 100 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginHorizontal: -spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
  },
  sectionDate: { fontSize: fontSize.sm, color: colors.textMuted },
  sectionCount: { fontSize: fontSize.xs, color: colors.textPlaceholder },
  entryCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  entryTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  entryWord: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  entryReading: { fontSize: fontSize.md, color: colors.textMuted },
  entryPos: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    backgroundColor: colors.borderLight,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
  },
  entryMeaning: {
    fontSize: fontSize.md,
    color: colors.accent,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { fontSize: fontSize.md, color: colors.textMuted },
});

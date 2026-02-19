import { View, Text, TextInput, FlatList, Pressable, StyleSheet, SectionList } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useMemo, useCallback } from 'react';
import { useDatabase } from '../../src/components/DatabaseContext';
import { useVocabStore } from '../../src/stores/vocab-store';
import type { VocabEntry } from '@jp-helper/shared';
import { colors, spacing, fontSize } from '../../src/components/theme';

export default function VocabScreen() {
  const router = useRouter();
  const database = useDatabase();
  const { entries, totalCount, search } = useVocabStore();
  const [query, setQuery] = useState('');

  const handleSearch = useCallback(
    (text: string) => {
      setQuery(text);
      search(database, text);
    },
    [database, search]
  );

  // 날짜별 그룹
  const sections = useMemo(() => {
    const grouped = new Map<string, VocabEntry[]>();
    for (const entry of entries) {
      const list = grouped.get(entry.dateAdded) ?? [];
      list.push(entry);
      grouped.set(entry.dateAdded, list);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, data]) => ({ title: date, data }));
  }, [entries]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>단어장</Text>
        <Text style={styles.count}>{totalCount}개</Text>
      </View>
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
            <Text style={styles.emptyText}>저장된 단어가 없습니다</Text>
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
    paddingTop: 60,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.text },
  count: { fontSize: fontSize.sm, color: colors.textMuted },
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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
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

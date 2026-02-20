import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useState, useEffect } from 'react';
import { useDatabase } from '../../src/components/DatabaseContext';
import { getDueCount, getNewCount } from '../../src/fsrs';
import { getStudyCountsByTag, type TagStudyCounts } from '../../src/db';
import { SrsSession } from '../../src/study/SrsSession';
import { RelaySession } from '../../src/study/RelaySession';
import { colors, spacing, fontSize } from '../../src/components/theme';

type StudyMode = 'select' | 'srs' | 'relay';

export default function StudyScreen() {
  const [mode, setMode] = useState<StudyMode>('select');
  const [filterTag, setFilterTag] = useState<string | undefined>();

  const startSrs = (tag?: string) => {
    setFilterTag(tag);
    setMode('srs');
  };

  if (mode === 'srs') return <SrsSession filterTag={filterTag} onExit={() => setMode('select')} onStartRelay={() => setMode('relay')} />;
  if (mode === 'relay') return <RelaySession onExit={() => setMode('select')} />;

  return <ModeSelector onSrs={startSrs} onRelay={() => setMode('relay')} />;
}

function ModeSelector({ onSrs, onRelay }: { onSrs: (tag?: string) => void; onRelay: () => void }) {
  const database = useDatabase();
  const [dueCount, setDueCount] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const [tagCounts, setTagCounts] = useState<Record<string, TagStudyCounts>>({});

  useEffect(() => {
    async function load() {
      const [due, newC, tags] = await Promise.all([
        getDueCount(database),
        getNewCount(database),
        getStudyCountsByTag(database),
      ]);
      setDueCount(due);
      setNewCount(newC);
      setTagCounts(tags);
    }
    load();
  }, [database]);

  const tagEntries = Object.entries(tagCounts)
    .sort(([, a], [, b]) => (b.due + b.new) - (a.due + a.new));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.title}>학습</Text>

      <Pressable
        style={({ pressed }) => [styles.modeCard, pressed && styles.modeCardPressed]}
        onPress={() => onSrs()}
      >
        <Text style={styles.modeIcon}>📚</Text>
        <View style={styles.modeContent}>
          <Text style={styles.modeTitle}>오늘의 학습</Text>
          <Text style={styles.modeDesc}>
            복습 {dueCount}개 + 새 단어 {newCount}개
          </Text>
        </View>
        <Text style={styles.modeArrow}>→</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.modeCard, styles.relayCard, pressed && styles.modeCardPressed]}
        onPress={onRelay}
      >
        <Text style={styles.modeIcon}>🔀</Text>
        <View style={styles.modeContent}>
          <Text style={styles.modeTitle}>자유 복습</Text>
          <Text style={styles.modeDesc}>날짜 범위 선택하여 반복</Text>
        </View>
        <Text style={styles.modeArrow}>→</Text>
      </Pressable>

      {tagEntries.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>태그별 학습</Text>
          {tagEntries.map(([tag, counts]) => {
            const parts: string[] = [];
            if (counts.due > 0) parts.push(`복습 ${counts.due}`);
            if (counts.new > 0) parts.push(`새 ${counts.new}`);
            return (
              <Pressable
                key={tag}
                style={({ pressed }) => [styles.tagCard, pressed && styles.modeCardPressed]}
                onPress={() => onSrs(tag)}
              >
                <View style={styles.tagDot} />
                <Text style={styles.tagCardName}>{tag || '태그 없음'}</Text>
                <Text style={styles.tagCardCount}>
                  {parts.length > 0 ? parts.join(' + ') : '학습 완료'}
                </Text>
                <Text style={styles.modeArrow}>→</Text>
              </Pressable>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: 80,
    paddingBottom: 100,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xl,
  },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  relayCard: {},
  modeCardPressed: {
    backgroundColor: colors.borderLight,
  },
  modeIcon: {
    fontSize: 32,
    marginRight: spacing.md,
  },
  modeContent: {
    flex: 1,
  },
  modeTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  modeDesc: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  modeArrow: {
    fontSize: fontSize.lg,
    color: colors.textPlaceholder,
  },
  sectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  tagCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  tagDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginRight: spacing.sm,
  },
  tagCardName: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.text,
  },
  tagCardCount: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginRight: spacing.sm,
  },
});

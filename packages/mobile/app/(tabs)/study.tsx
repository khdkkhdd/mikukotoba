import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useState, useEffect } from 'react';
import { useDatabase } from '../../src/components/DatabaseContext';
import { getDueCount, getNewCount } from '../../src/fsrs';
import { SrsSession } from '../../src/study/SrsSession';
import { RelaySession } from '../../src/study/RelaySession';
import { colors, spacing, fontSize } from '../../src/components/theme';

type StudyMode = 'select' | 'srs' | 'relay';

export default function StudyScreen() {
  const [mode, setMode] = useState<StudyMode>('select');

  if (mode === 'srs') return <SrsSession onExit={() => setMode('select')} onStartRelay={() => setMode('relay')} />;
  if (mode === 'relay') return <RelaySession onExit={() => setMode('select')} />;

  return <ModeSelector onSrs={() => setMode('srs')} onRelay={() => setMode('relay')} />;
}

function ModeSelector({ onSrs, onRelay }: { onSrs: () => void; onRelay: () => void }) {
  const database = useDatabase();
  const [dueCount, setDueCount] = useState(0);
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    async function load() {
      const [due, newC] = await Promise.all([
        getDueCount(database),
        getNewCount(database),
      ]);
      setDueCount(due);
      setNewCount(newC);
    }
    load();
  }, [database]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>학습</Text>

      <Pressable
        style={({ pressed }) => [styles.modeCard, pressed && styles.modeCardPressed]}
        onPress={onSrs}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: 80,
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
  relayCard: {
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
  },
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
});

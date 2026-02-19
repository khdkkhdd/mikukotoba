import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useDatabase } from '../../src/components/DatabaseContext';
import { useVocabStore } from '../../src/stores/vocab-store';
import { getDueCount, getNewCount, getTodayReviewCount } from '../../src/fsrs';
import { colors, spacing, fontSize } from '../../src/components/theme';

export default function HomeScreen() {
  const router = useRouter();
  const database = useDatabase();
  const totalCount = useVocabStore((s) => s.totalCount);
  const [dueCount, setDueCount] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const [todayReviewed, setTodayReviewed] = useState(0);

  useEffect(() => {
    (async () => {
      const [due, newC, reviewed] = await Promise.all([
        getDueCount(database),
        getNewCount(database),
        getTodayReviewCount(database),
      ]);
      setDueCount(due);
      setNewCount(newC);
      setTodayReviewed(reviewed);
    })();
  }, [database, totalCount]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>JP Helper</Text>
        <Text style={styles.subtitle}>일본어 단어 학습</Text>
      </View>

      <View style={styles.statsRow}>
        <StatCard label="전체 단어" value={totalCount} />
        <StatCard label="오늘 복습" value={todayReviewed} color={colors.success} />
      </View>

      <Pressable
        style={({ pressed }) => [styles.studyButton, pressed && styles.studyButtonPressed]}
        onPress={() => router.push('/(tabs)/study')}
      >
        <Text style={styles.studyButtonText}>학습 시작</Text>
        <Text style={styles.studyButtonSub}>
          {dueCount > 0 ? `복습 ${dueCount}개` : ''}
          {dueCount > 0 && newCount > 0 ? ' + ' : ''}
          {newCount > 0 ? `새 단어 ${newCount}개` : ''}
          {dueCount === 0 && newCount === 0 ? '학습할 카드가 없습니다' : ''}
        </Text>
      </Pressable>

      <View style={styles.quickActions}>
        <Pressable style={styles.actionCard} onPress={() => router.push('/(tabs)/vocab')}>
          <Text style={styles.actionIcon}>📚</Text>
          <Text style={styles.actionLabel}>단어장</Text>
        </Pressable>
        <Pressable style={styles.actionCard} onPress={() => router.push('/add')}>
          <Text style={styles.actionIcon}>✏️</Text>
          <Text style={styles.actionLabel}>단어 추가</Text>
        </Pressable>
      </View>
    </View>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, color ? { color } : undefined]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    paddingTop: 60,
  },
  header: {
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.accent,
  },
  statLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  studyButton: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  studyButtonPressed: {
    opacity: 0.85,
  },
  studyButtonText: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  studyButtonSub: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.8)',
    marginTop: spacing.xs,
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  actionLabel: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
});

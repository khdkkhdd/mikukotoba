import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useEffect, useState, useCallback } from 'react';
import { useDatabase } from '../../src/components/DatabaseContext';
import { useSettingsStore } from '../../src/stores/settings-store';
import { getDueCards, getNewCards, reviewCard, getOrCreateCard, Rating, type Grade, type Card } from '../../src/fsrs';
import { getEntryById } from '../../src/db';
import type { VocabEntry } from '@jp-helper/shared';
import { colors, spacing, fontSize } from '../../src/components/theme';

interface StudyCard {
  entry: VocabEntry;
  fsrsCard: Card;
}

export default function StudyScreen() {
  const database = useDatabase();
  const dailyNewCards = useSettingsStore((s) => s.dailyNewCards);

  const [queue, setQueue] = useState<StudyCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, correct: 0 });
  const [isLoading, setIsLoading] = useState(true);

  const loadQueue = useCallback(async () => {
    setIsLoading(true);

    // 복습 카드 (무제한) + 새 카드 (일일 한도)
    const [dueIds, newIds] = await Promise.all([
      getDueCards(database),
      getNewCards(database, dailyNewCards),
    ]);

    const allIds = [...dueIds, ...newIds];
    const cards: StudyCard[] = [];

    for (const id of allIds) {
      const entry = await getEntryById(database, id);
      if (!entry) continue;
      const fsrsCard = await getOrCreateCard(database, id);
      cards.push({ entry, fsrsCard });
    }

    setQueue(cards);
    setCurrentIndex(0);
    setShowAnswer(false);
    setIsLoading(false);
  }, [database, dailyNewCards]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleGrade = useCallback(
    async (grade: Grade) => {
      const current = queue[currentIndex];
      if (!current) return;

      await reviewCard(database, current.entry.id, grade);

      setSessionStats((s) => ({
        reviewed: s.reviewed + 1,
        correct: grade >= Rating.Good ? s.correct + 1 : s.correct,
      }));

      setShowAnswer(false);
      setCurrentIndex((i) => i + 1);
    },
    [database, queue, currentIndex]
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>카드 준비 중...</Text>
      </View>
    );
  }

  // 세션 완료
  if (currentIndex >= queue.length) {
    return (
      <View style={styles.container}>
        <View style={styles.completeCard}>
          <Text style={styles.completeIcon}>🎉</Text>
          <Text style={styles.completeTitle}>학습 완료!</Text>
          <Text style={styles.completeStats}>
            {sessionStats.reviewed}개 복습 / {sessionStats.correct}개 정답
          </Text>
          <Pressable style={styles.reloadButton} onPress={loadQueue}>
            <Text style={styles.reloadText}>다시 확인</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const current = queue[currentIndex];
  const progress = `${currentIndex + 1} / ${queue.length}`;

  return (
    <View style={styles.container}>
      <View style={styles.progressBar}>
        <Text style={styles.progressText}>{progress}</Text>
        <View style={styles.progressTrack}>
          <View
            style={[styles.progressFill, { width: `${((currentIndex + 1) / queue.length) * 100}%` }]}
          />
        </View>
      </View>

      <Pressable
        style={styles.card}
        onPress={() => setShowAnswer(true)}
      >
        <Text style={styles.cardWord}>{current.entry.word}</Text>
        {current.entry.reading ? (
          <Text style={styles.cardReading}>{current.entry.reading}</Text>
        ) : null}

        {showAnswer ? (
          <View style={styles.answer}>
            <Text style={styles.cardMeaning}>{current.entry.meaning}</Text>
            {current.entry.pos ? (
              <Text style={styles.cardPos}>{current.entry.pos}</Text>
            ) : null}
            {current.entry.exampleSentence ? (
              <Text style={styles.cardExample}>{current.entry.exampleSentence}</Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.tapHint}>탭하여 정답 확인</Text>
        )}
      </Pressable>

      {showAnswer ? (
        <View style={styles.gradeButtons}>
          <GradeButton label="Again" color={colors.danger} onPress={() => handleGrade(Rating.Again)} />
          <GradeButton label="Hard" color={colors.warning} onPress={() => handleGrade(Rating.Hard)} />
          <GradeButton label="Good" color={colors.success} onPress={() => handleGrade(Rating.Good)} />
          <GradeButton label="Easy" color={colors.accent} onPress={() => handleGrade(Rating.Easy)} />
        </View>
      ) : null}
    </View>
  );
}

function GradeButton({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.gradeBtn, { borderColor: color }, pressed && { backgroundColor: color + '20' }]}
      onPress={onPress}
    >
      <Text style={[styles.gradeLabel, { color }]}>{label}</Text>
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
  loadingText: {
    textAlign: 'center',
    fontSize: fontSize.md,
    color: colors.textMuted,
    marginTop: 100,
  },
  progressBar: { marginBottom: spacing.lg },
  progressText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  progressTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
  },
  progressFill: {
    height: 4,
    backgroundColor: colors.accent,
    borderRadius: 2,
  },
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  cardWord: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  cardReading: {
    fontSize: fontSize.lg,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  tapHint: {
    fontSize: fontSize.sm,
    color: colors.textPlaceholder,
    marginTop: spacing.xl,
  },
  answer: {
    marginTop: spacing.xl,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
    width: '100%',
  },
  cardMeaning: {
    fontSize: fontSize.xl,
    fontWeight: '600',
    color: colors.accent,
    textAlign: 'center',
  },
  cardPos: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    backgroundColor: colors.borderLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  cardExample: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.md,
    textAlign: 'center',
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
  reloadButton: {
    backgroundColor: colors.borderLight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 8,
  },
  reloadText: { fontSize: fontSize.md, color: colors.text },
});

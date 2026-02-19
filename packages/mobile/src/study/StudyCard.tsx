import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { VocabEntry } from '@mikukotoba/shared';
import { colors, spacing, fontSize } from '../components/theme';

interface StudyCardProps {
  entry: VocabEntry;
  showAnswer: boolean;
  showReadingHint: boolean;
  showExampleHint: boolean;
  onToggleReadingHint: () => void;
  onToggleExampleHint: () => void;
  onRevealAnswer: () => void;
  borderColor?: string;
}

export function StudyCard({
  entry,
  showAnswer,
  showReadingHint,
  showExampleHint,
  onToggleReadingHint,
  onToggleExampleHint,
  onRevealAnswer,
  borderColor,
}: StudyCardProps) {
  return (
    <Pressable
      style={[styles.card, borderColor && { borderLeftWidth: 4, borderLeftColor: borderColor }]}
      onPress={showAnswer ? undefined : onRevealAnswer}
    >
      {/* 앞면: 원문 */}
      <Text style={styles.word}>{entry.word}</Text>

      {/* 힌트 버튼 (정답 공개 전) */}
      {!showAnswer && (
        <View style={styles.hintArea}>
          {showReadingHint && entry.reading ? (
            <Text style={styles.hintText}>{entry.reading}</Text>
          ) : null}
          {showExampleHint && entry.exampleSentence ? (
            <Text style={styles.hintExampleText}>{entry.exampleSentence}</Text>
          ) : null}

          <View style={styles.hintButtons}>
            {entry.reading ? (
              <Pressable
                style={[styles.hintBtn, showReadingHint && styles.hintBtnActive]}
                onPress={onToggleReadingHint}
              >
                <Text style={[styles.hintBtnText, showReadingHint && styles.hintBtnTextActive]}>
                  발음 보기
                </Text>
              </Pressable>
            ) : null}
            {entry.exampleSentence ? (
              <Pressable
                style={[styles.hintBtn, showExampleHint && styles.hintBtnActive]}
                onPress={onToggleExampleHint}
              >
                <Text style={[styles.hintBtnText, showExampleHint && styles.hintBtnTextActive]}>
                  예문 보기
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.tapHint}>탭하여 정답 확인</Text>
        </View>
      )}

      {/* 정답 공개 */}
      {showAnswer && (
        <View style={styles.answer}>
          {entry.reading ? (
            <Text style={styles.reading}>{entry.reading}</Text>
          ) : null}
          <Text style={styles.meaning}>{entry.meaning}</Text>
          {entry.pos ? (
            <View style={styles.posTag}>
              <Text style={styles.posText}>{entry.pos}</Text>
            </View>
          ) : null}
          {entry.exampleSentence ? (
            <Text style={styles.example}>{entry.exampleSentence}</Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  word: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  hintArea: {
    marginTop: spacing.lg,
    alignItems: 'center',
    width: '100%',
  },
  hintText: {
    fontSize: fontSize.lg,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  hintExampleText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  hintButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  hintBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  hintBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentLight,
  },
  hintBtnText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  hintBtnTextActive: {
    color: colors.accent,
  },
  tapHint: {
    fontSize: fontSize.sm,
    color: colors.textPlaceholder,
    marginTop: spacing.lg,
  },
  answer: {
    marginTop: spacing.xl,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
    width: '100%',
  },
  reading: {
    fontSize: fontSize.lg,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  meaning: {
    fontSize: fontSize.xl,
    fontWeight: '600',
    color: colors.accent,
    textAlign: 'center',
  },
  posTag: {
    backgroundColor: colors.borderLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: spacing.sm,
  },
  posText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  example: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.md,
    textAlign: 'center',
  },
});

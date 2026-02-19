import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useDatabase } from '../src/components/DatabaseContext';
import { useVocabStore } from '../src/stores/vocab-store';
import type { VocabEntry } from '@jp-helper/shared';
import { colors, spacing, fontSize } from '../src/components/theme';

export default function AddScreen() {
  const router = useRouter();
  const database = useDatabase();
  const addEntry = useVocabStore((s) => s.addEntry);

  const [form, setForm] = useState({
    word: '',
    reading: '',
    meaning: '',
    pos: '',
    note: '',
  });

  const handleSave = async () => {
    if (!form.word.trim()) {
      Alert.alert('입력 필요', '단어를 입력해주세요.');
      return;
    }

    const now = Date.now();
    const entry: VocabEntry = {
      id: `${now}_${Math.random().toString(36).slice(2, 8)}`,
      word: form.word.trim(),
      reading: form.reading.trim(),
      romaji: '',
      meaning: form.meaning.trim(),
      pos: form.pos.trim(),
      exampleSentence: '',
      exampleSource: '',
      note: form.note.trim(),
      dateAdded: new Date().toISOString().slice(0, 10),
      timestamp: now,
    };

    await addEntry(database, entry);
    router.back();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Field label="단어 *" value={form.word} onChange={(v) => setForm({ ...form, word: v })} placeholder="日本語" autoFocus />
      <Field label="읽기 (히라가나)" value={form.reading} onChange={(v) => setForm({ ...form, reading: v })} placeholder="にほんご" />
      <Field label="뜻 (한국어)" value={form.meaning} onChange={(v) => setForm({ ...form, meaning: v })} placeholder="일본어" />
      <Field label="품사" value={form.pos} onChange={(v) => setForm({ ...form, pos: v })} placeholder="名詞" />
      <Field label="메모" value={form.note} onChange={(v) => setForm({ ...form, note: v })} multiline placeholder="학습 메모..." />

      <Pressable style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveBtnText}>저장</Text>
      </Pressable>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, multiline && styles.fieldMultiline]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textPlaceholder}
        multiline={multiline}
        autoFocus={autoFocus}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 100 },
  fieldGroup: { marginBottom: spacing.md },
  fieldLabel: { fontSize: fontSize.sm, color: colors.textMuted, marginBottom: spacing.xs },
  fieldInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
  },
  fieldMultiline: { minHeight: 80, textAlignVertical: 'top' },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  saveBtnText: { fontSize: fontSize.lg, fontWeight: '600', color: '#FFFFFF' },
});

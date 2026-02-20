import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useDatabase } from '../../src/components/DatabaseContext';
import { useVocabStore } from '../../src/stores/vocab-store';
import { getEntryById } from '../../src/db';
import type { VocabEntry } from '@mikukotoba/shared';
import { colors, spacing, fontSize } from '../../src/components/theme';
import { markVocabDirty } from '../../src/services/sync-manager';

export default function VocabDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const database = useDatabase();
  const { updateEntry, removeEntry } = useVocabStore();

  const [entry, setEntry] = useState<VocabEntry | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({
    word: '',
    reading: '',
    meaning: '',
    pos: '',
    exampleSentence: '',
    note: '',
    tags: [] as string[],
  });
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    (async () => {
      const data = await getEntryById(database, id);
      if (data) {
        setEntry(data);
        setForm({
          word: data.word,
          reading: data.reading,
          meaning: data.meaning,
          pos: data.pos,
          exampleSentence: data.exampleSentence,
          note: data.note,
          tags: data.tags ?? [],
        });
      }
    })();
  }, [database, id]);

  if (!entry) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>로딩 중...</Text>
      </View>
    );
  }

  const handleSave = async () => {
    const updated: VocabEntry = {
      ...entry,
      ...form,
      timestamp: Date.now(),
    };
    await updateEntry(database, updated);
    markVocabDirty(updated.dateAdded);
    setEntry(updated);
    setIsEditing(false);
  };

  const handleDelete = () => {
    Alert.alert('삭제 확인', `"${entry.word}"를 삭제하시겠습니까?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await removeEntry(database, entry.id);
          markVocabDirty(entry.dateAdded);
          router.back();
        },
      },
    ]);
  };

  const addTag = () => {
    const tag = newTag.trim();
    if (tag && !form.tags.includes(tag)) {
      setForm({ ...form, tags: [...form.tags, tag] });
    }
    setNewTag('');
  };

  const removeTag = (tag: string) => {
    setForm({ ...form, tags: form.tags.filter((t) => t !== tag) });
  };

  if (isEditing) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <Field label="단어" value={form.word} onChange={(v) => setForm({ ...form, word: v })} />
        <Field label="읽기" value={form.reading} onChange={(v) => setForm({ ...form, reading: v })} />
        <Field label="뜻" value={form.meaning} onChange={(v) => setForm({ ...form, meaning: v })} />
        <Field label="품사" value={form.pos} onChange={(v) => setForm({ ...form, pos: v })} />
        <Field label="예문" value={form.exampleSentence} onChange={(v) => setForm({ ...form, exampleSentence: v })} multiline />
        <Field label="메모" value={form.note} onChange={(v) => setForm({ ...form, note: v })} multiline />

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>태그</Text>
          {form.tags.length > 0 && (
            <View style={styles.tagChips}>
              {form.tags.map((t) => (
                <Pressable key={t} style={styles.tagChip} onPress={() => removeTag(t)}>
                  <Text style={styles.tagChipText}>{t} ✕</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={styles.tagInputRow}>
            <TextInput
              style={styles.tagInput}
              value={newTag}
              onChangeText={setNewTag}
              placeholder="태그 추가..."
              placeholderTextColor={colors.textPlaceholder}
              onSubmitEditing={addTag}
              returnKeyType="done"
            />
            <Pressable style={styles.tagAddBtn} onPress={addTag}>
              <Text style={styles.tagAddBtnText}>+</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.editActions}>
          <Pressable style={styles.saveBtn} onPress={handleSave}>
            <Text style={styles.saveBtnText}>저장</Text>
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={() => setIsEditing(false)}>
            <Text style={styles.cancelBtnText}>취소</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.word}>{entry.word}</Text>
      {entry.reading ? <Text style={styles.reading}>{entry.reading}</Text> : null}
      <Text style={styles.meaning}>{entry.meaning}</Text>
      {entry.pos ? <Text style={styles.pos}>{entry.pos}</Text> : null}
      {(entry.tags ?? []).length > 0 && (
        <View style={styles.viewTags}>
          {entry.tags.map((t) => (
            <View key={t} style={styles.viewTag}>
              <Text style={styles.viewTagText}>{t}</Text>
            </View>
          ))}
        </View>
      )}
      {entry.exampleSentence ? (
        <View style={styles.exampleBlock}>
          <Text style={styles.exampleLabel}>예문</Text>
          <Text style={styles.example}>{entry.exampleSentence}</Text>
        </View>
      ) : null}
      {entry.note ? (
        <View style={styles.exampleBlock}>
          <Text style={styles.exampleLabel}>메모</Text>
          <Text style={styles.noteText}>{entry.note}</Text>
        </View>
      ) : null}

      <Text style={styles.meta}>추가일: {entry.dateAdded}</Text>
      {entry.exampleSource ? (
        <Text style={styles.meta}>출처: {entry.exampleSource}</Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable style={styles.editBtn} onPress={() => setIsEditing(true)}>
          <Text style={styles.editBtnText}>편집</Text>
        </Pressable>
        <Pressable style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}>삭제</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, multiline && styles.fieldMultiline]}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        placeholderTextColor={colors.textPlaceholder}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: spacing.lg, paddingBottom: 100 },
  loadingText: { textAlign: 'center', color: colors.textMuted, marginTop: 100 },
  word: { fontSize: 32, fontWeight: '700', color: colors.text },
  reading: { fontSize: fontSize.lg, color: colors.textMuted, marginTop: spacing.xs },
  meaning: {
    fontSize: fontSize.xl,
    fontWeight: '600',
    color: colors.accent,
    marginTop: spacing.md,
  },
  pos: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    backgroundColor: colors.borderLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  exampleBlock: {
    marginTop: spacing.lg,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  exampleLabel: { fontSize: fontSize.xs, color: colors.textPlaceholder, marginBottom: spacing.xs },
  example: { fontSize: fontSize.md, color: colors.textSecondary, fontStyle: 'italic' },
  noteText: { fontSize: fontSize.md, color: colors.textSecondary },
  meta: { fontSize: fontSize.xs, color: colors.textPlaceholder, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  editBtn: {
    flex: 1,
    backgroundColor: colors.borderLight,
    borderRadius: 8,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  editBtnText: { fontSize: fontSize.md, color: colors.text, fontWeight: '500' },
  deleteBtn: {
    backgroundColor: 'rgba(201, 64, 64, 0.1)',
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  deleteBtnText: { fontSize: fontSize.md, color: colors.danger, fontWeight: '500' },
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
  viewTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm,
  },
  viewTag: {
    backgroundColor: colors.accentLight,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  viewTagText: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '500',
  },
  tagChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.sm,
  },
  tagChip: {
    backgroundColor: colors.accentLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tagChipText: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '500',
  },
  tagInputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tagInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
  },
  tagAddBtn: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagAddBtnText: {
    fontSize: fontSize.lg,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  editActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  saveBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  saveBtnText: { fontSize: fontSize.md, color: '#FFFFFF', fontWeight: '600' },
  cancelBtn: {
    backgroundColor: colors.borderLight,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: fontSize.md, color: colors.text },
});

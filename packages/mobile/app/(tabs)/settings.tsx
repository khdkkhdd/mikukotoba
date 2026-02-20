import { View, Text, Pressable, StyleSheet, Switch, Alert } from 'react-native';
import { useDatabase } from '../../src/components/DatabaseContext';
import { useSettingsStore } from '../../src/stores/settings-store';
import { fullSync } from '../../src/services/sync-manager';
import { signIn, signOut, isSignedIn } from '../../src/services/drive-auth';
import { setSyncMeta } from '../../src/db/queries';
import { useVocabStore } from '../../src/stores/vocab-store';
import { colors, spacing, fontSize } from '../../src/components/theme';

export default function SettingsScreen() {
  const database = useDatabase();
  const {
    dailyNewCards,
    setDailyNewCards,
    googleEmail,
    isGoogleConnected,
    setGoogleAccount,
    isSyncing,
    setSyncState,
    lastSyncTime,
  } = useSettingsStore();
  const refreshVocab = useVocabStore((s) => s.refresh);

  const handleGoogleSignIn = async () => {
    try {
      const { email } = await signIn();
      setGoogleAccount(email);
    } catch (e) {
      Alert.alert('로그인 실패', String(e));
    }
  };

  const handleGoogleSignOut = async () => {
    await signOut();
    setGoogleAccount(null);
  };

  const handleSync = async () => {
    setSyncState(true);
    try {
      const result = await fullSync(database);
      const now = Date.now();
      setSyncState(false, now);
      await setSyncMeta(database, 'lastSyncTime', String(now));
      await refreshVocab(database);

      const parts: string[] = [];
      if (result.vocabPulled > 0) parts.push(`단어 ${result.vocabPulled}개 pull`);
      if (result.vocabPushed > 0) parts.push(`단어 ${result.vocabPushed}개 push`);
      if (result.fsrsPulled) parts.push('학습 진도 pull');
      parts.push('학습 진도 push');

      Alert.alert('동기화 완료', parts.join(', '));
    } catch (e) {
      setSyncState(false);
      Alert.alert('동기화 실패', String(e));
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.pageTitle}>설정</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Google 계정</Text>
        {isGoogleConnected ? (
          <View>
            <Text style={styles.email}>{googleEmail}</Text>
            <View style={styles.row}>
              <Pressable style={styles.btn} onPress={handleSync} disabled={isSyncing}>
                <Text style={styles.btnText}>{isSyncing ? '동기화 중...' : 'Drive 동기화'}</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnDanger]} onPress={handleGoogleSignOut}>
                <Text style={[styles.btnText, styles.btnDangerText]}>로그아웃</Text>
              </Pressable>
            </View>
            {lastSyncTime > 0 ? (
              <Text style={styles.lastSync}>
                마지막 동기화: {new Date(lastSyncTime).toLocaleString('ko-KR')}
              </Text>
            ) : null}
          </View>
        ) : (
          <Pressable style={styles.btn} onPress={handleGoogleSignIn}>
            <Text style={styles.btnText}>Google 로그인</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>학습</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>하루 새 단어 수</Text>
          <View style={styles.stepper}>
            <Pressable
              style={styles.stepperBtn}
              onPress={() => setDailyNewCards(Math.max(1, dailyNewCards - 5))}
            >
              <Text style={styles.stepperText}>-</Text>
            </Pressable>
            <Text style={styles.stepperValue}>{dailyNewCards}</Text>
            <Pressable
              style={styles.stepperBtn}
              onPress={() => setDailyNewCards(dailyNewCards + 5)}
            >
              <Text style={styles.stepperText}>+</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    paddingTop: 80,
  },
  pageTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  section: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
  },
  email: {
    fontSize: fontSize.md,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  btn: {
    backgroundColor: colors.borderLight,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  btnText: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: '500',
  },
  btnDanger: {
    backgroundColor: 'rgba(201, 64, 64, 0.1)',
  },
  btnDangerText: {
    color: colors.danger,
  },
  lastSync: {
    fontSize: fontSize.xs,
    color: colors.textPlaceholder,
    marginTop: spacing.sm,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingLabel: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: {
    fontSize: fontSize.lg,
    color: colors.text,
    fontWeight: '600',
  },
  stepperValue: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.accent,
    minWidth: 30,
    textAlign: 'center',
  },
});

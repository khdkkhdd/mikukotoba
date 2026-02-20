import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { initDatabase } from '../src/db/schema';
import { useVocabStore } from '../src/stores/vocab-store';
import { DatabaseContext } from '../src/components/DatabaseContext';
import { initSyncManager, destroySyncManager } from '../src/services/sync-manager';
import { configureDriveAuth, restoreAuthState } from '../src/services/drive-auth';
import { getSyncMeta } from '../src/db/queries';
import { useSettingsStore } from '../src/stores/settings-store';

export default function RootLayout() {
  const [database, setDatabase] = useState<SQLiteDatabase | null>(null);
  const init = useVocabStore((s) => s.init);

  useEffect(() => {
    configureDriveAuth('582194695290-f6rcct950bphqemdgf3mmi2ruu68nbrh.apps.googleusercontent.com');

    (async () => {
      await restoreAuthState();
      const db = await openDatabaseAsync('mikukotoba.db');
      await initDatabase(db);
      setDatabase(db);
      await init(db);
      const saved = await getSyncMeta(db, 'lastSyncTime');
      if (saved) useSettingsStore.getState().setSyncState(false, Number(saved));
      initSyncManager(db);
    })();

    return () => {
      destroySyncManager();
    };
  }, [init]);

  if (!database) return null;

  return (
    <DatabaseContext.Provider value={database}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="vocab/[id]" options={{ headerShown: true, title: '단어 상세' }} />
        <Stack.Screen name="add" options={{ presentation: 'modal', headerShown: true, title: '단어 추가' }} />
      </Stack>
    </DatabaseContext.Provider>
  );
}

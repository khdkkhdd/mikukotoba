import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { initDatabase } from '../src/db/schema';
import { useVocabStore } from '../src/stores/vocab-store';
import { DatabaseContext } from '../src/components/DatabaseContext';

export default function RootLayout() {
  const [database, setDatabase] = useState<SQLiteDatabase | null>(null);
  const init = useVocabStore((s) => s.init);

  useEffect(() => {
    (async () => {
      const db = await openDatabaseAsync('jp-helper.db');
      await initDatabase(db);
      setDatabase(db);
      await init(db);
    })();
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

# 모바일 단어장 태그 기능 기술 명세

> Phase 5 (데이터 계층) + Phase 6 (UI) 구현을 위한 기술 설계.
> 확장 Phase 1-4 완료를 전제로, `VocabEntry.tags: string[]` 필드가 shared 타입에 이미 존재.

---

## 1. DB 스키마 변경

### 1.1 마이그레이션

`packages/mobile/src/db/schema.ts`에 `migrateVocabTags()` 추가:

```typescript
async function migrateVocabTags(db: SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(vocab)');
  if (!cols.some((c) => c.name === 'tags')) {
    await db.execAsync("ALTER TABLE vocab ADD COLUMN tags TEXT DEFAULT '[]'");
  }
}
```

`initDatabase()` 말미에서 호출 (기존 `migrateCardStateLearningSteps` 패턴 동일).

### 1.2 컬럼 설계

| 컬럼 | 타입 | 기본값 | 비고 |
|------|------|--------|------|
| `tags` | `TEXT` | `'[]'` | JSON 문자열 `["JLPT N4","음식"]` |

Junction table 대신 JSON 텍스트 컬럼을 사용하는 이유:
- 단어 수 수천 개 규모에서 JOIN 불필요
- VocabEntry 직렬화/역직렬화가 단순 (`JSON.stringify` / `JSON.parse`)
- Drive 동기화 시 entry 단위 LWW와 자연 호환
- 태그 기반 쿼리는 `LIKE` + in-memory 필터로 충분

---

## 2. 쿼리 변경

### 2.1 직렬화/역직렬화

`packages/mobile/src/db/queries.ts`:

```typescript
// 헬퍼: null-safe JSON.parse
function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function entryToRow(e: VocabEntry) {
  return {
    // ... 기존 필드 ...
    $tags: JSON.stringify(e.tags ?? []),
  };
}

function rowToEntry(row: Record<string, unknown>): VocabEntry {
  return {
    // ... 기존 필드 ...
    tags: parseTags(row.tags),
  };
}
```

### 2.2 upsertEntry SQL

```sql
INSERT OR REPLACE INTO vocab
  (id, word, reading, romaji, meaning, pos, example_sentence, example_source, note, date_added, timestamp, updated_at, tags)
VALUES
  ($id, $word, $reading, $romaji, $meaning, $pos, $example_sentence, $example_source, $note, $date_added, $timestamp, $updated_at, $tags)
```

### 2.3 검색 확장

`searchEntries()`에 tags 컬럼 추가:

```sql
SELECT * FROM vocab
WHERE word LIKE ? OR reading LIKE ? OR meaning LIKE ? OR note LIKE ? OR tags LIKE ?
ORDER BY timestamp DESC LIMIT 100
```

`LIKE '%JLPT%'`는 JSON 문자열 내부도 매칭하므로 부분 일치 검색에 충분.

### 2.4 태그 쿼리 함수 (신규)

```typescript
// 전체 태그 목록 + 카운트
async function getAllTagCounts(db: SQLiteDatabase): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ tags: string }>('SELECT tags FROM vocab');
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const tag of parseTags(row.tags)) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

// 태그로 엔트리 필터 (전체 로드 후 in-memory 필터)
async function getEntriesByTag(db: SQLiteDatabase, tag: string): Promise<VocabEntry[]> {
  // LIKE로 후보 축소 → in-memory 정확 매칭
  const pattern = `%${tag}%`;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM vocab WHERE tags LIKE ? ORDER BY timestamp DESC',
    [pattern]
  );
  return rows.map(rowToEntry).filter((e) => e.tags.includes(tag));
}
```

### 2.5 SRS 태그 필터 쿼리 (신규)

```typescript
// Due 카드 중 특정 태그만
async function getDueCardsWithEntriesByTag(
  db: SQLiteDatabase,
  tag: string | null  // null = 태그 없음 필터
): Promise<CardWithEntry[]> {
  const now = new Date().toISOString();

  if (tag === null) {
    // 태그 없는 카드
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT v.*, cs.state as cs_state, cs.due as cs_due, cs.stability, cs.difficulty,
              cs.elapsed_days, cs.scheduled_days, cs.reps, cs.lapses, cs.last_review, cs.learning_steps
       FROM card_state cs
       JOIN vocab v ON v.id = cs.vocab_id
       WHERE cs.due <= ? AND (v.tags IS NULL OR v.tags = '[]')
       ORDER BY cs.due ASC`,
      [now]
    );
    return rows.map(rowToCardWithEntry);
  }

  // 특정 태그 — LIKE로 후보 축소 + in-memory 정확 매칭
  const pattern = `%${tag}%`;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT v.*, cs.state as cs_state, cs.due as cs_due, cs.stability, cs.difficulty,
            cs.elapsed_days, cs.scheduled_days, cs.reps, cs.lapses, cs.last_review, cs.learning_steps
     FROM card_state cs
     JOIN vocab v ON v.id = cs.vocab_id
     WHERE cs.due <= ? AND v.tags LIKE ?
     ORDER BY cs.due ASC`,
    [now, pattern]
  );
  return rows.map(rowToCardWithEntry).filter((r) => r.entry.tags.includes(tag));
}

// 새 카드 중 특정 태그만 (동일 패턴)
async function getNewCardsWithEntriesByTag(
  db: SQLiteDatabase,
  tag: string | null,
  limit: number
): Promise<CardWithEntry[]> {
  if (tag === null) {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT v.*, NULL as cs_state, NULL as cs_due, NULL as stability, NULL as difficulty,
              NULL as elapsed_days, NULL as scheduled_days, NULL as reps, NULL as lapses,
              NULL as last_review, NULL as learning_steps
       FROM vocab v
       LEFT JOIN card_state cs ON v.id = cs.vocab_id
       WHERE cs.vocab_id IS NULL AND (v.tags IS NULL OR v.tags = '[]')
       ORDER BY v.timestamp ASC LIMIT ?`,
      [limit]
    );
    return rows.map((row) => ({ entry: rowToEntry(row), card: newEmptyCard() }));
  }

  const pattern = `%${tag}%`;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT v.*, NULL as cs_state, NULL as cs_due, NULL as stability, NULL as difficulty,
            NULL as elapsed_days, NULL as scheduled_days, NULL as reps, NULL as lapses,
            NULL as last_review, NULL as learning_steps
     FROM vocab v
     LEFT JOIN card_state cs ON v.id = cs.vocab_id
     WHERE cs.vocab_id IS NULL AND v.tags LIKE ?
     ORDER BY v.timestamp ASC LIMIT ?`,
    [pattern, limit * 2]  // LIKE 오버매칭 대비 2배 로드
  );
  return rows
    .map((row) => ({ entry: rowToEntry(row), card: newEmptyCard() }))
    .filter((r) => r.entry.tags.includes(tag))
    .slice(0, limit);
}

// 태그별 due 카운트 (학습 화면 표시용)
async function getDueCountByTag(db: SQLiteDatabase): Promise<Record<string, number>> {
  const now = new Date().toISOString();
  const rows = await db.getAllAsync<{ tags: string }>(
    `SELECT v.tags FROM card_state cs JOIN vocab v ON v.id = cs.vocab_id WHERE cs.due <= ?`,
    [now]
  );
  const counts: Record<string, number> = {};
  let untagged = 0;
  for (const row of rows) {
    const tags = parseTags(row.tags);
    if (tags.length === 0) { untagged++; continue; }
    for (const t of tags) { counts[t] = (counts[t] ?? 0) + 1; }
  }
  if (untagged > 0) counts[''] = untagged;  // 빈 문자열 키 = 태그없음
  return counts;
}
```

**LIKE + in-memory 필터 패턴의 근거:**
- SQLite에 JSON 함수(`json_each`)가 있지만, expo-sqlite 버전에 따라 미지원 가능
- `LIKE '%tag%'`는 `["JLPT N4"]` 내부 매칭에 충분하되, `"N4"` 검색 시 `"JLPT N4"`도 매칭되는 오버매칭 발생
- in-memory `entry.tags.includes(tag)`로 정확 매칭 보정 — 단어 수 수천 개 규모에서 성능 문제 없음

---

## 3. 동기화

### 3.1 변경 없음

`sync.ts`의 `pushToDrive`/`pullFromDrive`는 `getEntriesByDate()` → `upsertEntries()`를 사용.
`rowToEntry`가 `tags`를 포함하면 JSON 직렬화/역직렬화에 자동 포함된다.

동기화 흐름:
```
Extension 태그 편집
  → Drive vocab_YYYY-MM-DD.json에 tags 포함 push
  → 모바일 pullFromDrive → mergeEntries (LWW) → upsertEntries → tags 컬럼에 저장
  → rowToEntry에서 tags 파싱 → UI에 표시
```

### 3.2 역방향

모바일에서 태그 편집 시 `updateEntry` → `markVocabDirty(date)` → 30초 디바운스 push.
확장이 다음 pull 시 tags 포함 엔트리 수신.

---

## 4. Store 변경

### 4.1 vocab-store 확장

`packages/mobile/src/stores/vocab-store.ts`:

```typescript
interface VocabState {
  // 기존 필드 유지
  entries: VocabEntry[];
  dateGroups: { date: string; count: number }[];
  totalCount: number;
  isLoading: boolean;
  searchQuery: string;

  // 태그 관련 추가
  allTagCounts: Record<string, number>;  // { "JLPT N4": 12, "음식": 5, ... }
  selectedTag: string | null;            // 태그 필터 (null = 전체)

  // 태그 액션 추가
  refreshTags: (database: SQLiteDatabase) => Promise<void>;
  setTagFilter: (database: SQLiteDatabase, tag: string | null) => Promise<void>;
}
```

**`refreshTags`**: `getAllTagCounts()` 호출 → `allTagCounts` 갱신.
기존 `init`, `addEntry`, `updateEntry`, `removeEntry`, `refresh` 내에서 `refreshTags()` 호출 추가.

**`setTagFilter`**: 태그 선택 시 `getEntriesByTag()` 또는 전체 `getAllEntries()` 호출 → `entries` 갱신.

### 4.2 태그 필터와 기존 필터의 조합

```
entries 결정 로직:
  if (searchQuery) → searchEntries(query)          // 검색 우선
  else if (selectedTag) → getEntriesByTag(tag)     // 태그 필터
  else → getAllEntries()                           // 전체
```

날짜 필터(`selectedDate`)는 UI 레벨에서 `entries.filter(e => e.dateAdded === selectedDate)` — store 변경 불필요.

---

## 5. UI 변경

### 5.1 단어장 화면 (`app/(tabs)/vocab.tsx`)

**태그 칩 행 추가:**
검색 입력 위에 수평 스크롤 태그 칩 행. `allTagCounts`에서 생성.

```tsx
<ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagRow}>
  <TagChip label="전체" count={totalCount} active={!selectedTag} onPress={() => setTagFilter(db, null)} />
  {Object.entries(allTagCounts)
    .sort(([,a], [,b]) => b - a)
    .map(([tag, count]) => (
      <TagChip key={tag} label={tag} count={count} active={selectedTag === tag} onPress={() => setTagFilter(db, tag)} />
    ))
  }
</ScrollView>
```

**카드에 태그 칩 표시:**
`entryMeaning` 아래에 `entry.tags` 매핑:

```tsx
{item.tags?.length > 0 && (
  <View style={styles.entryTags}>
    {item.tags.map((t) => (
      <View key={t} style={styles.entryTag}>
        <Text style={styles.entryTagText}>{t}</Text>
      </View>
    ))}
  </View>
)}
```

**스타일 토큰:**

| 요소 | 배경 | 텍스트 | 크기 |
|------|------|--------|------|
| 태그 칩 (필터, 비활성) | `colors.borderLight` | `colors.textSecondary` | `fontSize.sm` |
| 태그 칩 (필터, 활성) | `colors.accent` | `#FFFFFF` | `fontSize.sm` |
| 엔트리 태그 | `colors.accentLight` | `colors.accent` | `fontSize.xs` |

### 5.2 단어 상세/편집 (`app/vocab/[id].tsx`)

**보기 모드:** 품사 아래에 태그 칩 행.

**편집 모드:** `form` state에 `tags: string[]` 추가.

```tsx
// 태그 편집 섹션
<View style={styles.fieldGroup}>
  <Text style={styles.fieldLabel}>태그</Text>
  <View style={styles.tagChips}>
    {form.tags.map((t, i) => (
      <Pressable key={t} style={styles.editTagChip} onPress={() => removeTag(i)}>
        <Text style={styles.editTagText}>{t} ✕</Text>
      </Pressable>
    ))}
  </View>
  <View style={styles.tagInputRow}>
    <TextInput style={styles.tagInput} value={newTag} onChangeText={setNewTag} placeholder="새 태그..." />
    <Pressable style={styles.tagAddBtn} onPress={addTag}><Text style={styles.tagAddText}>추가</Text></Pressable>
  </View>
</View>
```

`handleSave`: `{ ...entry, ...form, timestamp: Date.now() }` — form에 tags 포함되므로 자동 반영.

### 5.3 단어 추가 (`app/add.tsx`)

`form` state에 `tags: string[]` 추가 (초기값 `[]`).
메모 필드 아래에 태그 편집 섹션 (상세 편집과 동일 패턴).
`handleSave`의 entry 리터럴에 `tags: form.tags` 추가.

### 5.4 학습 화면 (`app/(tabs)/study.tsx`)

**ModeSelector에 태그별 학습 섹션 추가:**

```tsx
function ModeSelector({ onSrs, onRelay, onTagStudy }) {
  const [tagDueCounts, setTagDueCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    getDueCountByTag(database).then(setTagDueCounts);
  }, [database]);

  const tagEntries = Object.entries(tagDueCounts).filter(([, count]) => count > 0);

  return (
    <View>
      {/* 기존 오늘의 학습 + 자유 복습 카드 */}

      {tagEntries.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>태그별 학습</Text>
          {tagEntries
            .sort(([,a], [,b]) => b - a)
            .map(([tag, count]) => (
              <Pressable key={tag} style={styles.tagStudyRow} onPress={() => onTagStudy(tag || null)}>
                <Text style={styles.tagName}>{tag || '태그없음'}</Text>
                <Text style={styles.tagDue}>복습 {count}개</Text>
              </Pressable>
            ))
          }
        </>
      )}
    </View>
  );
}
```

### 5.5 SRS 세션 (`src/study/SrsSession.tsx`)

**Props 확장:**

```typescript
interface SrsSessionProps {
  onExit: () => void;
  onStartRelay?: () => void;
  filterTag?: string | null;  // undefined = 전체, null = 태그없음, string = 특정 태그
}
```

**초기화 분기:**

```typescript
// filterTag가 정의되어 있으면 태그 필터 쿼리 사용
const [dueResults, newResults] = await Promise.all([
  filterTag !== undefined
    ? getDueCardsWithEntriesByTag(database, filterTag)
    : getDueCardsWithEntries(database),
  filterTag !== undefined
    ? getNewCardsWithEntriesByTag(database, filterTag, remainingNew)
    : getNewCardsWithEntries(database, remainingNew),
]);
```

**세션 헤더:** `filterTag`가 있으면 `"JLPT N4 학습"`, 없으면 기존 `"오늘의 학습"`.

### 5.6 study.tsx 라우팅

```typescript
type StudyMode = 'select' | 'srs' | 'relay';

const [filterTag, setFilterTag] = useState<string | null | undefined>(undefined);

if (mode === 'srs') {
  return <SrsSession onExit={...} onStartRelay={...} filterTag={filterTag} />;
}

// ModeSelector에서:
onTagStudy={(tag) => { setFilterTag(tag); setMode('srs'); }}
onSrs={() => { setFilterTag(undefined); setMode('srs'); }}
```

---

## 6. 파일 변경 요약

| 파일 | 변경 내용 |
|------|----------|
| `src/db/schema.ts` | `migrateVocabTags()` 추가, `initDatabase()`에서 호출 |
| `src/db/queries.ts` | `parseTags` 헬퍼, `entryToRow`/`rowToEntry` tags 추가, `upsertEntry` SQL 확장, `searchEntries` tags LIKE 추가, 신규: `getAllTagCounts`, `getEntriesByTag`, `getDueCardsWithEntriesByTag`, `getNewCardsWithEntriesByTag`, `getDueCountByTag` |
| `src/stores/vocab-store.ts` | `allTagCounts`, `selectedTag` 상태 추가, `refreshTags`, `setTagFilter` 액션 추가, 기존 CRUD 액션에 `refreshTags` 호출 추가 |
| `app/(tabs)/vocab.tsx` | 태그 칩 필터 행, 카드에 태그 칩 표시 |
| `app/vocab/[id].tsx` | 보기 모드 태그 표시, 편집 모드 태그 추가/제거 UI, form에 tags 필드 |
| `app/add.tsx` | form에 tags 필드, 태그 편집 섹션, entry 리터럴에 tags 포함 |
| `app/(tabs)/study.tsx` | `ModeSelector`에 태그별 학습 섹션, `filterTag` 상태, `SrsSession`에 prop 전달 |
| `src/study/SrsSession.tsx` | `filterTag` prop 추가, 초기화 시 태그 필터 쿼리 분기, 헤더에 태그명 표시 |

동기화 (`sync.ts`, `sync-manager.ts`) 및 FSRS (`fsrs/index.ts`) — 변경 없음.

---

## 7. 검증

1. `tags` 마이그레이션: 기존 DB에서 앱 시작 → `PRAGMA table_info(vocab)` 확인
2. 확장에서 태그 붙인 단어 동기화 → 모바일 단어장에서 태그 칩 표시
3. 모바일에서 태그 편집 → 저장 → Drive push → 확장에서 태그 반영
4. 태그 필터: 단어장에서 태그 칩 탭 → 해당 태그만 표시 + 카운트 갱신
5. 태그별 학습: 학습 화면에서 태그 탭 → 해당 태그 due 카드만 세션에 포함
6. 태그 없는 단어: `tags: []` → "태그없음" 필터에 포함, 전체 보기에도 포함
7. 검색: "JLPT" 검색 → 태그에 "JLPT N4"가 포함된 단어도 결과에 나옴
8. 하위 호환: 기존 단어 (`tags` 컬럼 NULL 또는 `'[]'`) → `parseTags`가 빈 배열 반환

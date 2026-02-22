#!/usr/bin/env node

/**
 * 읽기 교정 엔트리 추가 CLI
 *
 * 사용법:
 *   node tools/add-reading-override.mjs --surface 田舎 --wrong たしゃ --correct いなか --note "올바른 읽기"
 *   node tools/add-reading-override.mjs   (대화형)
 */

import { readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'packages', 'extension', 'src', 'core', 'analyzer', 'reading-overrides.json');

function loadOverrides() {
  return JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
}

function saveOverrides(data) {
  // surface 기준 정렬
  data.sort((a, b) => a.surface.localeCompare(b.surface, 'ja'));
  writeFileSync(JSON_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function isDuplicate(data, surface, kuromojiReading) {
  return data.some(e => e.surface === surface && e.kuromojiReading === kuromojiReading);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--surface') args.surface = argv[++i];
    else if (argv[i] === '--wrong') args.wrong = argv[++i];
    else if (argv[i] === '--correct') args.correct = argv[++i];
    else if (argv[i] === '--note') args.note = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`사용법: node tools/add-reading-override.mjs [옵션]

옵션:
  --surface   표층형 (예: 田舎)
  --wrong     kuromoji가 반환하는 잘못된 읽기 (예: たしゃ)
  --correct   올바른 읽기 (예: いなか)
  --note      메모 (선택사항)
  -h, --help  도움말`);
      process.exit(0);
    }
  }
  return args;
}

async function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  const args = parseArgs(process.argv);

  let { surface, wrong, correct, note } = args;

  // 인자가 부족하면 대화형 입력
  if (!surface || !wrong || !correct) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (!surface) surface = await prompt(rl, '표층형 (surface): ');
    if (!wrong) wrong = await prompt(rl, 'kuromoji 잘못된 읽기 (wrong): ');
    if (!correct) correct = await prompt(rl, '올바른 읽기 (correct): ');
    if (note === undefined) {
      note = await prompt(rl, '메모 (note, 엔터로 생략): ');
    }
    rl.close();
  }

  if (!surface || !wrong || !correct) {
    console.error('오류: surface, wrong, correct는 필수입니다.');
    process.exit(1);
  }

  const data = loadOverrides();

  if (isDuplicate(data, surface, wrong)) {
    console.error(`중복: surface="${surface}", kuromojiReading="${wrong}" 조합이 이미 존재합니다.`);
    process.exit(1);
  }

  const entry = {
    surface,
    kuromojiReading: wrong,
    correctReading: correct,
  };
  if (note) entry.note = note;

  data.push(entry);
  saveOverrides(data);

  console.log(`추가 완료: ${surface} (${wrong} → ${correct})`);
  console.log(`총 ${data.length}개 오버라이드`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

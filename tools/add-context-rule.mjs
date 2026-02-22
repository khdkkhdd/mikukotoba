#!/usr/bin/env node

/**
 * 문맥 규칙 (연속 토큰 패턴) 추가 CLI
 *
 * 사용법:
 *   node tools/add-context-rule.mjs --pattern "音,ノ,乃" --readings "の,の,の" --note "음ノ乃"
 *   node tools/add-context-rule.mjs --pattern "一,人" --readings "ひと,り" --when "いち,にん"
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'packages', 'extension', 'src', 'core', 'analyzer', 'context-rules.json');

function loadRules() {
  return JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
}

function saveRules(data) {
  // pattern 첫 요소 기준 정렬
  data.sort((a, b) => a.pattern[0].localeCompare(b.pattern[0], 'ja'));
  writeFileSync(JSON_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function isDuplicate(data, pattern) {
  return data.some(e => e.pattern.length === pattern.length && e.pattern.every((p, i) => p === pattern[i]));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--pattern') args.pattern = argv[++i];
    else if (argv[i] === '--readings') args.readings = argv[++i];
    else if (argv[i] === '--when') args.when = argv[++i];
    else if (argv[i] === '--note') args.note = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`사용법: node tools/add-context-rule.mjs [옵션]

옵션:
  --pattern   연속 토큰 surface (쉼표 구분, 예: "一,人")
  --readings  교정할 읽기 (쉼표 구분, 예: "ひと,り")
  --when      현재 읽기 조건 (쉼표 구분, 선택사항, 예: "いち,にん")
  --note      메모 (선택사항)
  -h, --help  도움말`);
      process.exit(0);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.pattern || !args.readings) {
    console.error('오류: --pattern과 --readings는 필수입니다.');
    console.error('도움말: node tools/add-context-rule.mjs --help');
    process.exit(1);
  }

  const pattern = args.pattern.split(',');
  const readings = args.readings.split(',');

  if (pattern.length !== readings.length) {
    console.error(`오류: pattern(${pattern.length}개)과 readings(${readings.length}개)의 길이가 다릅니다.`);
    process.exit(1);
  }

  const data = loadRules();

  if (isDuplicate(data, pattern)) {
    console.error(`중복: pattern [${pattern.join(', ')}] 조합이 이미 존재합니다.`);
    process.exit(1);
  }

  const entry = { pattern, readings };
  if (args.when) {
    const whenReadings = args.when.split(',');
    if (whenReadings.length !== pattern.length) {
      console.error(`오류: when(${whenReadings.length}개)과 pattern(${pattern.length}개)의 길이가 다릅니다.`);
      process.exit(1);
    }
    entry.whenReadings = whenReadings;
  }
  if (args.note) entry.note = args.note;

  data.push(entry);
  saveRules(data);

  console.log(`추가 완료: [${pattern.join(', ')}] → [${readings.join(', ')}]`);
  console.log(`총 ${data.length}개 문맥 규칙`);
}

main();

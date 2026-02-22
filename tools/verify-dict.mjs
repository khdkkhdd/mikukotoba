#!/usr/bin/env node

/**
 * 사전 빌드 검증 스크립트: benchmark-texts.json을 사용하여 토큰화 결과 비교
 *
 * 사용법:
 *   node tools/verify-dict.mjs                    # 현재 dict/ 검증
 *   node tools/verify-dict.mjs --save baseline    # 결과를 baseline으로 저장
 *   node tools/verify-dict.mjs --compare baseline # baseline과 비교
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DICT_PATH = path.resolve(ROOT, 'packages/extension/dict/');

const kuromoji = require('kuromoji');

const benchmarkTexts = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'benchmark-texts.json'), 'utf-8')
);

function katakanaToHiragana(str) {
  return str.replace(/[\u30A1-\u30F6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

async function buildTokenizer() {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: DICT_PATH }).build((err, tokenizer) => {
      if (err) reject(err);
      else resolve(tokenizer);
    });
  });
}

async function main() {
  const saveAs = process.argv.includes('--save') ? process.argv[process.argv.indexOf('--save') + 1] : null;
  const compareWith = process.argv.includes('--compare') ? process.argv[process.argv.indexOf('--compare') + 1] : null;

  console.log('사전 경로:', DICT_PATH);
  console.log('Tokenizer 로딩...');
  const tokenizer = await buildTokenizer();
  console.log('로딩 완료\n');

  const results = {};
  let passCount = 0;
  let failCount = 0;

  for (const { text, expected } of benchmarkTexts) {
    const tokens = tokenizer.tokenize(text);
    const tokenResult = {};
    for (const t of tokens) {
      const reading = t.reading ? katakanaToHiragana(t.reading) : t.surface_form;
      tokenResult[t.surface_form] = reading;
    }

    results[text] = tokenResult;

    // expected 체크
    let pass = true;
    for (const [surface, expectedReading] of Object.entries(expected)) {
      const actualReading = tokenResult[surface];
      if (actualReading === expectedReading) {
        console.log(`  ✓ ${surface}: ${actualReading}`);
      } else if (actualReading) {
        console.log(`  ✗ ${surface}: ${actualReading} (expected: ${expectedReading})`);
        pass = false;
      } else {
        // surface가 분리된 경우 (예: 一人 → 一 + 人)
        console.log(`  ? ${surface}: 토큰 분리됨 (expected: ${expectedReading})`);
        pass = false;
      }
    }

    if (pass) passCount++;
    else failCount++;

    console.log(`「${text}」 → ${pass ? 'PASS' : 'FAIL'}`);
    console.log(`  tokens: ${tokens.map(t => `${t.surface_form}(${katakanaToHiragana(t.reading || '')})`).join(' ')}`);
    console.log();
  }

  console.log(`\n=== 결과: ${passCount} PASS / ${failCount} FAIL ===`);

  // 결과 저장
  if (saveAs) {
    const outPath = path.resolve(__dirname, `${saveAs}.json`);
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n결과 저장: ${outPath}`);
  }

  // baseline 비교
  if (compareWith) {
    const baselinePath = path.resolve(__dirname, `${compareWith}.json`);
    if (!fs.existsSync(baselinePath)) {
      console.error(`\nbaseline 파일 없음: ${baselinePath}`);
      process.exit(1);
    }
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));

    console.log('\n=== Baseline 비교 ===');
    let sameCount = 0;
    let diffCount = 0;
    let newCount = 0;

    for (const [text, tokenResult] of Object.entries(results)) {
      const baselineResult = baseline[text];
      if (!baselineResult) {
        newCount++;
        continue;
      }

      for (const [surface, reading] of Object.entries(tokenResult)) {
        const baselineReading = baselineResult[surface];
        if (!baselineReading) {
          // 새 토큰 (NEologd가 추가한 경우)
          continue;
        }
        if (reading !== baselineReading) {
          console.log(`  변경: ${surface} in 「${text}」: ${baselineReading} → ${reading}`);
          diffCount++;
        } else {
          sameCount++;
        }
      }
    }

    console.log(`\n동일: ${sameCount}, 변경: ${diffCount}, 새 텍스트: ${newCount}`);
    if (diffCount > 0) {
      console.log('⚠ 기존 읽기가 변경된 항목이 있습니다!');
    } else {
      console.log('✓ 기존 읽기에 변경 없음');
    }
  }
}

main().catch(err => {
  console.error('검증 실패:', err);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * 사전 빌드 스크립트: IPAdic + NEologd → kuromoji .dat.gz 파일 생성
 *
 * 사용법:
 *   node tools/build-dict.mjs                    # IPAdic + NEologd (필터링)
 *   node tools/build-dict.mjs --ipadic-only      # IPAdic만 (검증용)
 *
 * 출력: packages/extension/dict/*.dat.gz
 *
 * NEologd 필터링 기준:
 * - 한자를 포함하는 엔트리만 (후리가나에 유용한 것만)
 * - 카오모지 제외
 * - surface 20자 이하
 * - 표기 변형(ortho-variant) 사전은 전체 포함
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import readline from 'readline';
import { execSync } from 'child_process';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DICT_OUT = path.resolve(ROOT, 'packages/extension/dict');

const kuromoji = require('kuromoji');
const IPADic = require('mecab-ipadic-seed');

const ipadicOnly = process.argv.includes('--ipadic-only');

const KANJI_REGEX = /[\u4E00-\u9FFF]/;

// 후리가나에 유용한 NEologd POS 카테고리
const USEFUL_POS = new Set([
  '名詞,固有名詞,人名',   // 인명 (非標準 읽기 많음)
  '名詞,固有名詞,地域',   // 지명
  '名詞,固有名詞,組織',   // 조직명
  '名詞,固有名詞,一般',   // 일반 고유명사
  '名詞,一般,*',          // 일반 명사 (신조어)
  '名詞,サ変接続,*',      // 사변 접속 명사
]);

/**
 * NEologd 엔트리 필터: 후리가나 생성에 유용한 엔트리만 선별
 * - 한자 포함 엔트리만 (후리가나 목적)
 * - 인명/지명/조직명 + 일반명사
 * - 카오모지, 해시태그, 긴 엔트리 제외
 */
function shouldIncludeNeologdEntry(line, isOrthoVariant) {
  // 표기 변형 사전: 한자 포함 엔트리만
  if (isOrthoVariant) {
    if (!line.length || line.includes('カオモジ')) return false;
    const surface = line.split(',')[0];
    return KANJI_REGEX.test(surface) && surface.length <= 15;
  }

  const fields = line.split(',');
  if (fields.length < 13) return false;

  const surface = fields[0];
  const reading = fields[11];

  // 카오모지 제외
  if (reading === 'カオモジ') return false;

  // 한자를 포함해야 함
  if (!KANJI_REGEX.test(surface)) return false;

  // 너무 긴 엔트리 제외
  if (surface.length > 15) return false;

  // 유용한 POS 카테고리만
  const pos = `${fields[4]},${fields[5]},${fields[6]}`;
  if (!USEFUL_POS.has(pos)) return false;

  return true;
}

async function main() {
  console.log('=== 사전 빌드 시작 ===');
  console.log(`모드: ${ipadicOnly ? 'IPAdic만' : 'IPAdic + NEologd (필터링)'}`);

  const builder = kuromoji.dictionaryBuilder();
  let tokenInfoCount = 0;

  // 1. IPAdic 토큰 정보 읽기
  console.log('\n[1/5] IPAdic 토큰 정보 읽기...');
  const dic = new IPADic();

  await dic.readTokenInfo((line) => {
    builder.addTokenInfoDictionary(line);
    tokenInfoCount++;
  });
  console.log(`  IPAdic 토큰: ${tokenInfoCount.toLocaleString()}개`);

  // 2. NEologd 시드 파일 추가 (필터링 + 우선순위 적용)
  // 목표: 원본 dict 17MB → 최대 35MB (NEologd ~350K 엔트리)
  const MAX_NEOLOGD_ENTRIES = 350_000;

  if (!ipadicOnly) {
    console.log('\n[2/5] NEologd 시드 파일 읽기 (필터링)...');
    const seedDir = path.resolve(__dirname, 'neologd-seeds');

    // .csv.xz 파일 자동 해제
    const xzFiles = fs.readdirSync(seedDir).filter(f => f.endsWith('.csv.xz'));
    for (const xz of xzFiles) {
      const csvName = xz.replace('.xz', '');
      if (!fs.existsSync(path.resolve(seedDir, csvName))) {
        console.log(`  해제: ${xz} ...`);
        execSync(`xz -dk "${path.resolve(seedDir, xz)}"`);
      }
    }

    const csvFiles = fs.readdirSync(seedDir)
      .filter(f => f.endsWith('.csv'))
      .sort();

    // Pass 1: 필터링 후 수집 (짧은 surface 우선 정렬용)
    const candidates = [];
    let filteredOut = 0;

    for (const csvFile of csvFiles) {
      const csvPath = path.resolve(seedDir, csvFile);
      const isOrthoVariant = csvFile.includes('ortho-variant');

      const rl = readline.createInterface({
        input: fs.createReadStream(csvPath, 'utf-8'),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        if (shouldIncludeNeologdEntry(line, isOrthoVariant)) {
          candidates.push(line);
        } else {
          filteredOut++;
        }
      }
    }
    console.log(`  필터 통과: ${candidates.length.toLocaleString()}개, 제외: ${filteredOut.toLocaleString()}개`);

    // Pass 2: surface 길이 기준 우선순위 (짧을수록 자주 등장 → 유용)
    candidates.sort((a, b) => {
      const surfaceA = a.split(',')[0];
      const surfaceB = b.split(',')[0];
      return surfaceA.length - surfaceB.length;
    });

    const selected = candidates.slice(0, MAX_NEOLOGD_ENTRIES);
    console.log(`  선택: ${selected.length.toLocaleString()}개 (최대 ${MAX_NEOLOGD_ENTRIES.toLocaleString()}개)`);

    for (const line of selected) {
      builder.addTokenInfoDictionary(line);
      tokenInfoCount++;
    }
    console.log(`  총 토큰: ${tokenInfoCount.toLocaleString()}개`);
  } else {
    console.log('\n[2/5] NEologd 스킵 (--ipadic-only)');
  }

  // 3. Connection costs matrix
  console.log('\n[3/5] matrix.def 읽기...');
  await dic.readMatrixDef((line) => {
    builder.putCostMatrixLine(line);
  });
  console.log('  완료');

  // 4. Unknown word definition
  console.log('\n[4/5] unk.def 읽기...');
  await dic.readUnkDef((line) => {
    builder.putUnkDefLine(line);
  });
  console.log('  완료');

  // 5. Character definition
  console.log('\n[4.5/5] char.def 읽기...');
  await dic.readCharDef((line) => {
    builder.putCharDefLine(line);
  });
  console.log('  완료');

  // 6. Build
  console.log('\n[5/5] 바이너리 사전 빌드...');
  const builtDic = builder.build();
  console.log('  빌드 완료');

  // 7. 버퍼 추출
  function toBuffer(typed) {
    const ab = typed.buffer;
    const buffer = Buffer.alloc(ab.byteLength);
    const view = new Uint8Array(ab);
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = view[i];
    }
    return buffer;
  }

  const files = {
    'base.dat': toBuffer(builtDic.trie.bc.getBaseBuffer()),
    'check.dat': toBuffer(builtDic.trie.bc.getCheckBuffer()),
    'tid.dat': toBuffer(builtDic.token_info_dictionary.dictionary.buffer),
    'tid_pos.dat': toBuffer(builtDic.token_info_dictionary.pos_buffer.buffer),
    'tid_map.dat': toBuffer(builtDic.token_info_dictionary.targetMapToBuffer()),
    'cc.dat': toBuffer(builtDic.connection_costs.buffer),
    'unk.dat': toBuffer(builtDic.unknown_dictionary.dictionary.buffer),
    'unk_pos.dat': toBuffer(builtDic.unknown_dictionary.pos_buffer.buffer),
    'unk_map.dat': toBuffer(builtDic.unknown_dictionary.targetMapToBuffer()),
    'unk_char.dat': toBuffer(builtDic.unknown_dictionary.character_definition.character_category_map),
    'unk_compat.dat': toBuffer(builtDic.unknown_dictionary.character_definition.compatible_category_map),
    'unk_invoke.dat': toBuffer(builtDic.unknown_dictionary.character_definition.invoke_definition_map.toBuffer()),
  };

  // 8. gzip 압축 및 저장
  console.log('\ngzip 압축 및 저장...');
  if (!fs.existsSync(DICT_OUT)) {
    fs.mkdirSync(DICT_OUT, { recursive: true });
  }

  let totalSize = 0;
  for (const [name, buffer] of Object.entries(files)) {
    const outPath = path.resolve(DICT_OUT, `${name}.gz`);
    await pipeline(
      Readable.from(buffer),
      createGzip({ level: 9 }),
      fs.createWriteStream(outPath),
    );
    const gzSize = fs.statSync(outPath).size;
    totalSize += gzSize;
    console.log(`  ${name}.gz: ${(gzSize / 1024).toFixed(1)} KB (원본: ${(buffer.length / 1024).toFixed(1)} KB)`);
  }

  console.log(`\n총 사전 크기: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
  console.log('=== 사전 빌드 완료 ===');
}

main().catch(err => {
  console.error('빌드 실패:', err);
  process.exit(1);
});

import type { TranslationContext, LearningLevel } from '@/types';

// ──────────────── Level-specific prompt templates ────────────────

const LEVEL_TEMPLATES: Record<LearningLevel, string> = {
  beginner: `당신은 일본어→한국어 전문 번역가입니다. 초급 학습자를 위한 번역입니다.

번역 규칙:
1. 쉬운 한국어로 번역 (어려운 한자어보다 순우리말 우선)
2. 생략된 주어를 명시적으로 보충
3. 의태어/의성어는 한국어 대응어로 번역하되, 원문을 괄호로 병기
4. 문화적 고유 표현은 쉽게 의역하고 괄호로 원문 병기
5. 원문의 줄바꿈을 그대로 유지하세요.
6. 번역 결과만 출력하세요. 설명이나 주석은 제외하세요.`,

  elementary: `당신은 일본어→한국어 전문 번역가입니다. 초중급 학습자를 위한 번역입니다.

번역 규칙:
1. 경어 수준 대응 (丁寧語→해요체, タメ口→반말)
2. 생략된 주어는 문맥에서 추론하여 포함
3. 의태어/의성어는 한국어 대응어로 번역
4. 종조사 뉘앙스 보존 (ね→~지요/~네요, よ→단정)
5. 문화적 고유 표현은 의역하되 괄호로 원문 병기
6. 원문의 줄바꿈을 그대로 유지하세요.
7. 번역 결과만 출력하세요. 설명이나 주석은 제외하세요.`,

  intermediate: `당신은 일본어→한국어 전문 번역가입니다.

번역 규칙:
1. 경어 수준 정확 대응 (丁寧語→해요체, 尊敬語→높임말, 謙譲語→겸양, タメ口→반말)
2. 생략된 주어는 문맥에서 추론하여 자연스럽게 포함
3. 의태어/의성어는 한국어 대응어로 번역
4. 종조사 뉘앙스 보존 (ね→~지요/~네요, よ→단정, わ→부드러운 어미)
5. 문화적 고유 표현은 의역하되 괄호로 원문 병기
6. 원문의 줄바꿈을 그대로 유지하세요.
7. 번역 결과만 출력하세요. 설명이나 주석은 제외하세요.`,

  advanced: `당신은 일본어→한국어 전문 번역가입니다. 고급 학습자/원어민 수준 번역입니다.

번역 규칙:
1. 경어 수준 정밀 대응 (丁寧語/尊敬語/謙譲語/丁重語/美化語 구분)
2. 생략된 주어를 문맥상 자연스러울 때만 보충 (과잉 보충 금지)
3. 의태어/의성어는 자연스러운 한국어로 번역 (병기 불필요)
4. 종조사·문말 뉘앙스를 가능한 한 살려서 번역
5. 문화적 표현은 자연스러운 한국어로 의역 (괄호 병기 최소화)
6. 원문의 줄바꿈을 그대로 유지하세요.
7. 번역 결과만 출력하세요. 설명이나 주석은 제외하세요.`,
};

// ──────────────── Prompt builders ────────────────

export function buildSystemPrompt(context: TranslationContext, level?: LearningLevel): string {
  let prompt = LEVEL_TEMPLATES[level || 'intermediate'];

  if (context.title || context.channel) {
    prompt += '\n\n--- 영상 정보 ---';
    if (context.title) prompt += `\n영상 제목: ${context.title}`;
    if (context.channel) prompt += `\n채널: ${context.channel}`;
  }

  if (context.glossaryEntries && context.glossaryEntries.length > 0) {
    prompt += '\n\n--- 용어집 ---';
    for (const entry of context.glossaryEntries) {
      prompt += `\n- ${entry.japanese} → ${entry.korean}`;
      if (entry.note) prompt += ` (${entry.note})`;
    }
  }

  if (context.userCorrections && context.userCorrections.length > 0) {
    prompt += '\n\n--- 사용자 선호 번역 참고 ---';
    for (const correction of context.userCorrections) {
      prompt += `\n- "${correction.original}" → "${correction.newTranslation}" (선호)`;
    }
  }

  return prompt;
}

export function buildPrompt(text: string, context: TranslationContext): string {
  let prompt = '';

  if (context.previousSentences.length > 0) {
    prompt += '이전 문맥:\n';
    for (const sentence of context.previousSentences) {
      prompt += `- ${sentence}\n`;
    }
    prompt += '\n';
  }

  prompt += `다음 일본어를 한국어로 번역해주세요:\n${text}`;

  return prompt;
}

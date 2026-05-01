import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const testCases = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../test-cases.json'), 'utf-8')
);

async function queryLLM(ingredients) {
  const start = Date.now();

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `다음 약물 성분들의 상호작용, 병용금기, 노인주의, 임부금기, 효능군중복을 분석해주세요.

성분 목록: ${ingredients.join(', ')}

다음 JSON 형식으로만 응답해주세요. 다른 텍스트 없이:
[
  {
    "type": "CONTRAINDICATED | ELDERLY | DUPLICATE | PREGNANCY | OVERDOSE | DURATION",
    "severity": "CRITICAL | HIGH | MEDIUM | LOW",
    "involvedIngredients": ["성분1", "성분2"],
    "reason": "이유"
  }
]

경고가 없으면 빈 배열 []을 반환하세요.`
    }]
  });

  const elapsed = Date.now() - start;
  const text = response.choices[0].message.content ?? '[]';

  let result = [];
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    result = JSON.parse(clean);
  } catch {
    result = [];
  }

  return { result, elapsed };
}

async function main() {
  console.log('=== LLM Direct 실험 시작 ===\n');

  const results = [];

  for (const tc of testCases) {
    console.log(`[케이스 ${tc.id}] ${tc.name}`);
    console.log(`성분: ${tc.ingredients.join(', ')}`);

    const { result, elapsed } = await queryLLM(tc.ingredients);

    console.log(`응답시간: ${elapsed}ms`);
    console.log(`탐지된 경고: ${result.length}개`);
    console.log(`예상 경고: ${tc.expected.length}개`);

    // 정확도 계산
    const detected = result.map(r => r.type);
    const expected = tc.expected.map(e => e.type);

    const tp = expected.filter(e => detected.includes(e)).length;
    const fp = detected.filter(d => !expected.includes(d)).length;
    const fn = expected.filter(e => !detected.includes(e)).length;

    const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1;

    console.log(`Precision: ${(precision * 100).toFixed(1)}%`);
    console.log(`Recall: ${(recall * 100).toFixed(1)}%`);
    console.log('---');

    results.push({
      id: tc.id,
      name: tc.name,
      method: 'llm-direct',
      elapsed,
      detected: result,
      expected: tc.expected,
      precision,
      recall,
    });

    // API 과부하 방지
    await new Promise(r => setTimeout(r, 500));
  }

  // 결과 저장
  fs.writeFileSync(
    path.join(__dirname, '../results/llm-direct.json'),
    JSON.stringify(results, null, 2),
    'utf-8'
  );

  // 전체 평균
  const avgPrecision = results.reduce((s, r) => s + r.precision, 0) / results.length;
  const avgRecall = results.reduce((s, r) => s + r.recall, 0) / results.length;
  const avgElapsed = results.reduce((s, r) => s + r.elapsed, 0) / results.length;

  console.log('\n=== 전체 결과 ===');
  console.log(`평균 Precision: ${(avgPrecision * 100).toFixed(1)}%`);
  console.log(`평균 Recall: ${(avgRecall * 100).toFixed(1)}%`);
  console.log(`평균 응답시간: ${avgElapsed.toFixed(0)}ms`);
}

main();

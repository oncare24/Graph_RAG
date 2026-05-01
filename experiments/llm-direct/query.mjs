import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const testCases = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../test-cases.json'), 'utf-8')
);

async function queryLLM(ingredients, totalDays) {
  const start = Date.now();

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `다음 약물 성분들의 상호작용, 병용금기, 노인주의, 임부금기, 효능군중복을 분석해주세요.

성분 목록: ${ingredients.join(', ')}
${totalDays ? `총 투여일수: ${totalDays}일` : ''}

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

function calcMetrics(detected, expected) {
  const detectedTypes = [...new Set(detected.map(r => r.type))];
  const expectedTypes = [...new Set(expected.map(e => e.type))];

  if (expectedTypes.length === 0) {
    return { recall: detectedTypes.length === 0 ? 1 : 0 };
  }

  const matched = expectedTypes.filter(e => detectedTypes.includes(e)).length;
  const recall = matched / expectedTypes.length;

  return { recall };
}

async function main() {
  console.log('=== LLM Direct 실험 시작 ===\n');
  const results = [];

  for (const tc of testCases) {
    console.log(`[케이스 ${tc.id}] ${tc.name}`);
    console.log(`성분: ${tc.ingredients.join(', ')}`);

    const { result, elapsed } = await queryLLM(tc.ingredients, tc.totalDays);
    const { recall } = calcMetrics(result, tc.expected);

    console.log(`응답시간: ${elapsed}ms`);
    console.log(`탐지 경고 수: ${result.length}개`);
    console.log(`예상 경고 수: ${tc.expected.length}개`);
    console.log(`Recall: ${(recall * 100).toFixed(1)}%`);
    console.log('---');

    results.push({
      id: tc.id,
      name: tc.name,
      method: 'llm-direct',
      elapsed,
      detectedCount: result.length,
      expectedCount: tc.expected.length,
      detected: result,
      expected: tc.expected,
      recall,
    });

    await new Promise(r => setTimeout(r, 500));
  }

  fs.writeFileSync(
    path.join(__dirname, '../results/llm-direct.json'),
    JSON.stringify(results, null, 2),
    'utf-8'
  );

  const avgRecall = results.reduce((s, r) => s + r.recall, 0) / results.length;
  const avgElapsed = results.reduce((s, r) => s + r.elapsed, 0) / results.length;
  const avgDetected = results.reduce((s, r) => s + r.detectedCount, 0) / results.length;

  console.log('\n=== LLM Direct 전체 결과 ===');
  console.log(`평균 Recall: ${(avgRecall * 100).toFixed(1)}%`);
  console.log(`평균 응답시간: ${avgElapsed.toFixed(0)}ms`);
  console.log(`평균 탐지 경고 수: ${avgDetected.toFixed(1)}개`);
}

main();

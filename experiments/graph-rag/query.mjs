import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testCases = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../test-cases.json'), 'utf-8')
);

async function queryGraphRAG(ingredients, totalDays) {
  const start = Date.now();
  const res = await fetch('http://localhost:3000/drug/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      drugs: [{ drugName: 'test', ingredients, totalDays }]
    }),
  });
  const result = await res.json();
  const elapsed = Date.now() - start;
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
  console.log('=== Graph RAG 실험 시작 ===\n');
  const results = [];

  for (const tc of testCases) {
    console.log(`[케이스 ${tc.id}] ${tc.name}`);
    console.log(`성분: ${tc.ingredients.join(', ')}`);

    const { result, elapsed } = await queryGraphRAG(tc.ingredients, tc.totalDays);
    const { recall } = calcMetrics(result, tc.expected);

    console.log(`응답시간: ${elapsed}ms`);
    console.log(`탐지 경고 수: ${result.length}개`);
    console.log(`예상 경고 수: ${tc.expected.length}개`);
    console.log(`Recall: ${(recall * 100).toFixed(1)}%`);
    console.log('---');

    results.push({
      id: tc.id,
      name: tc.name,
      method: 'graph-rag',
      elapsed,
      detectedCount: result.length,
      expectedCount: tc.expected.length,
      detected: result.map(r => ({ type: r.type, involvedIngredients: r.involvedIngredients })),
      expected: tc.expected,
      recall,
    });
  }

  fs.writeFileSync(
    path.join(__dirname, '../results/graph-rag.json'),
    JSON.stringify(results, null, 2),
    'utf-8'
  );

  const avgRecall = results.reduce((s, r) => s + r.recall, 0) / results.length;
  const avgElapsed = results.reduce((s, r) => s + r.elapsed, 0) / results.length;
  const avgDetected = results.reduce((s, r) => s + r.detectedCount, 0) / results.length;

  console.log('\n=== Graph RAG 전체 결과 ===');
  console.log(`평균 Recall: ${(avgRecall * 100).toFixed(1)}%`);
  console.log(`평균 응답시간: ${avgElapsed.toFixed(0)}ms`);
  console.log(`평균 탐지 경고 수: ${avgDetected.toFixed(1)}개`);
}

main();

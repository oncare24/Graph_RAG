import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testCases = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../test-cases.json'), 'utf-8')
);

async function queryGraphRAG(ingredients) {
  const start = Date.now();

  const res = await fetch('http://localhost:3000/drug/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      drugs: [{ drugName: 'test', ingredients }]
    }),
  });

  const result = await res.json();
  const elapsed = Date.now() - start;

  return { result, elapsed };
}

async function main() {
  console.log('=== Graph RAG 실험 시작 ===\n');

  const results = [];

  for (const tc of testCases) {
    console.log(`[케이스 ${tc.id}] ${tc.name}`);
    console.log(`성분: ${tc.ingredients.join(', ')}`);

    const { result, elapsed } = await queryGraphRAG(tc.ingredients);

    console.log(`응답시간: ${elapsed}ms`);
    console.log(`탐지된 경고: ${result.length}개`);
    console.log(`예상 경고: ${tc.expected.length}개`);

    const detected = result.map(r => r.type);
    const expected = tc.expected.map(e => e.type);

    const tp = expected.filter(e => detected.includes(e)).length;
    const fp = detected.filter(d => !expected.includes(d)).length;
    const fn = expected.filter(e => !detected.includes(e)).length;

    const precision = tp + fp > 0 ? tp / (tp + fp) : (expected.length === 0 ? 1 : 0);
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1;

    console.log(`Precision: ${(precision * 100).toFixed(1)}%`);
    console.log(`Recall: ${(recall * 100).toFixed(1)}%`);
    console.log('---');

    results.push({
      id: tc.id,
      name: tc.name,
      method: 'graph-rag',
      elapsed,
      detected: result.map(r => ({ type: r.type, involvedIngredients: r.involvedIngredients })),
      expected: tc.expected,
      precision,
      recall,
    });
  }

  fs.writeFileSync(
    path.join(__dirname, '../results/graph-rag.json'),
    JSON.stringify(results, null, 2),
    'utf-8'
  );

  const avgPrecision = results.reduce((s, r) => s + r.precision, 0) / results.length;
  const avgRecall = results.reduce((s, r) => s + r.recall, 0) / results.length;
  const avgElapsed = results.reduce((s, r) => s + r.elapsed, 0) / results.length;

  console.log('\n=== Graph RAG 전체 결과 ===');
  console.log(`평균 Precision: ${(avgPrecision * 100).toFixed(1)}%`);
  console.log(`평균 Recall: ${(avgRecall * 100).toFixed(1)}%`);
  console.log(`평균 응답시간: ${avgElapsed.toFixed(0)}ms`);
}

main();

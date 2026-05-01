import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testCases = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../test-cases.json'), 'utf-8')
);

async function queryGraphOnly(ingredients) {
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
  const times = [];

  for (const tc of testCases) {
    const { elapsed } = await queryGraphOnly(tc.ingredients);
    times.push(elapsed);
    console.log(`[케이스 ${tc.id}] ${tc.name}: ${elapsed}ms`);
  }

  const avg = times.reduce((s, t) => s + t, 0) / times.length;
  console.log(`\n평균 응답시간: ${avg.toFixed(0)}ms`);
}

main();

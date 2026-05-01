import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const graphRag = JSON.parse(fs.readFileSync(path.join(__dirname, 'results/graph-rag.json'), 'utf-8'));
const llmDirect = JSON.parse(fs.readFileSync(path.join(__dirname, 'results/llm-direct.json'), 'utf-8'));
const vanillaRag = JSON.parse(fs.readFileSync(path.join(__dirname, 'results/vanilla-rag.json'), 'utf-8'));

function avg(arr, key) {
  return (arr.reduce((s, r) => s + r[key], 0) / arr.length);
}

console.log('\n========================================');
console.log('       최종 성능 비교 결과');
console.log('========================================');
console.log(`${'방법'.padEnd(15)} ${'Recall'.padEnd(10)} ${'응답시간'.padEnd(12)} ${'평균탐지수'}`);
console.log('----------------------------------------');
console.log(`${'Vanilla RAG'.padEnd(15)} ${(avg(vanillaRag,'recall')*100).toFixed(1).padEnd(10)}% ${(avg(vanillaRag,'elapsed')).toFixed(0).padEnd(10)}ms ${avg(vanillaRag,'detectedCount').toFixed(1)}개`);
console.log(`${'LLM Direct'.padEnd(15)} ${(avg(llmDirect,'recall')*100).toFixed(1).padEnd(10)}% ${(avg(llmDirect,'elapsed')).toFixed(0).padEnd(10)}ms ${avg(llmDirect,'detectedCount').toFixed(1)}개`);
console.log(`${'Graph RAG'.padEnd(15)} ${(avg(graphRag,'recall')*100).toFixed(1).padEnd(10)}% ${(avg(graphRag,'elapsed')).toFixed(0).padEnd(10)}ms ${avg(graphRag,'detectedCount').toFixed(1)}개`);
console.log('========================================');
console.log('\n핵심 결론:');
console.log(`Graph RAG Recall이 Vanilla RAG 대비 ${(avg(graphRag,'recall')*100 - avg(vanillaRag,'recall')*100).toFixed(1)}%p 높음`);
console.log(`Graph RAG Recall이 LLM Direct 대비 ${(avg(graphRag,'recall')*100 - avg(llmDirect,'recall')*100).toFixed(1)}%p 높음`);
console.log(`Graph RAG 평균 탐지 수가 LLM Direct 대비 ${(avg(graphRag,'detectedCount') - avg(llmDirect,'detectedCount')).toFixed(1)}개 많음`);

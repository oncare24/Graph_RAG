import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const graphRag = JSON.parse(fs.readFileSync(path.join(__dirname, 'results/graph-rag.json'), 'utf-8'));
const llmDirect = JSON.parse(fs.readFileSync(path.join(__dirname, 'results/llm-direct.json'), 'utf-8'));
const vanillaRag = JSON.parse(fs.readFileSync(path.join(__dirname, 'results/vanilla-rag.json'), 'utf-8'));

function avg(arr, key) {
  return (arr.reduce((s, r) => s + r[key], 0) / arr.length * 100).toFixed(1);
}

console.log('\n========================================');
console.log('       최종 성능 비교 결과');
console.log('========================================');
console.log(`${'방법'.padEnd(15)} ${'Precision'.padEnd(12)} ${'Recall'.padEnd(12)} ${'응답시간'}`);
console.log('----------------------------------------');
console.log(`${'Vanilla RAG'.padEnd(15)} ${(avg(vanillaRag, 'precision') + '%').padEnd(12)} ${(avg(vanillaRag, 'recall') + '%').padEnd(12)} ${(vanillaRag.reduce((s,r)=>s+r.elapsed,0)/vanillaRag.length).toFixed(0)}ms`);
console.log(`${'LLM Direct'.padEnd(15)} ${(avg(llmDirect, 'precision') + '%').padEnd(12)} ${(avg(llmDirect, 'recall') + '%').padEnd(12)} ${(llmDirect.reduce((s,r)=>s+r.elapsed,0)/llmDirect.length).toFixed(0)}ms`);
console.log(`${'Graph RAG'.padEnd(15)} ${(avg(graphRag, 'precision') + '%').padEnd(12)} ${(avg(graphRag, 'recall') + '%').padEnd(12)} ${(graphRag.reduce((s,r)=>s+r.elapsed,0)/graphRag.length).toFixed(0)}ms`);
console.log('========================================');
console.log('\n핵심 결론:');
console.log(`Graph RAG Recall이 Vanilla RAG 대비 ${(parseFloat(avg(graphRag,'recall')) - parseFloat(avg(vanillaRag,'recall'))).toFixed(1)}%p 높음`);
console.log(`Graph RAG Recall이 LLM Direct 대비 ${(parseFloat(avg(graphRag,'recall')) - parseFloat(avg(llmDirect,'recall'))).toFixed(1)}%p 높음`);

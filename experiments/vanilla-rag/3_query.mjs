import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { ChromaClient } from 'chromadb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const chroma = new ChromaClient({ host: 'localhost', port: 8000 });

const testCases = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../test-cases.json'), 'utf-8')
);

async function queryVanillaRAG(ingredients) {
  const start = Date.now();

  // 1. 질문 임베딩
  const query = `다음 성분들의 약물 상호작용, 병용금기, 노인주의, 임부금기: ${ingredients.join(', ')}`;
  const embeddingRes = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: [query],
  });
  const queryEmbedding = embeddingRes.data[0].embedding;

  // 2. 유사도 검색
  const collection = await chroma.getCollection({
    name: 'drug_interactions',
    embeddingFunction: null,
  });

  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: 10,
  });

  const retrievedDocs = results.documents[0];
  const retrievedMetas = results.metadatas[0];

  // 3. LLM으로 분석
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1000,
    messages: [
      {
        role: 'system',
        content: `당신은 약물 상호작용 분석 전문가입니다. 
주어진 참고 문서를 바탕으로 약물 위험을 분석하세요.
반드시 제공된 문서에 있는 내용만 사용하세요.`
      },
      {
        role: 'user',
        content: `분석할 성분: ${ingredients.join(', ')}

참고 문서:
${retrievedDocs.map((doc, i) => `[${i + 1}] ${doc}`).join('\n')}

위 문서를 참고하여 다음 JSON 형식으로만 응답하세요:
[
  {
    "type": "CONTRAINDICATED | ELDERLY | DUPLICATE | PREGNANCY | OVERDOSE | DURATION",
    "severity": "CRITICAL | HIGH | MEDIUM | LOW",
    "involvedIngredients": ["성분1", "성분2"],
    "reason": "이유"
  }
]
경고가 없으면 []을 반환하세요.`
      }
    ]
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

  return { result, elapsed, retrievedDocs, retrievedMetas };
}

async function main() {
  console.log('=== Vanilla RAG 실험 시작 ===\n');

  const results = [];

  for (const tc of testCases) {
    console.log(`[케이스 ${tc.id}] ${tc.name}`);
    console.log(`성분: ${tc.ingredients.join(', ')}`);

    const { result, elapsed, retrievedDocs } = await queryVanillaRAG(tc.ingredients);

    console.log(`응답시간: ${elapsed}ms`);
    console.log(`검색된 문서: ${retrievedDocs.length}개`);
    console.log(`탐지된 경고: ${result.length}개`);
    console.log(`예상 경고: ${tc.expected.length}개`);

    // 정확도 계산
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
      method: 'vanilla-rag',
      elapsed,
      detected: result,
      expected: tc.expected,
      precision,
      recall,
    });

    await new Promise(r => setTimeout(r, 500));
  }

  // 결과 저장
  fs.writeFileSync(
    path.join(__dirname, '../results/vanilla-rag.json'),
    JSON.stringify(results, null, 2),
    'utf-8'
  );

  // 전체 평균
  const avgPrecision = results.reduce((s, r) => s + r.precision, 0) / results.length;
  const avgRecall = results.reduce((s, r) => s + r.recall, 0) / results.length;
  const avgElapsed = results.reduce((s, r) => s + r.elapsed, 0) / results.length;

  console.log('\n=== Vanilla RAG 전체 결과 ===');
  console.log(`평균 Precision: ${(avgPrecision * 100).toFixed(1)}%`);
  console.log(`평균 Recall: ${(avgRecall * 100).toFixed(1)}%`);
  console.log(`평균 응답시간: ${avgElapsed.toFixed(0)}ms`);
}

main();

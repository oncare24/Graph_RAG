import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { ChromaClient } from 'chromadb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const chroma = new ChromaClient({ host: 'localhost', port: 8000 });

const docs = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'drug_texts.json'), 'utf-8')
);

// ID 중복 제거 (인덱스 붙이기)
const uniqueDocs = docs.map((d, i) => ({
  ...d,
  id: `${d.id}_${i}`,
}));

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  console.log('ChromaDB 컬렉션 생성 중...');

  try {
    await chroma.deleteCollection({ name: 'drug_interactions' });
  } catch {}

  const collection = await chroma.createCollection({
    name: 'drug_interactions',
    embeddingFunction: null,  // 직접 임베딩 제공
  });

  console.log(`총 ${uniqueDocs.length}개 문서 임베딩 시작...`);

  const batches = chunk(uniqueDocs, 50);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    process.stdout.write(`  배치 ${i + 1}/${batches.length} 처리 중...\r`);

    // OpenAI 임베딩
    const embeddingRes = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch.map(d => d.text),
    });

    const embeddings = embeddingRes.data.map(e => e.embedding);

    await collection.add({
      ids: batch.map(d => d.id),
      embeddings,
      documents: batch.map(d => d.text),
      metadatas: batch.map(d => d.metadata),
    });

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n✅ 임베딩 완료: ${uniqueDocs.length}개 문서`);
}

main();

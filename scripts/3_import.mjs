import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import neo4j from 'neo4j-driver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROCESSED_DIR = path.join(__dirname, '../data/processed');

// Neo4j 연결
const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'bosalpim1234')
);

function loadJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, filename), 'utf-8'));
}

// 배열을 n개씩 나누기 (한번에 너무 많이 넣으면 메모리 문제)
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  const session = driver.session();

  try {
    // ─── 1. 기존 데이터 초기화 ───────────────────────
    console.log('기존 데이터 초기화 중...');
    await session.run('MATCH (n) DETACH DELETE n');
    console.log('  ✅ 완료');

    // ─── 2. 인덱스 생성 ──────────────────────────────
    console.log('인덱스 생성 중...');
    await session.run(
      'CREATE CONSTRAINT ingredient_code IF NOT EXISTS FOR (i:Ingredient) REQUIRE i.code IS UNIQUE'
    );
    console.log('  ✅ 완료');

    // ─── 3. 성분 노드 적재 ───────────────────────────
    console.log('성분 노드 적재 중...');
    const ingredients = loadJson('ingredients.json');
    const ingredientChunks = chunk(ingredients, 100);

    for (let i = 0; i < ingredientChunks.length; i++) {
      process.stdout.write(`  ${i + 1}/${ingredientChunks.length} 배치 처리 중...\r`);
      await session.run(
        `UNWIND $items AS item
         MERGE (i:Ingredient { code: item.code })
         SET i.korName         = item.korName,
             i.engName         = item.engName,
             i.class           = item.class,
             i.maxQty          = item.maxQty,
             i.maxDosageTerm   = item.maxDosageTerm,
             i.isElderlyTaboo  = item.isElderlyTaboo,
             i.elderlyWarning  = item.elderlyWarning,
             i.isPregnancyTaboo = item.isPregnancyTaboo,
             i.pregnancyGrade  = item.pregnancyGrade,
             i.ageTaboo        = item.ageTaboo,
             i.effectCode      = item.effectCode,
             i.sersName        = item.sersName`,
        { items: ingredientChunks[i] }
      );
    }
    console.log(`\n  ✅ 성분 노드 ${ingredients.length}개 완료`);

    // ─── 4. 병용금기 엣지 적재 ───────────────────────
    console.log('병용금기 엣지 적재 중...');
    const edges = loadJson('contraindicated_edges.json');
    const edgeChunks = chunk(edges, 100);

    for (let i = 0; i < edgeChunks.length; i++) {
      process.stdout.write(`  ${i + 1}/${edgeChunks.length} 배치 처리 중...\r`);
      await session.run(
        `UNWIND $items AS item
         MATCH (a:Ingredient { code: item.fromCode })
         MATCH (b:Ingredient { code: item.toCode })
         MERGE (a)-[r:CONTRAINDICATED]->(b)
         SET r.reason           = item.reason,
             r.severity         = item.severity,
             r.notificationDate = item.notificationDate`,
        { items: edgeChunks[i] }
      );
    }
    console.log(`\n  ✅ 병용금기 엣지 ${edges.length}개 완료`);

    // ─── 5. 최종 확인 쿼리 ───────────────────────────
    console.log('\n최종 확인...');
    const nodeResult = await session.run('MATCH (i:Ingredient) RETURN count(i) AS count');
    const edgeResult = await session.run('MATCH ()-[r:CONTRAINDICATED]->() RETURN count(r) AS count');

    console.log(`  성분 노드: ${nodeResult.records[0].get('count')}개`);
    console.log(`  병용금기 엣지: ${edgeResult.records[0].get('count')}개`);
    console.log('\n🎉 Neo4j 적재 완료!');

  } catch (err) {
    console.error('❌ 오류:', err.message);
  } finally {
    await session.close();
    await driver.close();
  }
}

main();

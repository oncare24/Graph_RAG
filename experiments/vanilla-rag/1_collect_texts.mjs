import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, '../../data/raw');

// DUR raw 데이터에서 텍스트 문서 생성
function buildDocuments() {
  const docs = [];

  // 병용금기 텍스트
  const contraindicated = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'contraindicated.json'), 'utf-8'));
  for (const item of contraindicated) {
    if (!item.PROHBT_CONTENT) continue;
    docs.push({
      id: `contra_${item.INGR_CODE}_${item.MIXTURE_INGR_CODE}`,
      text: `${item.INGR_KOR_NAME}과 ${item.MIXTURE_INGR_KOR_NAME}을 함께 복용하면 안됩니다. ${item.PROHBT_CONTENT}`,
      metadata: {
        type: 'CONTRAINDICATED',
        ingredientA: item.INGR_KOR_NAME,
        ingredientB: item.MIXTURE_INGR_KOR_NAME,
      }
    });
  }

  // 노인주의 텍스트
  const elderly = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'elderly.json'), 'utf-8'));
  for (const item of elderly) {
    if (!item.PROHBT_CONTENT) continue;
    docs.push({
      id: `elderly_${item.INGR_CODE}`,
      text: `${item.INGR_NAME}은 노인에게 주의가 필요합니다. ${item.PROHBT_CONTENT}`,
      metadata: {
        type: 'ELDERLY',
        ingredient: item.INGR_NAME,
      }
    });
  }

  // 임부금기 텍스트
  const pregnancy = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'pregnancy.json'), 'utf-8'));
  for (const item of pregnancy) {
    docs.push({
      id: `preg_${item.INGR_CODE}`,
      text: `${item.INGR_NAME}은 임부금기 성분입니다. ${item.GRADE ?? ''} ${item.PROHBT_CONTENT ?? '임부에 대한 안전성 미확립'}`,
      metadata: {
        type: 'PREGNANCY',
        ingredient: item.INGR_NAME,
      }
    });
  }

  // 효능군중복 텍스트
  const duplicate = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'duplicate.json'), 'utf-8'));
  for (const item of duplicate) {
    docs.push({
      id: `dup_${item.INGR_CODE}`,
      text: `${item.INGR_NAME}은 ${item.SERS_NAME ?? item.EFFECT_CODE} 계열 약물입니다. 같은 계열 약물을 중복 복용하지 마세요.`,
      metadata: {
        type: 'DUPLICATE',
        ingredient: item.INGR_NAME,
        effectCode: item.EFFECT_CODE,
      }
    });
  }

  return docs;
}

const docs = buildDocuments();
fs.writeFileSync(
  path.join(__dirname, 'drug_texts.json'),
  JSON.stringify(docs, null, 2),
  'utf-8'
);

console.log(`✅ 총 ${docs.length}개 문서 생성 완료`);
console.log(`  병용금기: ${docs.filter(d => d.metadata.type === 'CONTRAINDICATED').length}개`);
console.log(`  노인주의: ${docs.filter(d => d.metadata.type === 'ELDERLY').length}개`);
console.log(`  임부금기: ${docs.filter(d => d.metadata.type === 'PREGNANCY').length}개`);
console.log(`  효능군중복: ${docs.filter(d => d.metadata.type === 'DUPLICATE').length}개`);

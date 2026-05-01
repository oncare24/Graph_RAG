import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, '../data/raw');
const OUT_DIR = path.join(__dirname, '../data/processed');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function loadJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(RAW_DIR, filename), 'utf-8'));
}

// ─── 성분 노드 Map ────────────────────────────────────
const ingredients = new Map();

function upsertIngredient(code, engName, korName, className) {
  if (!code) return null;
  if (!ingredients.has(code)) {
    ingredients.set(code, {
      code,
      engName:          engName   ?? '',
      korName:          korName   ?? '',
      class:            className ?? '',
      maxQty:           null,
      maxDosageTerm:    null,
      isElderlyTaboo:   false,
      elderlyWarning:   null,
      isPregnancyTaboo: false,
      pregnancyGrade:   null,
      ageTaboo:         null,
      effectCode:       null,
      sersName:         null,
    });
  }
  return ingredients.get(code);
}

// ─── 1. 병용금기 → 엣지 ──────────────────────────────
// 필드: INGR_KOR_NAME, CLASS, MIXTURE_CLASS (다른 API와 다름!)
console.log('[1/7] 병용금기 처리 중...');
const contraindicatedEdges = [];
const rawContra = loadJson('contraindicated.json');

for (const item of rawContra) {
  upsertIngredient(
    item.INGR_CODE,
    item.INGR_ENG_NAME,
    item.INGR_KOR_NAME,   // ← 병용금기만 KOR_NAME
    item.CLASS            // ← 병용금기만 CLASS (NAME 없음)
  );
  upsertIngredient(
    item.MIXTURE_INGR_CODE,
    item.MIXTURE_INGR_ENG_NAME,
    item.MIXTURE_INGR_KOR_NAME,
    item.MIXTURE_CLASS
  );

  if (item.INGR_CODE && item.MIXTURE_INGR_CODE) {
    contraindicatedEdges.push({
      fromCode:         item.INGR_CODE,
      toCode:           item.MIXTURE_INGR_CODE,
      reason:           item.PROHBT_CONTENT    ?? '',
      severity:         'CRITICAL',
      notificationDate: item.NOTIFICATION_DATE ?? '',
    });
  }
}
console.log(`  ✅ 엣지 ${contraindicatedEdges.length}건, 성분 ${ingredients.size}개`);

// ─── 2. 효능군중복 → 노드 속성 ───────────────────────
// 필드: INGR_NAME, CLASS_NAME, EFFECT_CODE, SERS_NAME
console.log('[2/7] 효능군중복 처리 중...');
const rawDuplicate = loadJson('duplicate.json');

for (const item of rawDuplicate) {
  const node = upsertIngredient(
    item.INGR_CODE,
    item.INGR_ENG_NAME,
    item.INGR_NAME,     // ← INGR_NAME
    item.CLASS_NAME     // ← CLASS_NAME
  );
  if (node) {
    node.effectCode = item.EFFECT_CODE ?? null;
    node.sersName   = item.SERS_NAME   ?? null;
  }
}
console.log(`  ✅ 성분 ${ingredients.size}개`);

// ─── 3. 용량주의 → 노드 속성 ─────────────────────────
// 필드: INGR_NAME, CLASS_NAME, MAX_QTY
console.log('[3/7] 용량주의 처리 중...');
const rawDosage = loadJson('dosage.json');

for (const item of rawDosage) {
  const node = upsertIngredient(
    item.INGR_CODE,
    item.INGR_ENG_NAME,
    item.INGR_NAME,
    item.CLASS_NAME
  );
  if (node && item.MAX_QTY) {
    node.maxQty = item.MAX_QTY;
  }
}
console.log(`  ✅ 성분 ${ingredients.size}개`);

// ─── 4. 투여기간주의 → 노드 속성 ─────────────────────
// 필드: INGR_NAME, CLASS_NAME, MAX_DOSAGE_TERM
console.log('[4/7] 투여기간주의 처리 중...');
const rawDuration = loadJson('duration.json');

for (const item of rawDuration) {
  const node = upsertIngredient(
    item.INGR_CODE,
    item.INGR_ENG_NAME,
    item.INGR_NAME,
    item.CLASS_NAME
  );
  if (node && item.MAX_DOSAGE_TERM) {
    node.maxDosageTerm = item.MAX_DOSAGE_TERM;
  }
}
console.log(`  ✅ 성분 ${ingredients.size}개`);

// ─── 5. 노인주의 → 노드 속성 ─────────────────────────
// 필드: INGR_NAME, PROHBT_CONTENT (CLASS_NAME 없음!)
console.log('[5/7] 노인주의 처리 중...');
const rawElderly = loadJson('elderly.json');

for (const item of rawElderly) {
  const node = upsertIngredient(
    item.INGR_CODE,
    item.INGR_ENG_NAME,
    item.INGR_NAME,
    null              // ← 노인주의는 CLASS_NAME 없음
  );
  if (node) {
    node.isElderlyTaboo = true;
    node.elderlyWarning = item.PROHBT_CONTENT ?? null;
  }
}
console.log(`  ✅ 성분 ${ingredients.size}개`);

// ─── 6. 임부금기 → 노드 속성 ─────────────────────────
// 필드: INGR_NAME, CLASS_NAME, GRADE
console.log('[6/7] 임부금기 처리 중...');
const rawPregnancy = loadJson('pregnancy.json');

for (const item of rawPregnancy) {
  const node = upsertIngredient(
    item.INGR_CODE,
    item.INGR_ENG_NAME,
    item.INGR_NAME,
    item.CLASS_NAME
  );
  if (node) {
    node.isPregnancyTaboo = true;
    node.pregnancyGrade   = item.GRADE ?? null;
  }
}
console.log(`  ✅ 성분 ${ingredients.size}개`);

// ─── 7. 특정연령대금기 → 노드 속성 ───────────────────
// 필드: INGR_NAME, CLASS_NAME, AGE_BASE
console.log('[7/7] 특정연령대금기 처리 중...');
const rawAgeTaboo = loadJson('age_taboo.json');

for (const item of rawAgeTaboo) {
  const node = upsertIngredient(
    item.INGR_CODE,
    item.INGR_ENG_NAME,
    item.INGR_NAME,
    item.CLASS_NAME
  );
  if (node && item.AGE_BASE) {
    node.ageTaboo = item.AGE_BASE;
  }
}
console.log(`  ✅ 성분 ${ingredients.size}개`);

// ─── 결과 저장 ────────────────────────────────────────
const ingredientList = Array.from(ingredients.values());

fs.writeFileSync(
  path.join(OUT_DIR, 'ingredients.json'),
  JSON.stringify(ingredientList, null, 2),
  'utf-8'
);
fs.writeFileSync(
  path.join(OUT_DIR, 'contraindicated_edges.json'),
  JSON.stringify(contraindicatedEdges, null, 2),
  'utf-8'
);

console.log('\n🎉 처리 완료!');
console.log(`  성분 노드: ${ingredientList.length}개`);
console.log(`  병용금기 엣지: ${contraindicatedEdges.length}개`);

// ─── 검증 ─────────────────────────────────────────────
const elderlyNodes = ingredientList.filter(i => i.isElderlyTaboo);
const elderlyWithWarning = elderlyNodes.filter(i => i.elderlyWarning);
console.log(`\n  노인주의: ${elderlyNodes.length}개`);
console.log(`  노인주의 경고텍스트 있음: ${elderlyWithWarning.length}개`);

const pregnancyNodes = ingredientList.filter(i => i.isPregnancyTaboo);
console.log(`  임부금기: ${pregnancyNodes.length}개`);

const dosageNodes = ingredientList.filter(i => i.maxQty);
console.log(`  용량주의: ${dosageNodes.length}개`);
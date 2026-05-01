import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = 'b76ada2f02f7a45c24d4fa9484ddc1859b085f7b86dae8ebfe4aa0f3b4ca5ed4'; 
const BASE_URL = 'https://apis.data.go.kr/1471000/DURIrdntInfoService03';
const OUTPUT_DIR = path.join(__dirname, '../data/raw');

const APIS = [
  { name: 'contraindicated', endpoint: 'getUsjntTabooInfoList02' },
  { name: 'pregnancy',       endpoint: 'getPwnmTabooInfoList02'  },
  { name: 'dosage',          endpoint: 'getCpctyAtentInfoList02' },
  { name: 'duration',        endpoint: 'getMdctnPdAtentInfoList02' },
  { name: 'elderly',         endpoint: 'getOdsnAtentInfoList02'  },
  { name: 'age_taboo',       endpoint: 'getSpcifyAgrdeTabooInfoList02' },
  { name: 'duplicate',       endpoint: 'getEfcyDplctInfoList02'  },
];

async function fetchAll(endpoint) {
  // 1페이지로 totalCount 먼저 확인
  const firstRes = await fetch(
    `${BASE_URL}/${endpoint}?serviceKey=${API_KEY}&pageNo=1&numOfRows=100&type=json`
  );
  const firstData = await firstRes.json();
  
  // API 오류 체크
  if (firstData.header?.resultCode !== '00') {
    throw new Error(`API 오류: ${firstData.header?.resultMsg}`);
  }

  const total = firstData.body.totalCount;
  const totalPages = Math.ceil(total / 100);
  console.log(`  총 ${total}건, ${totalPages}페이지`);

  const allItems = firstData.body.items?.map(i => i.item) ?? [];

  for (let page = 2; page <= totalPages; page++) {
    process.stdout.write(`  ${page}/${totalPages} 페이지 수집 중...\r`);

    const res = await fetch(
      `${BASE_URL}/${endpoint}?serviceKey=${API_KEY}&pageNo=${page}&numOfRows=100&type=json`
    );
    const data = await res.json();
    const items = data.body.items?.map(i => i.item) ?? [];
    allItems.push(...items);

    // API 서버 부하 방지
    await new Promise(r => setTimeout(r, 150));
  }

  return allItems;
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const api of APIS) {
    console.log(`\n[${api.name}] 수집 시작...`);
    try {
      const items = await fetchAll(api.endpoint);
      const outputPath = path.join(OUTPUT_DIR, `${api.name}.json`);
      fs.writeFileSync(outputPath, JSON.stringify(items, null, 2), 'utf-8');
      console.log(`\n  ✅ 완료: ${items.length}건 → ${outputPath}`);
    } catch (err) {
      console.error(`\n  ❌ 실패: ${api.name} →`, err.message);
    }
  }

  console.log('\n🎉 전체 수집 완료!');
}

main();

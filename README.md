# 보살핌 (Bosalpim) — Graph RAG 기반 복약 분석 시스템

독거 고령자·1인가구를 위한 스마트 케어 플랫폼 "보살핌"의 복약 안전 분석 파트.
식약처 DUR 데이터 기반 지식 그래프와 Graph RAG를 활용해 약물 간 위험을 탐지하고,
LLM으로 사용자 친화적인 설명을 생성한다.

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 목적 | 다약제 복용 고령자의 약물 상호작용 위험 자동 탐지 |
| 핵심 기술 | Graph RAG (Neo4j + GPT-4o-mini) |
| 데이터 출처 | 식약처 DUR API (의약품안전사용서비스) |
| 처방전 연동 | CODEF API (건강보험공단, 카카오 간편인증) |
| 백엔드 | NestJS (TypeScript) |

---

## 2. 시스템 아키텍처

```
사용자 처방전
      ↓
CODEF API (카카오 간편인증 2-Way)
      ↓
성분명 추출 (영문 → 한글 변환)
      ↓
Neo4j 그래프 탐색
  ├─ 직접 관계 탐지 (병용금기/노인주의/효능군중복/임부금기/용량주의/투여기간주의)
  └─ 간접 경로 탐지 (2홉 Cypher 쿼리) ← Graph RAG 핵심
      ↓
서브그래프 추출 (노드 속성 + 엣지 + 간접경로)
      ↓
OpenAI GPT-4o-mini
  (서브그래프 컨텍스트 기반 추론, 약 이름 중심 설명 생성)
      ↓
경고 + 처방전 정보 반환
```

---

## 3. 폴더 구조

```
~/Bosalpim/
├── docker/
│   └── docker-compose.yml        # Neo4j + ChromaDB
├── data/
│   ├── raw/                      # DUR API 원본 JSON (7개 카테고리)
│   └── processed/                # 가공된 노드/엣지 데이터
├── scripts/
│   ├── 1_collect.mjs              # DUR API 수집
│   ├── 2_process.mjs              # 노드/엣지 가공
│   └── 3_import.mjs               # Neo4j 적재
├── experiments/                   # Graph RAG 성능 비교 실험
│   ├── test-cases.json            # 50개 테스트케이스
│   ├── graph-rag/query.mjs
│   ├── llm-direct/query.mjs
│   ├── vanilla-rag/{1_collect_texts,2_embed,3_query}.mjs
│   ├── evaluate.mjs
│   └── results/
└── server/                        # NestJS 백엔드
    ├── public/index.html          # MVP 테스트 프론트
    └── src/
        ├── common/types/warning.type.ts
        ├── drug/        (controller, service, dto)
        ├── graph/       (graph.service, graph-analyzer.service)
        ├── llm/         (llm.service)
        └── codef/       (codef.service)
```

---

## 4. 데이터 파이프라인

**데이터 소스:** 식약처 DUR API (공공데이터포털 `15056780`)

| 카테고리 | 건수 |
|---|---|
| 병용금기 | 1,816 |
| 임부금기 | 1,433 |
| 용량주의 | 706 |
| 효능군중복 | 404 |
| 특정연령대금기 | 230 |
| 노인주의 | 112 |
| 투여기간주의 | 98 |
| **총합** | **4,799** |

**구축 방식:** 규칙 기반(Rule-based) 파싱 — LLM 미사용.
이미 구조화된 식약처 데이터를 Node.js 스크립트로 수집 → 가공 → Neo4j Cypher로 적재.

**Neo4j 결과:** 성분 노드 1,473개 / 병용금기 엣지 1,313개

### 그래프 스키마

```
(:Ingredient) 노드 속성:
  code, korName, engName, class,
  maxQty, maxDosageTerm,
  isElderlyTaboo, elderlyWarning,
  isPregnancyTaboo, pregnancyGrade,
  effectCode, sersName

[:CONTRAINDICATED] 엣지 속성:
  reason, severity, notificationDate
```

---

## 5. Graph RAG 핵심 — 간접 경로 탐색

단순 그래프 조회와 Graph RAG의 차이는 **그래프에 없는 위험을 추론**하는 데 있다.

```cypher
MATCH (a:Ingredient)-[r1:CONTRAINDICATED]-(mid:Ingredient)-[r2:CONTRAINDICATED]-(b:Ingredient)
WHERE a.korName IN $ingredients
  AND b.korName IN $ingredients
  AND a.korName <> b.korName
  AND NOT (a)-[:CONTRAINDICATED]-(b)
RETURN a.korName, mid.korName, b.korName, r1.reason, r2.reason
```

**예시:** 심바스타틴과 트리아졸람은 직접 병용금기로 등록되어 있지 않지만,
둘 다 이트라코나졸(매개 성분)과 직접 금기 관계라는 것을 그래프에서 발견하고,
이 경로를 LLM 컨텍스트로 전달해 "간접 위험"이라는 새로운 경고를 생성한다.

---

## 6. API 명세

### `POST /drug/analyze`
성분 직접 입력 분석.

```json
// Request
{
  "drugs": [
    { "drugName": "이트라코나졸캡슐", "ingredients": ["이트라코나졸"] },
    { "drugName": "심바스타틴정", "ingredients": ["심바스타틴"] }
  ],
  "age": 75,
  "isPregnant": false
}
```

```json
// Response
[
  {
    "type": "CONTRAINDICATED",
    "severity": "CRITICAL",
    "involvedIngredients": ["심바스타틴", "이트라코나졸"],
    "involvedDrugNames": ["심바스타틴정", "이트라코나졸캡슐"],
    "rawMessage": "심바스타틴과 이트라코나졸 병용 금기: 근병증의 위험 증가 가능 / 횡문근융해증",
    "explanation": "심바스타틴정(심바스타틴)과 이트라코나졸캡슐(이트라코나졸)을 함께 복용하면 근육에 문제가 생길 위험이 증가할 수 있습니다. 의사나 약사와 상담해 보세요."
  }
]
```

### `POST /drug/codef/request`
카카오 간편인증 1차 요청.

```json
// Request
{ "identity": "주민번호13자리", "userName": "홍길동", "phoneNo": "01012345678" }

// Response
{ "jti": "...", "twoWayTimestamp": 1234567890, "transactionId": "..." }
```

### `POST /drug/codef/confirm`
카카오 인증 수락 후 2차 인증 + 처방전 분석.

```json
// Request
{
  "identity": "...", "userName": "...", "phoneNo": "...",
  "jti": "1차응답값", "twoWayTimestamp": 1차응답값,
  "age": 75, "isPregnant": false
}

// Response (처방 있음)
{
  "warnings": [ /* DrugWarning[] */ ],
  "prescriptions": [
    {
      "resDrugName": "록소로펜정",
      "resIngredients": "loxoprofen+sodium+hydrate",
      "resPrescribeDrugEffect": "해열진통소염제",
      "resContent": "1정",
      "resOneDose": "1",
      "resDailyDosesNumber": "3",
      "resTotalDosingdays": "5",
      "resPrescribeOrg": "우리안과의원",
      "resManufactureDate": "20260418",
      "resPrescribeNo": "2026041800033",
      "resDrugCode": "663600400",
      "imageUrl": "https://nedrug.mfds.go.kr/pbp/cmn/itemImageDownload/..."
    }
  ]
}

// Response (처방 없음)
{ "warnings": [], "prescriptions": [], "message": "처방 기록이 없습니다." }
```

**경고 타입(type):** `CONTRAINDICATED` 병용금기 · `ELDERLY` 노인주의 · `DUPLICATE` 효능군중복 · `PREGNANCY` 임부금기 · `OVERDOSE` 용량주의 · `DURATION` 투여기간주의
**심각도(severity):** `CRITICAL` > `HIGH` > `MEDIUM` > `LOW`

---

## 7. 성능 비교 실험

식약처 DUR 데이터 기반 50개 테스트케이스로 Graph RAG / Vanilla RAG / LLM Direct 비교.

| 방법 | Recall | 응답시간 | 평균 탐지 수 |
|---|---|---|---|
| Vanilla RAG | 45.7% | 3,558ms | 1.2개 |
| LLM Direct | 28.3% | 3,260ms | 1.2개 |
| **Graph RAG** | **96.0%** | 3,018ms | **2.9개** |

**평가 지표를 Recall로 정한 이유:** 의료 도메인에서는 위험을 놓치는 것(Recall↓)이
잘못된 경고(Precision↓)보다 훨씬 치명적이다.

**Vanilla RAG 구성:** 식약처 DUR raw 데이터를 텍스트화(3,625개 문서) →
OpenAI 임베딩 → ChromaDB 저장 → 유사도 검색(top 10) → LLM 분석.

**한계:** 벡터 유사도 검색은 다약제 조합 관계나 효능군 중복처럼
"관계"를 직접 추론해야 하는 질의에 구조적으로 약하다.

---

## 8. 환경 변수 (.env)

```
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=bosalpim1234
OPENAI_API_KEY=sk-...
CODEF_CLIENT_ID=...
CODEF_CLIENT_SECRET=...
DRUG_IMAGE_API_KEY=...   # 식약처 의약품 낱알식별 API
PORT=3000
```

---

## 9. 실행 방법

```bash
# 1. Neo4j + ChromaDB 실행
cd ~/Bosalpim/docker
docker compose up -d

# 2. 서버 실행
cd ~/Bosalpim/server
npm run start:dev

# 3. 접속
http://localhost:3000        # 테스트 프론트
http://localhost:3000/api    # Swagger UI

# 4. 외부 공개 (선택)
ngrok http 3000
```

---

## 10. 알려진 이슈 / 출시 전 체크리스트

- [ ] `codef.service.ts`의 복용 종료일 필터링 주석 해제 (현재 테스트 위해 비활성화 — 전체 처방 이력 반환 중)
- [ ] DrugBank 데이터 병합 시 라이선스(상업적 사용) 검토
- [ ] CODEF 데모 → 정식 서비스 전환
- [ ] LLM 응답 지연(약 3~4초) 개선 — 캐싱/스트리밍/비동기 분리 검토
- [ ] 특정연령대금기 탐지 미구현 (데이터는 수집됨)

---

## 11. 기술 스택 요약

| 구분 | 기술 |
|---|---|
| Backend | NestJS, TypeScript |
| Graph DB | Neo4j, Cypher |
| Vector DB (실험용) | ChromaDB |
| LLM | OpenAI GPT-4o-mini |
| 처방전 연동 | CODEF API, 카카오 간편인증 |
| 외부 데이터 | 식약처 DUR API, 식약처 낱알식별 API |
| 인프라 | Docker Compose, ngrok |
| 문서화 | Swagger / OpenAPI |

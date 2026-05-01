export enum WarningType {
  CONTRAINDICATED = 'CONTRAINDICATED', // 병용금기
  DUPLICATE = 'DUPLICATE',             // 효능군중복
  OVERDOSE = 'OVERDOSE',               // 용량주의
  ELDERLY = 'ELDERLY',                 // 노인주의
  PREGNANCY = 'PREGNANCY',             // 임부금기
  DURATION = 'DURATION',               // 투여기간주의
}

export enum Severity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface DrugWarning {
  type: WarningType;
  severity: Severity;
  involvedIngredients: string[];
  rawMessage: string;
  explanation?: string;
}

export interface DrugInput {
  drugName: string;        // 약 제품명
  ingredients: string[];   // 성분명 리스트 (CODEF resIngredients)
  dose?: number;           // 1회 투약량
  dailyDoses?: number;     // 1일 투여횟수
  totalDays?: number;      // 총 투약일수
}

export enum WarningType {
  CONTRAINDICATED = 'CONTRAINDICATED',
  DUPLICATE = 'DUPLICATE',
  OVERDOSE = 'OVERDOSE',
  ELDERLY = 'ELDERLY',
  PREGNANCY = 'PREGNANCY',
  DURATION = 'DURATION',
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
  involvedDrugNames?: string[];  // ← 추가
  rawMessage: string;
  explanation?: string;
}

export interface DrugInput {
  drugName: string;
  ingredients: string[];
  dose?: number;
  dailyDoses?: number;
  totalDays?: number;
  ingredientToDrugName?: Record<string, string>;
}

export interface SubGraphNode {
  name: string;
  class?: string;
  isElderlyTaboo?: boolean;
  elderlyWarning?: string;
  effectCode?: string;
  sersName?: string;
  maxQty?: string;
  maxDosageTerm?: string;
  isPregnancyTaboo?: boolean;
  pregnancyGrade?: string;
}

export interface SubGraphEdge {
  from: string;
  to: string;
  type: string;
  reason: string;
}

export interface IndirectPath {
  fromIngredient: string;
  midIngredient: string;
  toIngredient: string;
  reason1: string;
  reason2: string;
}

export interface SubGraph {
  nodes: SubGraphNode[];
  edges: SubGraphEdge[];
  indirectPaths?: IndirectPath[];
}

export interface AnalyzeResult {
  warnings: DrugWarning[];
  subgraph: SubGraph | null;
  korIngredientMap?: Record<string, string>;
}

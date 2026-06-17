import { Injectable, Logger } from '@nestjs/common';
import { GraphService } from './graph.service';
import {
  DrugInput, DrugWarning, WarningType, Severity,
  SubGraph, AnalyzeResult, IndirectPath,
} from '../common/types/warning.type';

@Injectable()
export class GraphAnalyzerService {
  private readonly logger = new Logger(GraphAnalyzerService.name);

  constructor(private readonly graphService: GraphService) {}

  async analyze(drugs: DrugInput[]): Promise<AnalyzeResult> {
    const allIngredients = [...new Set(drugs.flatMap(d => d.ingredients))];
    if (allIngredients.length === 0) return { warnings: [] as DrugWarning[], subgraph: null };

    const korIngredients = await this.translateToKorean(allIngredients);
    if (korIngredients.length === 0) return { warnings: [] as DrugWarning[], subgraph: null };

    // 영문 → 한글 매핑 (정확한 매핑)
    const korIngredientMap: Record<string, string> = {};
    const results = await this.graphService.runQuery<{ engName: string; korName: string }>(
      `MATCH (i:Ingredient)
      WHERE toLower(i.engName) IN $engIngredients
      RETURN i.engName AS engName, i.korName AS korName`,
      { engIngredients: allIngredients.map(s => s.toLowerCase()) }
    );
    for (const r of results) {
      if (r.engName) korIngredientMap[r.engName.toLowerCase()] = r.korName;
      if (r.engName) korIngredientMap[r.engName] = r.korName;
    }

    const korDrugs = drugs.map(d => ({
      ...d,
      ingredients: d.ingredients
        .map(ing => {
          const idx = allIngredients.findIndex(i => i.toLowerCase() === ing.toLowerCase());
          return korIngredients[idx] ?? ing;
        })
        .filter(ing => korIngredients.includes(ing)),
    }));

    const warnings: DrugWarning[] = [];
    const [contraindicated, elderly, duplicate, overdose, pregnancy, duration] = await Promise.all([
      this.detectContraindicated(korIngredients),
      this.detectElderly(korIngredients),
      this.detectDuplicate(korIngredients),
      this.detectOverdose(korDrugs),
      this.detectPregnancy(korIngredients),
      this.detectDuration(korDrugs),
    ]);
    warnings.push(...contraindicated, ...elderly, ...duplicate, ...overdose, ...pregnancy, ...duration);

    const subgraph = await this.extractSubgraph(korIngredients);
    const indirectPaths = await this.findIndirectPaths(korIngredients);
    subgraph.indirectPaths = indirectPaths;

    const indirectWarnings = indirectPaths
      .filter((p, idx, self) =>
        idx === self.findIndex(t =>
          (t.fromIngredient === p.fromIngredient && t.toIngredient === p.toIngredient) ||
          (t.fromIngredient === p.toIngredient && t.toIngredient === p.fromIngredient)
        )
      )
      .map(p => ({
        type: WarningType.CONTRAINDICATED,
        severity: Severity.MEDIUM,
        involvedIngredients: [p.fromIngredient, p.toIngredient],
        rawMessage: `[간접 위험] ${p.fromIngredient}과 ${p.toIngredient}은 직접 금기는 아니지만 ` +
          `${p.midIngredient}을 통해 연결됩니다. ` +
          `(${p.fromIngredient}↔${p.midIngredient}: ${p.reason1})`,
      } as DrugWarning));

    warnings.push(...indirectWarnings);

    this.logger.log(`노드: ${subgraph.nodes.length}개, 직접엣지: ${subgraph.edges.length}개, 간접경로: ${indirectPaths.length}개, 간접경고: ${indirectWarnings.length}개`);

    return { warnings, subgraph, korIngredientMap }; // ← korIngredientMap 추가
  }

  async extractSubgraph(ingredients: string[]): Promise<SubGraph> {
    const results = await this.graphService.runQuery<any>(
      `MATCH (a:Ingredient)
       WHERE a.korName IN $ingredients
       OPTIONAL MATCH (a)-[r:CONTRAINDICATED]-(b:Ingredient)
       RETURN
         a.korName AS fromNode,
         a.class AS fromClass,
         a.isElderlyTaboo AS fromElderly,
         a.elderlyWarning AS fromElderlyWarning,
         a.effectCode AS fromEffectCode,
         a.sersName AS fromSersName,
         a.maxQty AS fromMaxQty,
         a.maxDosageTerm AS fromMaxDosageTerm,
         a.isPregnancyTaboo AS fromPregnancy,
         a.pregnancyGrade AS fromPregnancyGrade,
         b.korName AS toNode,
         b.class AS toClass,
         r.reason AS reason`,
      { ingredients }
    );

    const nodeMap = new Map<string, any>();
    const edges: any[] = [];

    for (const row of results) {
      if (!nodeMap.has(row.fromNode)) {
        nodeMap.set(row.fromNode, {
          name: row.fromNode,
          class: row.fromClass,
          isElderlyTaboo: row.fromElderly,
          elderlyWarning: row.fromElderlyWarning,
          effectCode: row.fromEffectCode,
          sersName: row.fromSersName,
          maxQty: row.fromMaxQty,
          maxDosageTerm: row.fromMaxDosageTerm,
          isPregnancyTaboo: row.fromPregnancy,
          pregnancyGrade: row.fromPregnancyGrade,
        });
      }
      if (row.toNode) {
        if (!nodeMap.has(row.toNode)) {
          nodeMap.set(row.toNode, { name: row.toNode, class: row.toClass });
        }
        edges.push({
          from: row.fromNode,
          to: row.toNode,
          type: 'CONTRAINDICATED',
          reason: row.reason,
        });
      }
    }

    return { nodes: Array.from(nodeMap.values()), edges };
  }

  async findIndirectPaths(ingredients: string[]): Promise<IndirectPath[]> {
    if (ingredients.length < 2) return [];

    const results = await this.graphService.runQuery<IndirectPath>(
      `MATCH (a:Ingredient)-[r1:CONTRAINDICATED]-(mid:Ingredient)-[r2:CONTRAINDICATED]-(b:Ingredient)
       WHERE a.korName IN $ingredients
         AND b.korName IN $ingredients
         AND a.korName <> b.korName
         AND NOT (a)-[:CONTRAINDICATED]-(b)
       RETURN
         a.korName AS fromIngredient,
         mid.korName AS midIngredient,
         b.korName AS toIngredient,
         r1.reason AS reason1,
         r2.reason AS reason2`,
      { ingredients }
    );

    this.logger.log(`간접 경로: ${results.length}개 발견`);
    return results;
  }

  private async translateToKorean(ingredients: string[]): Promise<string[]> {
    const results = await this.graphService.runQuery<{ engName: string; korName: string }>(
      `MATCH (i:Ingredient)
      WHERE i.korName IN $ingredients
          OR toLower(i.engName) IN $engIngredients
      RETURN i.engName AS engName, i.korName AS korName`,
      {
        ingredients,
        engIngredients: ingredients.map(s => s.toLowerCase()),
      }
    );

    // engName → korName 매핑 생성
    const engToKor: Record<string, string> = {};
    for (const r of results) {
      if (r.engName) engToKor[r.engName.toLowerCase()] = r.korName;
      engToKor[r.korName] = r.korName;
    }

    // 입력 순서 유지하면서 한글로 변환
    const korNames = ingredients
      .map(ing => engToKor[ing.toLowerCase()] ?? engToKor[ing] ?? null)
      .filter(Boolean) as string[];

    this.logger.log(`성분 매핑: ${ingredients.join(', ')} → ${korNames.join(', ')}`);
    return korNames;
  }

  private async detectContraindicated(ingredients: string[]): Promise<DrugWarning[]> {
    const results = await this.graphService.runQuery<{
      aName: string; bName: string; reason: string;
    }>(
      `MATCH (a:Ingredient)-[r:CONTRAINDICATED]-(b:Ingredient)
      WHERE a.korName IN $ingredients AND b.korName IN $ingredients
        AND a.korName < b.korName
      RETURN a.korName AS aName, b.korName AS bName, r.reason AS reason`,
      { ingredients }
    );

    // 같은 조합의 경고를 하나로 통합
    const pairMap = new Map<string, { aName: string; bName: string; reasons: string[] }>();

    for (const r of results) {
      const key = `${r.aName}__${r.bName}`;
      if (!pairMap.has(key)) {
        pairMap.set(key, { aName: r.aName, bName: r.bName, reasons: [] });
      }
      if (r.reason) {
        pairMap.get(key)!.reasons.push(r.reason.trim());
      }
    }

    return Array.from(pairMap.values()).map(p => ({
      type: WarningType.CONTRAINDICATED,
      severity: Severity.CRITICAL,
      involvedIngredients: [p.aName, p.bName],
      rawMessage: `${p.aName}과 ${p.bName} 병용 금기: ${p.reasons.join(' / ')}`,
    }));
  }

  private async detectElderly(ingredients: string[]): Promise<DrugWarning[]> {
    const results = await this.graphService.runQuery<{
      korName: string; elderlyWarning: string;
    }>(
      `MATCH (i:Ingredient)
       WHERE i.korName IN $ingredients AND i.isElderlyTaboo = true
       RETURN i.korName AS korName, i.elderlyWarning AS elderlyWarning`,
      { ingredients }
    );
    return results.map(r => ({
      type: WarningType.ELDERLY,
      severity: Severity.HIGH,
      involvedIngredients: [r.korName],
      rawMessage: r.elderlyWarning ?? `${r.korName}은 노인 주의 성분입니다.`,
    }));
  }

  private async detectDuplicate(ingredients: string[]): Promise<DrugWarning[]> {
    const results = await this.graphService.runQuery<{
      effectCode: string; sersName: string; names: string[];
    }>(
      `MATCH (i:Ingredient)
       WHERE i.korName IN $ingredients AND i.effectCode IS NOT NULL
       WITH i.effectCode AS effectCode, i.sersName AS sersName,
            collect(i.korName) AS names
       WHERE size(names) > 1
       RETURN effectCode, sersName, names`,
      { ingredients }
    );
    return results.map(r => ({
      type: WarningType.DUPLICATE,
      severity: Severity.MEDIUM,
      involvedIngredients: r.names,
      rawMessage: `${r.sersName ?? r.effectCode} 계열 약물 중복 복용: ${r.names.join(', ')}`,
    }));
  }

  private async detectOverdose(drugs: DrugInput[]): Promise<DrugWarning[]> {
    const warnings: DrugWarning[] = [];
    for (const drug of drugs) {
      if (!drug.dose || !drug.dailyDoses) continue;
      const results = await this.graphService.runQuery<{
        korName: string; maxQty: string;
      }>(
        `MATCH (i:Ingredient)
         WHERE i.korName IN $ingredients AND i.maxQty IS NOT NULL
         RETURN i.korName AS korName, i.maxQty AS maxQty`,
        { ingredients: drug.ingredients }
      );
      for (const r of results) {
        const maxQtyNum = parseFloat(r.maxQty.replace(/[^0-9.]/g, ''));
        if (!isNaN(maxQtyNum) && drug.dose > maxQtyNum) {
          warnings.push({
            type: WarningType.OVERDOSE,
            severity: Severity.HIGH,
            involvedIngredients: [r.korName],
            rawMessage: `${r.korName} 1회 복용량(${drug.dose})이 최대 허용량(${r.maxQty}) 초과`,
          });
        }
      }
    }
    return warnings;
  }

  private async detectPregnancy(ingredients: string[]): Promise<DrugWarning[]> {
    const results = await this.graphService.runQuery<{
      korName: string; pregnancyGrade: string;
    }>(
      `MATCH (i:Ingredient)
       WHERE i.korName IN $ingredients AND i.isPregnancyTaboo = true
       RETURN i.korName AS korName, i.pregnancyGrade AS pregnancyGrade`,
      { ingredients }
    );
    return results.map(r => ({
      type: WarningType.PREGNANCY,
      severity: r.pregnancyGrade === '1등급' ? Severity.CRITICAL : Severity.HIGH,
      involvedIngredients: [r.korName],
      rawMessage: `${r.korName}은 임부금기 성분입니다. (${r.pregnancyGrade ?? '등급 미분류'})`,
    }));
  }

  private async detectDuration(drugs: DrugInput[]): Promise<DrugWarning[]> {
    const warnings: DrugWarning[] = [];
    for (const drug of drugs) {
      if (!drug.totalDays) continue;
      const results = await this.graphService.runQuery<{
        korName: string; maxDosageTerm: string;
      }>(
        `MATCH (i:Ingredient)
         WHERE i.korName IN $ingredients AND i.maxDosageTerm IS NOT NULL
         RETURN i.korName AS korName, i.maxDosageTerm AS maxDosageTerm`,
        { ingredients: drug.ingredients }
      );
      for (const r of results) {
        const maxDays = parseFloat(r.maxDosageTerm.replace(/[^0-9.]/g, ''));
        if (!isNaN(maxDays) && drug.totalDays > maxDays) {
          warnings.push({
            type: WarningType.DURATION,
            severity: Severity.MEDIUM,
            involvedIngredients: [r.korName],
            rawMessage: `${r.korName} 투여기간(${drug.totalDays}일)이 최대 권장기간(${r.maxDosageTerm}) 초과`,
          });
        }
      }
    }
    return warnings;
  }
}
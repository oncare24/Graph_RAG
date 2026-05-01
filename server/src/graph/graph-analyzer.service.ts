import { Injectable, Logger } from '@nestjs/common';
import { GraphService } from './graph.service';
import { DrugInput, DrugWarning, WarningType, Severity } from '../common/types/warning.type';

@Injectable()
export class GraphAnalyzerService {
  private readonly logger = new Logger(GraphAnalyzerService.name); // ← 이게 빠져있었어

  constructor(private readonly graphService: GraphService) {}

  async analyze(drugs: DrugInput[]): Promise<DrugWarning[]> {
    const allIngredients = [...new Set(drugs.flatMap(d => d.ingredients))];
    if (allIngredients.length === 0) return [];

    // 영문 → 한글 변환
    const korIngredients = await this.translateToKorean(allIngredients);
    if (korIngredients.length === 0) return [];

    // 한글 성분명으로 업데이트된 drugs 생성
    const korDrugs = drugs.map(d => ({
      ...d,
      ingredients: d.ingredients.map(ing => {
        // 영문 → 한글 매핑
        const idx = allIngredients.findIndex(
          i => i.toLowerCase() === ing.toLowerCase()
        );
        return korIngredients[idx] ?? ing;
      }).filter(ing => korIngredients.includes(ing)),
    }));

    const warnings: DrugWarning[] = [];
    const [contraindicated, elderly, duplicate, overdose, pregnancy, duration] = await Promise.all([
      this.detectContraindicated(korIngredients),
      this.detectElderly(korIngredients),
      this.detectDuplicate(korIngredients),
      this.detectOverdose(korDrugs),   // ← korDrugs 사용
      this.detectPregnancy(korIngredients),
      this.detectDuration(korDrugs),   // ← korDrugs 사용
    ]);

    warnings.push(...contraindicated, ...elderly, ...duplicate, ...overdose, ...pregnancy, ...duration);
    return warnings;
  }

  private async translateToKorean(ingredients: string[]): Promise<string[]> {
    const results = await this.graphService.runQuery<{ korName: string }>(
      `MATCH (i:Ingredient)
       WHERE i.korName IN $ingredients
          OR toLower(i.engName) IN $engIngredients
       RETURN i.korName AS korName`,
      {
        ingredients,
        engIngredients: ingredients.map(s => s.toLowerCase()),
      }
    );

    const korNames = results.map(r => r.korName);
    this.logger.log(`성분 매핑: ${ingredients.join(', ')} → ${korNames.join(', ')}`);
    return korNames;
  }

  private async detectContraindicated(ingredients: string[]): Promise<DrugWarning[]> {
    const results = await this.graphService.runQuery<{
      aName: string;
      bName: string;
      reason: string;
    }>(
      `MATCH (a:Ingredient)-[r:CONTRAINDICATED]-(b:Ingredient)
       WHERE a.korName IN $ingredients AND b.korName IN $ingredients
         AND a.korName < b.korName
       RETURN a.korName AS aName, b.korName AS bName, r.reason AS reason`,
      { ingredients }
    );

    return results.map(r => ({
      type: WarningType.CONTRAINDICATED,
      severity: Severity.CRITICAL,
      involvedIngredients: [r.aName, r.bName],
      rawMessage: `${r.aName}과 ${r.bName} 병용 금기: ${r.reason}`,
    }));
  }

  private async detectElderly(ingredients: string[]): Promise<DrugWarning[]> {
    const results = await this.graphService.runQuery<{
      korName: string;
      elderlyWarning: string;
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
      effectCode: string;
      sersName: string;
      names: string[];
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
        korName: string;
        maxQty: string;
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
      korName: string;
      pregnancyGrade: string;
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
        korName: string;
        maxDosageTerm: string;
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

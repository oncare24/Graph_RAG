import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { GraphAnalyzerService } from '../graph/graph-analyzer.service';
import { LlmService } from '../llm/llm.service';
import { AnalyzeDrugDto } from './dto/analyze-drug.dto';
import { DrugWarning, DrugInput, WarningType } from '../common/types/warning.type';

@Injectable()
export class DrugService {
  private readonly logger = new Logger(DrugService.name);

  constructor(
    private readonly graphAnalyzer: GraphAnalyzerService,
    private readonly llmService: LlmService,
  ) {}

  async analyzeDrugs(dto: AnalyzeDrugDto): Promise<DrugWarning[]> {
    const validDrugs = dto.drugs.filter(d => d.ingredients.length > 0);
    const skipped = dto.drugs.filter(d => d.ingredients.length === 0);

    if (skipped.length > 0) {
      this.logger.warn(`성분 정보 없는 약 스킵: ${skipped.map(d => d.drugName).join(', ')}`);
    }

    if (validDrugs.length === 0) {
      throw new BadRequestException('분석 가능한 약물 정보가 없습니다. 성분 정보를 확인해주세요.');
    }

    // 성분명 → 약 이름 매핑 (영문 기준)
    const ingredientToDrugName: Record<string, string> = {};
    for (const drug of validDrugs) {
      for (const ingredient of drug.ingredients) {
        ingredientToDrugName[ingredient] = drug.drugName;
      }
    }

    const drugs: DrugInput[] = validDrugs.map(d => ({
      drugName: d.drugName,
      ingredients: d.ingredients,
      dose: d.dose,
      dailyDoses: d.dailyDoses,
      totalDays: d.totalDays,
      ingredientToDrugName,
    }));

    // 1. Graph 분석
    const { warnings: rawWarnings, subgraph, korIngredientMap } = await this.graphAnalyzer.analyze(drugs);
    this.logger.log(`분석 완료: ${rawWarnings.length}개 경고 탐지`);

    // 2. 영문 → 한글 성분명 매핑 업데이트
    if (korIngredientMap) {
      for (const [eng, kor] of Object.entries(korIngredientMap)) {
        if (ingredientToDrugName[eng]) {
          ingredientToDrugName[kor] = ingredientToDrugName[eng];
        }
      }
    }

    this.logger.log(`약 이름 매핑: ${JSON.stringify(ingredientToDrugName)}`);

    // 3. 사용자 정보 기반 필터링
    let warnings = this.filterByUserInfo(rawWarnings, dto.age, dto.isPregnant);

    if (warnings.length === 0) return [];

    // 4. LLM 설명 생성
    const explained = await this.llmService.reasonFromSubgraph(
      subgraph,
      warnings,
      ingredientToDrugName,
      dto.age,
      dto.isPregnant,
    );

    // 5. involvedDrugNames 추가
    return explained.map(w => ({
      ...w,
      involvedDrugNames: w.involvedIngredients.map(
        ing => ingredientToDrugName[ing] ?? ing
      ),
    }));
  }

  private filterByUserInfo(
    warnings: DrugWarning[],
    age?: number,
    isPregnant?: boolean,
  ): DrugWarning[] {
    return warnings.filter(w => {
      if (w.type === WarningType.PREGNANCY && isPregnant === false) {
        return false;
      }
      if (w.type === WarningType.ELDERLY && age !== undefined && age < 65) {
        return false;
      }
      return true;
    });
  }
}

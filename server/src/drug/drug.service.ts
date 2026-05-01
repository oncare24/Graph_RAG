import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { GraphAnalyzerService } from '../graph/graph-analyzer.service';
import { LlmService } from '../llm/llm.service';
import { AnalyzeDrugDto } from './dto/analyze-drug.dto';
import { DrugWarning, DrugInput } from '../common/types/warning.type';

@Injectable()
export class DrugService {
  private readonly logger = new Logger(DrugService.name);

  constructor(
    private readonly graphAnalyzer: GraphAnalyzerService,
    private readonly llmService: LlmService,
  ) {}

  async analyzeDrugs(dto: AnalyzeDrugDto): Promise<DrugWarning[]> {
    // 성분 없는 약 필터링 + 경고
    const validDrugs = dto.drugs.filter(d => d.ingredients.length > 0);
    const skipped = dto.drugs.filter(d => d.ingredients.length === 0);

    if (skipped.length > 0) {
      this.logger.warn(`성분 정보 없는 약 스킵: ${skipped.map(d => d.drugName).join(', ')}`);
    }

    if (validDrugs.length === 0) {
      throw new BadRequestException('분석 가능한 약물 정보가 없습니다. 성분 정보를 확인해주세요.');
    }

    const drugs: DrugInput[] = validDrugs.map(d => ({
      drugName: d.drugName,
      ingredients: d.ingredients,
      dose: d.dose,
      dailyDoses: d.dailyDoses,
      totalDays: d.totalDays,
    }));

    // 1. Graph 분석
    const warnings = await this.graphAnalyzer.analyze(drugs);
    this.logger.log(`분석 완료: ${warnings.length}개 경고 탐지`);

    // 2. LLM 설명 생성 (실패해도 rawMessage로 대체)
    const explained = warnings.length > 0
      ? await this.llmService.explainWarnings(warnings)
      : [];

    return explained;
  }
}

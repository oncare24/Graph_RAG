import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { DrugWarning, WarningType, SubGraph } from '../common/types/warning.type';

@Injectable()
export class LlmService {
  private client: OpenAI;
  private readonly logger = new Logger(LlmService.name);

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async reasonFromSubgraph(
    subgraph: SubGraph | null,
    warnings: DrugWarning[],
    ingredientToDrugName: Record<string, string> = {},
    age?: number,
    isPregnant?: boolean,
  ): Promise<DrugWarning[]> {
    if (warnings.length === 0) return [];
    if (!subgraph || subgraph.nodes.length === 0) {
      return this.explainWarnings(warnings, ingredientToDrugName);
    }

    try {
      const graphContext = this.buildGraphContext(subgraph, ingredientToDrugName);

      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content: `당신은 고령자를 위한 약물 안전 상담사입니다.
${age ? `환자 나이: ${age}세` : ''}
${isPregnant ? '임신 중인 환자입니다.' : ''}
주어진 약물 지식 그래프를 분석하여 위험을 설명하세요.

반드시 지켜야 할 규칙:
1. 성분명 대신 반드시 약 이름으로 설명 (성분명은 괄호 안에만 표기)
   예) "아세트아미노펜" -> "타이레놀(아세트아미노펜)"
2. 전문 의학 용어 사용 금지
3. 겁주지 말고 사실만 전달
4. 반드시 "의사나 약사와 상담해 보세요"로 마무리
5. 2문장 이내로 작성
6. 번호나 볼드(**) 사용 금지
7. 그래프에 없는 내용은 절대 만들어내지 마세요
8. 약 이름은 반드시 제공된 그래프의 표기 그대로 정확히 사용하세요. 절대 변형하지 마세요.`,
          },
          {
  role: 'user',
  content: `## 약물 지식 그래프
${graphContext}

## 탐지된 경고 (반드시 이 순서대로 각각 설명)
${warnings.map((w, i) => {
  const drugNames = w.involvedIngredients
    .map(ing => ingredientToDrugName[ing] ? `${ingredientToDrugName[ing]}(${ing})` : ing)
    .join(', ');
  return `[${i + 1}] 관련약: ${drugNames} | 경고: ${w.rawMessage}`;
}).join('\n')}

규칙:
- 반드시 위 ${warnings.length}개 경고를 순서대로 각각 설명
- 약 이름 중심으로 설명 (성분명은 괄호 안에만)
- 전문 의학 용어 사용 금지
- 겁주지 말고 사실 전달
- 각 설명 마지막에 "의사나 약사와 상담해 보세요" 포함
- 2문장 이내
- 번호나 볼드(**) 사용 금지
- 각 설명은 반드시 "---"로 구분`,
          },
        ]
      });

      const text = response.choices[0].message.content ?? '';
      const explanations = text.split('---').map(s => s.trim()).filter(Boolean);

      return warnings.map((w, idx) => ({
        ...w,
        explanation: explanations[idx] ?? w.rawMessage,
      }));

    } catch (err) {
      this.logger.warn(`서브그래프 추론 실패: ${err.message}`);
      return this.explainWarnings(warnings, ingredientToDrugName);
    }
  }

  async explainWarnings(
    warnings: DrugWarning[],
    ingredientToDrugName: Record<string, string> = {},
  ): Promise<DrugWarning[]> {
    if (warnings.length === 0) return [];
    try {
      const prompt = this.buildPrompt(warnings, ingredientToDrugName);
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = response.choices[0].message.content ?? '';
      const explanations = text.split('---').map(s => s.trim()).filter(Boolean);
      return warnings.map((w, idx) => ({
        ...w,
        explanation: explanations[idx] ?? w.rawMessage,
      }));
    } catch (err) {
      this.logger.warn(`LLM 설명 생성 실패: ${err.message}`);
      return warnings.map(w => ({ ...w, explanation: w.rawMessage }));
    }
  }

  private buildGraphContext(
    subgraph: SubGraph,
    ingredientToDrugName: Record<string, string>,
  ): string {
    const getDrugName = (ingredient: string) => {
      const drugName = ingredientToDrugName[ingredient];
      return drugName ? `${drugName}(${ingredient})` : ingredient;
    };

    const nodeText = subgraph.nodes.map(n => {
      const attrs: string[] = [];
      const displayName = getDrugName(n.name);
      if (n.class) attrs.push(`분류: ${n.class}`);
      if (n.isElderlyTaboo) attrs.push(`노인주의: ${n.elderlyWarning ?? '주의 필요'}`);
      if (n.effectCode) attrs.push(`효능군: ${n.sersName ?? n.effectCode}`);
      if (n.maxQty) attrs.push(`최대용량: ${n.maxQty}`);
      if (n.maxDosageTerm) attrs.push(`최대투여기간: ${n.maxDosageTerm}`);
      if (n.isPregnancyTaboo) attrs.push(`임부금기: ${n.pregnancyGrade ?? '금기'}`);
      return `[약물] ${displayName} (${attrs.join(', ')})`;
    }).join('\n');

    const edgeText = subgraph.edges.map(e =>
      `[직접관계] ${getDrugName(e.from)} --[병용금기]--> ${getDrugName(e.to)}: ${e.reason}`
    ).join('\n');

    const indirectText = subgraph.indirectPaths?.map(p =>
      `[간접관계] ${getDrugName(p.fromIngredient)} -> ${getDrugName(p.midIngredient)} -> ${getDrugName(p.toIngredient)}: ` +
      `(${p.reason1}) + (${p.reason2})`
    ).join('\n') ?? '';

    return [
      `### 약물 노드\n${nodeText}`,
      `### 직접 관계\n${edgeText || '직접 병용금기 없음'}`,
      `### 간접 경로 (2홉)\n${indirectText || '간접 경로 없음'}`,
    ].join('\n\n');
  }

  private buildPrompt(
    warnings: DrugWarning[],
    ingredientToDrugName: Record<string, string>,
  ): string {
    const getDrugName = (ingredient: string) => {
      const drugName = ingredientToDrugName[ingredient];
      return drugName ? `${drugName}(${ingredient})` : ingredient;
    };

    const typeLabel = (type: WarningType) => {
      const map = {
        [WarningType.CONTRAINDICATED]: '병용금기',
        [WarningType.DUPLICATE]: '효능군중복',
        [WarningType.OVERDOSE]: '용량주의',
        [WarningType.ELDERLY]: '노인주의',
        [WarningType.PREGNANCY]: '임부금기',
        [WarningType.DURATION]: '투여기간주의',
      };
      return map[type] ?? type;
    };

    const warningText = warnings.map((w, i) => {
      const drugNames = w.involvedIngredients.map(getDrugName).join(', ');
      return `[${i + 1}] [${typeLabel(w.type)}] 관련 약: ${drugNames} - ${w.rawMessage}`;
    }).join('\n');

    return `당신은 고령자를 위한 약물 안전 상담사입니다.
아래 약물 경고를 약 이름 중심으로 쉽게 설명해주세요.

규칙:
- 성분명 대신 약 이름으로 설명 (성분명은 괄호 안에만)
- 전문 의학 용어 사용 금지
- 겁주지 말고 사실 전달
- 반드시 "의사나 약사와 상담해 보세요"로 마무리
- 2문장 이내
- 번호나 볼드(**) 사용 금지
- 각 설명은 "---"로 구분

경고 목록:
${warningText}`;
  }
}

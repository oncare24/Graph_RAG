import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { DrugWarning, WarningType } from '../common/types/warning.type';

@Injectable()
export class LlmService {
  private client: OpenAI;
  private readonly logger = new Logger(LlmService.name);

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async explainWarnings(warnings: DrugWarning[]): Promise<DrugWarning[]> {
    if (warnings.length === 0) return [];

    try {
      const prompt = this.buildPrompt(warnings);
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
      // LLM 실패해도 rawMessage로 대체해서 반환
      this.logger.warn(`LLM 설명 생성 실패, rawMessage로 대체: ${err.message}`);
      return warnings.map(w => ({
        ...w,
        explanation: w.rawMessage,
      }));
    }
  }

  private buildPrompt(warnings: DrugWarning[]): string {
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

    return `당신은 고령자에게 약물 주의사항을 쉽게 설명하는 전문가입니다.
아래 약물 경고 목록을 60세 이상 어르신도 이해할 수 있는 쉬운 말로 설명해주세요.

규칙:
- 의학 전문용어 사용 금지
- 판단(위험하다/안전하다)이 아닌 사실 전달
- 각 설명은 반드시 "---"로 구분
- 설명은 2문장 이내

경고 목록:
${warnings.map((w, i) => `[${i + 1}] [${typeLabel(w.type)}] ${w.rawMessage}`).join('\n')}`;
  }
}

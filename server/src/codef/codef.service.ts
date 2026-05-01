import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { DrugInput } from '../common/types/warning.type';

@Injectable()
export class CodefService {
  private readonly BASE_URL = 'https://development.codef.io';
  private readonly TOKEN_URL = 'https://oauth.codef.io/oauth/token';
  private accessToken: string | null = null;
  private readonly logger = new Logger(CodefService.name);

  private async getToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;

    try {
      const clientId = process.env.CODEF_CLIENT_ID!;
      const clientSecret = process.env.CODEF_CLIENT_SECRET!;
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      const res = await fetch(this.TOKEN_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials&scope=read',
      });

      const data = await res.json() as { access_token: string };
      if (!data.access_token) throw new Error('토큰이 없습니다');

      this.accessToken = data.access_token;
      return this.accessToken;
    } catch (err) {
      throw new ServiceUnavailableException('CODEF 인증 서버에 연결할 수 없습니다.');
    }
  }

  private async callApi(endpoint: string, body: Record<string, any>): Promise<any> {
  const token = await this.getToken();

  // 타임아웃 30초 설정
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  try {
    const res = await fetch(`${this.BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 401) {
      this.accessToken = null;
      return this.callApi(endpoint, body);
    }

    const rawText = await res.text();
    try {
      return JSON.parse(decodeURIComponent(rawText));
    } catch {
      throw new ServiceUnavailableException('CODEF 응답 파싱 실패');
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR') {
      throw new ServiceUnavailableException('CODEF 서버 응답 시간 초과 (5분)');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

  async requestMedicine(
    identity: string,
    userName: string,
    phoneNo: string,
  ): Promise<{ jti: string; twoWayTimestamp: number; transactionId: string }> {

    const data = await this.callApi('/v1/kr/public/hw/hira-list/my-medicine', {
      organization: '0020',
      loginType: '5',
      identity,
      loginTypeLevel: '1',
      userName,
      userPassword: '',
      phoneNo,
      inquiryType: '0',
      // startDate 없음 → 전체 조회
    });

    if (data.result.code !== 'CF-03002') {
      throw new BadRequestException(`인증 요청 실패: ${decodeURIComponent(data.result.message.replace(/\+/g, ' '))}`);
    }

    return {
      jti: data.data.jti,
      twoWayTimestamp: data.data.twoWayTimestamp,
      transactionId: data.result.transactionId,
    };
  }

  async confirmMedicine(
    identity: string,
    userName: string,
    phoneNo: string,
    jti: string,
    twoWayTimestamp: number,
  ): Promise<DrugInput[]> {  // startDate 파라미터 제거

    const data = await this.callApi('/v1/kr/public/hw/hira-list/my-medicine', {
      organization: '0020',
      loginType: '5',
      identity,
      loginTypeLevel: '1',
      userName,
      userPassword: '',
      phoneNo,
      inquiryType: '0',
      simpleAuth: '1',
      is2Way: true,
      // startDate 완전히 제거 → 전체 조회
      twoWayInfo: {
        jobIndex: 0,
        threadIndex: 0,
        jti,
        twoWayTimestamp,
      },
    });

    if (data.result.code !== 'CF-00000') {
      throw new BadRequestException(`인증 확인 실패: ${decodeURIComponent(data.result.message.replace(/\+/g, ' '))}`);
    }

    // 실제 응답 데이터 로그로 확인
    this.logger.log(`CODEF 응답 data: ${JSON.stringify(data.data, null, 2)}`);

    return this.parseDrugList(data.data);
  }

  private parseDrugList(prescriptions: any[]): DrugInput[] {
    if (!Array.isArray(prescriptions) || prescriptions.length === 0) {
      this.logger.warn('처방 데이터가 없습니다');
      return [];
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const drugMap = new Map<string, DrugInput>();

    for (const prescription of prescriptions) {
      const drugList = prescription.resDrugList ?? [];
      const manufactureDate = prescription.resManufactureDate; // "20260418"

      for (const d of drugList) {
        if (!d.resDrugName) continue;
        if (drugMap.has(d.resDrugCode)) continue;

        // 복용 종료일 계산
        const totalDays = parseInt(d.resTotalDosingdays ?? '0');
        const startDate = new Date(
          parseInt(manufactureDate.slice(0, 4)),
          parseInt(manufactureDate.slice(4, 6)) - 1,
          parseInt(manufactureDate.slice(6, 8))
        );
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + totalDays);

        // 복용 종료일이 오늘 이전이면 스킵
        //if (endDate < today) {
        //  this.logger.log(`복용 종료된 약 스킵: ${d.resDrugName} (종료일: ${endDate.toLocaleDateString()})`);
        //  continue;
        //}

        const engIngredients = d.resIngredients
          ? d.resIngredients
              .split('+')
              .map((s: string) => s.trim())
              .filter((s: string) => s && !s.startsWith('(') && !s.startsWith('as'))
              .slice(0, 1)
          : [];

        drugMap.set(d.resDrugCode, {
          drugName: d.resDrugName,
          ingredients: engIngredients,
          dose: d.resOneDose ? parseFloat(d.resOneDose) : undefined,
          dailyDoses: d.resDailyDosesNumber ? parseFloat(d.resDailyDosesNumber) : undefined,
          totalDays: totalDays || undefined,
        });
      }
    }

    const result = Array.from(drugMap.values());
    this.logger.log(`현재 복용 중인 약: ${result.map(d => d.drugName).join(', ')}`);
    return result;
  }
}
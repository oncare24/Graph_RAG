import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { DrugInput } from '../common/types/warning.type';

export interface PrescriptionItem {
  resDrugName: string;
  resIngredients: string;
  resPrescribeDrugEffect: string;
  resContent: string;
  resOneDose: string;
  resDailyDosesNumber: string | null;
  resTotalDosingdays: string | null;
  resPrescribeOrg: string;
  resManufactureDate: string;
  resPrescribeNo: string;
  resDrugCode: string;
  imageUrl: string | null;  // ← 추가
}

@Injectable()
export class CodefService {
  private readonly BASE_URL = 'https://development.codef.io';
  private readonly TOKEN_URL = 'https://oauth.codef.io/oauth/token';
  private readonly DRUG_IMAGE_API = 'https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03';
  private accessToken: string | null = null;
  private readonly logger = new Logger(CodefService.name);
  private readonly imageCache = new Map<string, string | null>();

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

  // 약물 이미지 URL 조회
  private async fetchDrugImageUrl(drugName: string): Promise<string | null> {
    // 캐시 확인
    if (this.imageCache.has(drugName)) {
      return this.imageCache.get(drugName)!;
    }

    try {
      const apiKey = process.env.DRUG_IMAGE_API_KEY!;
      const url = `${this.DRUG_IMAGE_API}?serviceKey=${apiKey}&pageNo=1&numOfRows=1&item_name=${encodeURIComponent(drugName)}&type=json`;
      const res = await fetch(url);
      const data = await res.json();
      const imageUrl = data?.body?.items?.[0]?.ITEM_IMAGE ?? null;
      this.imageCache.set(drugName, imageUrl);
      return imageUrl;
    } catch (err) {
      this.logger.warn(`이미지 조회 실패: ${drugName} - ${err.message}`);
      this.imageCache.set(drugName, null);
      return null;
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
  ): Promise<{ drugs: DrugInput[]; prescriptions: PrescriptionItem[] }> {
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
      twoWayInfo: {
        jobIndex: 0,
        threadIndex: 0,
        jti,
        twoWayTimestamp,
      },
    });

    this.logger.log(`CODEF 2차 응답 코드: ${data.result.code}, 메시지: ${data.result.message}`);

    if (data.result.code !== 'CF-00000') {
      throw new BadRequestException(`인증 확인 실패: ${decodeURIComponent(data.result.message.replace(/\+/g, ' '))}`);
    }

    return this.parseDrugList(data.data);
  }

  private async parseDrugList(prescriptions: any[]): Promise<{ drugs: DrugInput[]; prescriptions: PrescriptionItem[] }> {
    if (!Array.isArray(prescriptions) || prescriptions.length === 0) {
      this.logger.warn('처방 데이터가 없습니다');
      return { drugs: [], prescriptions: [] };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const drugMap = new Map<string, DrugInput>();
    const prescriptionList: PrescriptionItem[] = [];

    for (const prescription of prescriptions) {
      const drugList = prescription.resDrugList ?? [];
      const manufactureDate = prescription.resManufactureDate ?? '';
      const prescribeOrg = prescription.resPrescribeOrg ?? '';
      const prescribeNo = prescription.resPrescribeNo ?? '';

      for (const d of drugList) {
        if (!d.resDrugName) continue;

        const totalDays = parseInt(d.resTotalDosingdays ?? '0');
        const startDate = new Date(
          parseInt(manufactureDate.slice(0, 4)),
          parseInt(manufactureDate.slice(4, 6)) - 1,
          parseInt(manufactureDate.slice(6, 8))
        );
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + totalDays);

        // 복용 종료일 필터링 (현재 주석 처리 - 테스트용)
        // ⚠️ 서비스 출시 전 아래 주석 해제 필요
        // if (endDate < today) {
        //   this.logger.log(`복용 종료된 약 스킵: ${d.resDrugName}`);
        //   continue;
        // }

        const dailyDoses = d.resDailyDosesNumber && d.resDailyDosesNumber !== '0'
          ? d.resDailyDosesNumber : null;
        const totalDosingDays = d.resTotalDosingdays && d.resTotalDosingdays !== '0'
          ? d.resTotalDosingdays : null;

        // 이미지 URL 조회
        const imageUrl = await this.fetchDrugImageUrl(d.resDrugName);

        prescriptionList.push({
          resDrugName: d.resDrugName ?? '',
          resIngredients: d.resIngredients ?? '',
          resPrescribeDrugEffect: d.resPrescribeDrugEffect ?? '',
          resContent: d.resContent ?? '',
          resOneDose: d.resOneDose ?? '',
          resDailyDosesNumber: dailyDoses,
          resTotalDosingdays: totalDosingDays,
          resPrescribeOrg: prescribeOrg,
          resManufactureDate: manufactureDate,
          resPrescribeNo: prescribeNo,
          resDrugCode: d.resDrugCode ?? '',
          imageUrl,
        });

        if (drugMap.has(d.resDrugCode)) continue;

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
          dailyDoses: dailyDoses ? parseFloat(dailyDoses) : undefined,
          totalDays: totalDosingDays ? parseFloat(totalDosingDays) : undefined,
        });
      }
    }

    const result = Array.from(drugMap.values());
    this.logger.log(`파싱된 약물: ${result.map(d => d.drugName).join(', ')}`);
    return { drugs: result, prescriptions: prescriptionList };
  }
}

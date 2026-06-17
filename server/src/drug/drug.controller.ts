import { Controller, Post, Body, HttpCode, Get } from '@nestjs/common';
import { DrugService } from './drug.service';
import { CodefService } from '../codef/codef.service';
import { AnalyzeDrugDto } from './dto/analyze-drug.dto';
import { IsString, IsNumber, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

class RequestMedicineDto {
  @IsString()
  identity: string;

  @IsString()
  userName: string;

  @IsString()
  phoneNo: string;
}

class ConfirmMedicineDto {
  @IsString()
  identity: string;

  @IsString()
  userName: string;

  @IsString()
  phoneNo: string;

  @IsString()
  jti: string;

  @IsNumber()
  @Type(() => Number)
  twoWayTimestamp: number;

  @IsNumber()
  @Type(() => Number)
  age: number;

  @IsBoolean()
  @Type(() => Boolean)
  isPregnant: boolean;
}

@Controller('drug')
export class DrugController {
  constructor(
    private readonly drugService: DrugService,
    private readonly codefService: CodefService,
  ) {}

  @Post('analyze')
  @HttpCode(200)
  async analyze(@Body() dto: AnalyzeDrugDto) {
    return this.drugService.analyzeDrugs(dto);
  }

  @Post('codef/request')
  @HttpCode(200)
  async requestCodef(@Body() dto: RequestMedicineDto) {
    return this.codefService.requestMedicine(
      dto.identity,
      dto.userName,
      dto.phoneNo,
    );
  }

  @Post('codef/confirm')
  @HttpCode(200)
  async confirmCodef(@Body() dto: ConfirmMedicineDto) {
    const { drugs, prescriptions } = await this.codefService.confirmMedicine(
      dto.identity,
      dto.userName,
      dto.phoneNo,
      dto.jti,
      dto.twoWayTimestamp,
    );

    // 처방 기록 없을 때
    if (drugs.length === 0) {
      return {
        warnings: [],
        prescriptions: [],
        message: '처방 기록이 없습니다.',
      };
    }

    const warnings = await this.drugService.analyzeDrugs({
      drugs,
      age: dto.age,
      isPregnant: dto.isPregnant,
    });

    return {
      warnings,
      prescriptions,
    };
  }

  @Get('demo')
  @HttpCode(200)
  async demo() {
    const mockDrugs = {
      drugs: [
        { drugName: '이트라코나졸캡슐', ingredients: ['이트라코나졸'] },
        { drugName: '심바스타틴정', ingredients: ['심바스타틴'] },
        { drugName: '트리아졸람정', ingredients: ['트리아졸람'], totalDays: 30 },
        { drugName: '아세클로페낙정', ingredients: ['아세클로페낙'] },
        { drugName: '이부프로펜정', ingredients: ['이부프로펜'] },
      ],
      age: 75,
      isPregnant: false,
    };
    return this.drugService.analyzeDrugs(mockDrugs);
  }
}

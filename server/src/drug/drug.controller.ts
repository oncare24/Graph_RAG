import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { DrugService } from './drug.service';
import { CodefService } from '../codef/codef.service';
import { AnalyzeDrugDto } from './dto/analyze-drug.dto';
import { IsString, IsNumber } from 'class-validator';

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
  twoWayTimestamp: number;
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
    const drugs = await this.codefService.confirmMedicine(
      dto.identity,
      dto.userName,
      dto.phoneNo,
      dto.jti,
      dto.twoWayTimestamp,
    );
    return this.drugService.analyzeDrugs({ drugs });
  }
}
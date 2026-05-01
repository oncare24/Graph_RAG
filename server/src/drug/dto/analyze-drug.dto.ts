import { IsArray, IsString, IsNumber, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DrugInputDto {
  @IsString()
  drugName: string;

  @IsArray()
  @IsString({ each: true })
  ingredients: string[];

  @IsOptional()
  @IsNumber()
  dose?: number;

  @IsOptional()
  @IsNumber()
  dailyDoses?: number;

  @IsOptional()
  @IsNumber()
  totalDays?: number;
}

export class AnalyzeDrugDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DrugInputDto)
  drugs: DrugInputDto[];

  @IsOptional()
  @IsString()
  userId?: string;
}

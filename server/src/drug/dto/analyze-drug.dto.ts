import { IsArray, IsString, IsNumber, IsOptional, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DrugInputDto {
  @IsString()
  drugName: string;

  @IsArray()
  @IsString({ each: true })
  ingredients: string[];

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  dose?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  dailyDoses?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  totalDays?: number;
}

export class AnalyzeDrugDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DrugInputDto)
  drugs: DrugInputDto[];

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  age?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isPregnant?: boolean;
}

import { Module } from '@nestjs/common';
import { CodefService } from './codef.service';

@Module({
  providers: [CodefService],
  exports: [CodefService],
})
export class CodefModule {}

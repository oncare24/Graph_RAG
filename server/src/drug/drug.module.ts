import { Module } from '@nestjs/common';
import { DrugController } from './drug.controller';
import { DrugService } from './drug.service';
import { GraphModule } from '../graph/graph.module';
import { LlmModule } from '../llm/llm.module';
import { CodefModule } from '../codef/codef.module';

@Module({
  imports: [GraphModule, LlmModule, CodefModule],
  controllers: [DrugController],
  providers: [DrugService],
})
export class DrugModule {}

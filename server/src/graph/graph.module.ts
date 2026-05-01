import { Module } from '@nestjs/common';
import { GraphService } from './graph.service';
import { GraphAnalyzerService } from './graph-analyzer.service';

@Module({
  providers: [GraphService, GraphAnalyzerService],
  exports: [GraphService, GraphAnalyzerService],
})
export class GraphModule {}

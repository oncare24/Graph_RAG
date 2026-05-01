import { Injectable, OnModuleInit, OnModuleDestroy, Logger, ServiceUnavailableException } from '@nestjs/common';
import neo4j, { Driver, Session } from 'neo4j-driver';

@Injectable()
export class GraphService implements OnModuleInit, OnModuleDestroy {
  private driver: Driver;
  private readonly logger = new Logger(GraphService.name);

  onModuleInit() {
    this.driver = neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!)
    );
    this.logger.log('Neo4j 드라이버 초기화 완료');
  }

  onModuleDestroy() {
    this.driver.close();
  }

  async runQuery<T>(cypher: string, params: Record<string, any> = {}): Promise<T[]> {
    const session: Session = this.driver.session();
    try {
      const result = await session.run(cypher, params);
      return result.records.map(record => record.toObject() as T);
    } catch (err) {
      this.logger.error(`Neo4j 쿼리 실패: ${err.message}`);
      throw new ServiceUnavailableException('데이터베이스 연결에 실패했습니다.');
    } finally {
      await session.close();
    }
  }
}

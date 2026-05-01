import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrugModule } from './drug/drug.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DrugModule,
  ],
})
export class AppModule {}

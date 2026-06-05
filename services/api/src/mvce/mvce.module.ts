import { Module } from "@nestjs/common";
import { MvceController } from "./mvce.controller";
import { MvceService } from "./mvce.service";

@Module({
  controllers: [MvceController],
  providers: [MvceService],
  exports: [MvceService],
})
export class MvceModule {}

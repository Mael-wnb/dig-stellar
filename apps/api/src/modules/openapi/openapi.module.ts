// apps/api/src/modules/openapi/openapi.module.ts
//
// Lot API: serves the public API contract (GET /v1/openapi.json) and its reference
// page (GET /v1/docs). Source of truth: apps/api/openapi/openapi.v1.yaml.
import { Module } from '@nestjs/common';
import { OpenApiController } from './openapi.controller';

@Module({
  controllers: [OpenApiController],
})
export class OpenApiModule {}

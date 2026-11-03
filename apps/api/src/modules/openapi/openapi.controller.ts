// apps/api/src/modules/openapi/openapi.controller.ts
//
// Lot API: the two public documentation routes.
//   GET /v1/openapi.json — the OpenAPI 3.1 document (parsed from the yaml at boot),
//                          cacheable for an hour.
//   GET /v1/docs         — a single static HTML page rendering the document with Scalar
//                          (CDN script). Explicit text/html: the API vhost sends
//                          X-Content-Type-Options: nosniff, so the type must be right.
// Both routes fall under the nginx `location /v1/` (api_general zone); no nginx change.
// Both answer `Access-Control-Allow-Origin: *` (GET only, no credentials): the contract
// and its page are public documents any origin may read. This is route-local; the
// global CORS policy in main.ts (allow-list + credentials) is untouched, and the data
// endpoints keep it. CORS for external data consumers is decided in the API-keys lot.
// No edits to any existing controller or service.
import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { loadOpenApiDocument, type OpenApiDocument } from './openapi-document';
import { renderDocsPage } from './docs-page';

@Controller('v1')
export class OpenApiController {
  private readonly document: OpenApiDocument | null;

  constructor() {
    try {
      this.document = loadOpenApiDocument();
    } catch (err) {
      // A packaging mistake must not take the data API down; the two docs
      // routes answer 503 and the boot log says why.
      console.error(
        `[openapi] document unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.document = null;
    }
  }

  @Get('openapi.json')
  @Header('Cache-Control', 'public, max-age=3600')
  @Header('Access-Control-Allow-Origin', '*')
  getDocument(): OpenApiDocument {
    if (!this.document) {
      throw new ServiceUnavailableException('OpenAPI document unavailable');
    }
    return this.document;
  }

  @Get('docs')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  @Header('Access-Control-Allow-Origin', '*')
  getDocsPage(): string {
    if (!this.document) {
      throw new ServiceUnavailableException('OpenAPI document unavailable');
    }
    return renderDocsPage({
      title: this.document.info.title,
      version: this.document.info.version,
      specUrl: '/v1/openapi.json',
    });
  }
}

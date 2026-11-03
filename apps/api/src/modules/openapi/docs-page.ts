// apps/api/src/modules/openapi/docs-page.ts
//
// Lot API: the GET /v1/docs page. One static HTML string, no build step. Scalar API
// Reference is loaded from the jsDelivr CDN (open item: vendor the bundle later) and
// pointed at the served document. Nothing here is user input, so no escaping concerns
// beyond the title/version which come from our own yaml.
//
// The CDN script is PINNED to an exact version so a Scalar release cannot change the
// page under us. Bump procedure: docs/api/README.md ("Scalar pin").
export const SCALAR_VERSION = '1.76.4';
const SCALAR_CDN = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/dist/browser/standalone.js`;

export type DocsPageOptions = {
  title: string;
  version: string;
  specUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderDocsPage(options: DocsPageOptions): string {
  const title = escapeHtml(`${options.title} v${options.version}`);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="Reference for the Dig Stellar public API: read-only Stellar DeFi data and signals.">
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="app"></div>
  <script src="${SCALAR_CDN}"></script>
  <script>
    Scalar.createApiReference('#app', {
      url: ${JSON.stringify(options.specUrl)},
      hideClientButton: true,
      showSidebar: true,
    });
  </script>
</body>
</html>
`;
}

// apps/indexer/src/lib/ops-capture.ts
//
// Side-effect entry: `import '../../lib/ops-capture'` as the FIRST import of a
// refresh step script installs the E2 RPC latency/error capture (ops-metrics)
// before any HTTP call is made. Kept separate from ops-metrics so entry scripts
// stay one-line and the capture module itself has no import-time side effects.
import { installOpsCapture } from './ops-metrics';

installOpsCapture();

// Pos-check da suite: falha se algum teste tentou chamar a Resend sem mock (ver no-network.ts).
import fs from 'node:fs';

const file = process.env.STI_HUB_TEST_RESEND_LOG || '/tmp/stihub-test-resend-attempts.log';
const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
if (lines.length > 0) {
  console.error(`[STI-hub testes] ${lines.length} tentativa(s) de chamada real a api.resend.com:`);
  for (const l of lines.slice(0, 20)) console.error(`  ${l}`);
  process.exit(1);
}
console.log('[STI-hub testes] Nenhuma chamada real a api.resend.com durante a suite.');

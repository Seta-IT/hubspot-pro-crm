/**
 * Emite o token da conta de servico "Assistente de Vendas" (svc-assistente-vendas).
 *
 *   node --experimental-strip-types scripts/issue-sales-agent-token.ts [caminho-do-arquivo] [--rotate]
 *
 * - Gera `stihub_svc_<base64url de 32 bytes aleatorios>`.
 * - Grava o token SOMENTE no arquivo (diretorio 700, arquivo 600). Padrao:
 *   /workspace/.secrets/sti-hub-assistente-vendas.token (ou STI_HUB_SALES_AGENT_TOKEN_FILE).
 * - Imprime APENAS o SHA-256 (hex) para configurar STI_HUB_SALES_AGENT_TOKEN_SHA256.
 * - Nao sobrescreve um token existente sem --rotate (rotacao: publique "novo,antigo" na env,
 *   faca o redeploy, troque o token no agente e depois remova o hash antigo).
 */
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const rotate = args.includes('--rotate');
const target = resolve(
  args.find((a) => !a.startsWith('--')) ||
    process.env.STI_HUB_SALES_AGENT_TOKEN_FILE ||
    '/workspace/.secrets/sti-hub-assistente-vendas.token'
);

if (existsSync(target) && !rotate) {
  console.error(`Ja existe um token em ${target}. Use --rotate para emitir um novo (nada foi alterado).`);
  process.exit(2);
}

const token = `stihub_svc_${randomBytes(32).toString('base64url')}`;
if (!/^stihub_svc_[A-Za-z0-9_-]{43}$/.test(token)) {
  console.error('Falha ao gerar token no formato esperado.');
  process.exit(1);
}
const dir = dirname(target);
mkdirSync(dir, { recursive: true, mode: 0o700 });
chmodSync(dir, 0o700);
writeFileSync(target, `${token}\n`, { mode: 0o600, flag: rotate ? 'w' : 'wx' });
chmodSync(target, 0o600);

const hash = createHash('sha256').update(token, 'utf8').digest('hex');
// Somente o hash (nao e segredo) vai para a saida.
console.log(hash);

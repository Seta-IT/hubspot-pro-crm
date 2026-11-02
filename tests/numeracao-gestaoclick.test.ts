import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildProposalDisplayCodeMap,
  formatProposalDisplayCode,
  migrateLegacyProposalCodes,
  nextGcProposalNumber,
} from '../src/app/lib/proposal-number';
import { formatProposalCode } from '../src/db/record-id-guard';
import { CrmApiRouter } from '../src/api/router';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { toSignedVersionShortUrl } from '../src/app/lib/proposal-link-client';
import { createInMemoryRepository, isRemovedFictitiousProposalId, removeFictitiousProposals } from '../src/db/repository';

describe('Numeracao de orcamentos no padrao GestaoClick', () => {
  it('converte GC-ORC-N para o numero GC e PROP-AAAA-NNN legado segue max+1 (4699)', () => {
    assert.equal(formatProposalDisplayCode('GC-ORC-4696'), '4696');
    assert.equal(formatProposalDisplayCode('#4695'), '4695');
    assert.equal(formatProposalCode(4704), '4704');
    const list = [
      { id: 'prop-gc-4695', code: '4695', createdAt: '2026-10-26' },
      { id: 'prop-gc-408248511', code: 'GC-ORC-4695', createdAt: '2026-10-26' },
      { id: 'prop-gc-409056266', code: 'GC-ORC-4698', createdAt: '2026-10-29' },
      { id: 'prop-user-7', code: 'PROP-2026-007', createdAt: '2026-11-01' },
    ];
    const display = buildProposalDisplayCodeMap(list);
    assert.equal(display.get('prop-gc-408248511'), '4695');
    assert.equal(display.get('prop-user-7'), '4699');
    migrateLegacyProposalCodes(list);
    assert.deepEqual(list.map((p) => p.code), ['4695', 'GC-ORC-4695', '4698', '4699']);
    assert.equal(nextGcProposalNumber(list.map((p) => p.code)), 4700);
  });

  it('t29u: seed so com propostas reais do GestaoClick; ficticias removidas no load e no journal; novo = 4699', async () => {
    const repo = createInMemoryRepository();
    const ids = repo.listProposals().map((p) => p.id);
    assert.ok(ids.includes('prop-gc-4695'));
    assert.ok(!ids.some((id) => isRemovedFictitiousProposalId(id)), 'sem prop-seta-00N no seed');
    assert.ok(ids.every((id) => id.startsWith('prop-gc-')), 'seed so com prop-gc-*');
    // contratos/faturas de outros modulos permanecem, apenas desvinculados
    const erp = (repo as unknown as { ensureErp: () => any }).ensureErp();
    assert.ok(erp.rentalContracts.some((c: any) => c.id === 'ctr-loc-101' && c.proposalId === null));
    // dado persistido antigo com as ficticias => removidas no load, vinculos desfeitos
    erp.proposals.push({ ...erp.proposals[0], id: 'prop-seta-001', code: '4699' });
    erp.rentalContracts[0].proposalId = 'prop-seta-001';
    const after = repo.listProposals().map((p) => p.id);
    assert.ok(!after.includes('prop-seta-001'));
    assert.equal(erp.rentalContracts[0].proposalId, null);
    assert.deepEqual(removeFictitiousProposals({ proposals: [], rentalContracts: [], invoices: [] } as any), []);
    const created = repo.createProposal({ title: 'Novo orcamento' });
    assert.equal(created.code, '4699');
  });

  it('t29u: short link ASSINADO /proposta/<id>/v/<n>#t= abre sem login so na versao atual', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const HTTP = { _fromHttpBridge: '1' };
    const rec = repo.findRbacUserRecord('usr-seta-01', '')!;
    const session = signStiHubSessionToken({
      uid: rec.id, email: rec.email, name: rec.name, roleId: rec.roleId, scope: rec.scope,
      enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
      mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000,
    } as Parameters<typeof signStiHubSessionToken>[0]);
    const prop = repo.listProposals().find((p) => p.id === 'prop-gc-4695')!;
    repo.updateProposal(prop.id, { validUntil: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) } as never);
    const issued = await router.dispatch({ method: 'POST', path: '/api/erp/proposals/prop-gc-4695/public-link', query: { ...HTTP, _origin: 'https://sti-hub.vercel.app', _sessionToken: session }, body: {} });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    const data = (issued.body as { data: { url: string; version: number } }).data;
    const shortUrl = toSignedVersionShortUrl(data.url, 'prop-gc-4695', data.version);
    assert.match(shortUrl, new RegExp(`^https://sti-hub\\.vercel\\.app/proposta/prop-gc-4695/v/${data.version}#t=[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$`));
    const token = shortUrl.split('#t=')[1];
    const anon = await router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-gc-4695', query: { ...HTTP, _clientIp: '198.51.100.77', proposalLinkToken: token } });
    assert.equal(anon.status, 200, 'abre sem login com o token');
    const noToken = await router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-gc-4695', query: { ...HTTP, _clientIp: '198.51.100.78' } });
    assert.notEqual(noToken.status, 200, 'sem token continua bloqueado');
    // nova versao => o link antigo deixa de abrir (validacao do servidor inalterada)
    repo.updateProposal('prop-gc-4695', { title: 'Revisao' } as never);
    const stale = await router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-gc-4695', query: { ...HTTP, _clientIp: '198.51.100.79', proposalLinkToken: token } });
    assert.notEqual(stale.status, 200);
  });

  it('proposta publica: Pilares sempre abertos (sem <details>) e codigo exibido no padrao GC', () => {
    const pageSrc = fs.readFileSync(path.join(process.cwd(), 'src/app/proposta/[id]/page.tsx'), 'utf8');
    assert.equal(pageSrc.includes('<details'), false);
    assert.equal(pageSrc.includes('Ver Pilares'), false);
    assert.ok(pageSrc.includes('Pilares de Soluções &amp; Arquitetura Seta Telecom'));
    assert.ok(pageSrc.includes('data-testid="proposal-pillars"'));
    assert.ok(pageSrc.includes('{displayCode}'));
    assert.equal(pageSrc.includes('{proposal.code}'), false);
  });
});

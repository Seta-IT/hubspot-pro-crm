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
import { signProposalLinkToken } from '../src/app/lib/proposal-link';
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
    // nova versao comercial => o mesmo token abre e devolve o titulo novo
    repo.updateProposal('prop-gc-4695', { title: 'Revisao' } as never);
    const revised = await router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-gc-4695', query: { ...HTTP, _clientIp: '198.51.100.79', proposalLinkToken: token } });
    assert.equal(revised.status, 200);
    assert.equal((revised.body as { data: { title: string } }).data.title, 'Revisao');
    const future = signProposalLinkToken({ proposalId: 'prop-gc-4695', version: (repo.listProposals().find((p) => p.id === 'prop-gc-4695')!.version || 1) + 5 }).token;
    const ahead = await router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-gc-4695', query: { ...HTTP, _clientIp: '198.51.100.80', proposalLinkToken: future } });
    assert.notEqual(ahead.status, 200);
  });

  it('t33u: short link opaco /p/<codigo> abre sem login, sobrevive a outra instancia e respeita versao/expiracao/revogacao', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const HTTP = { _fromHttpBridge: '1' };
    const rec = repo.findRbacUserRecord('usr-seta-01', '')!;
    const session = signStiHubSessionToken({
      uid: rec.id, email: rec.email, name: rec.name, roleId: rec.roleId, scope: rec.scope,
      enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
      mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000,
    } as Parameters<typeof signStiHubSessionToken>[0]);
    repo.updateProposal('prop-gc-4695', { validUntil: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) } as never);
    const issued = await router.dispatch({ method: 'POST', path: '/api/erp/proposals/prop-gc-4695/public-link', query: { ...HTTP, _origin: 'https://sti-hub.vercel.app', _sessionToken: session }, body: {} });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    const data = (issued.body as { data: { url: string; shortUrl: string; version: number } }).data;
    assert.match(data.shortUrl, /^https:\/\/sti-hub\.vercel\.app\/p\/[A-Za-z0-9]{10}$/);
    assert.ok(data.url.includes('#t='), 'formato #t= antigo continua emitido');
    const code = data.shortUrl.split('/p/')[1];
    // o codigo em claro nao e gravado (so o HMAC)
    assert.equal(JSON.stringify(repo.getState()).includes(code), false);
    // outra instancia com o mesmo estado persistido (Vercel) resolve o codigo
    const router2 = new CrmApiRouter(createInMemoryRepository(structuredClone(repo.getState())));
    const anon = await router2.dispatch({ method: 'GET', path: `/api/p/${code}`, query: { ...HTTP, _clientIp: '198.51.100.90' } });
    assert.equal(anon.status, 200, JSON.stringify(anon.body));
    const body = anon.body as { data: { code: string }; proposalId: string; token: string };
    assert.equal(body.proposalId, 'prop-gc-4695');
    assert.equal(body.token, data.url.split('#t=')[1], 'token reassinado = token original');
    const viaToken = await router2.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-gc-4695', query: { ...HTTP, _clientIp: '198.51.100.91', proposalLinkToken: body.token } });
    assert.equal(viaToken.status, 200);
    // anti-enumeracao: codigo inexistente/malformado => 404 generico
    for (const bad of ['AAAAAAAAAA', 'abc', `${code}x`, '../../x']) {
      const r = await router2.dispatch({ method: 'GET', path: `/api/p/${encodeURIComponent(bad)}`, query: { ...HTTP, _clientIp: '198.51.100.92' } });
      assert.equal(r.status, 404, bad);
    }
    // revogacao
    const st = repo.getState().erp!.proposalShortLinks!;
    st[st.length - 1].revokedAt = new Date().toISOString();
    const revoked = await router.dispatch({ method: 'GET', path: `/api/p/${code}`, query: { ...HTTP, _clientIp: '198.51.100.93' } });
    assert.equal(revoked.status, 404);
    st[st.length - 1].revokedAt = null;
    // nova versao comercial => o mesmo slug abre e devolve o titulo novo
    repo.updateProposal('prop-gc-4695', { title: 'Revisao t33u' } as never);
    const revised = await router.dispatch({ method: 'GET', path: `/api/p/${code}`, query: { ...HTTP, _clientIp: '198.51.100.94' } });
    assert.equal(revised.status, 200);
    assert.equal((revised.body as { data: { title: string } }).data.title, 'Revisao t33u');
    // expiracao
    const issued2 = await router.dispatch({ method: 'POST', path: '/api/erp/proposals/prop-gc-4695/public-link', query: { ...HTTP, _origin: 'https://sti-hub.vercel.app', _sessionToken: session }, body: {} });
    const code2 = (issued2.body as { data: { shortUrl: string } }).data.shortUrl.split('/p/')[1];
    const st2 = repo.getState().erp!.proposalShortLinks!;
    st2[st2.length - 1].exp = Date.now() - 1000;
    const expired = await router.dispatch({ method: 'GET', path: `/api/p/${code2}`, query: { ...HTTP, _clientIp: '198.51.100.95' } });
    assert.equal(expired.status, 404);
  });

  it('t33u: /p/<codigo> e GET /api/p/<codigo> sao publicos; botoes "Copiar link do cliente" visiveis', async () => {
    const { isPublicStiHubPath } = await import('../src/middleware');
    assert.equal(isPublicStiHubPath('/p/AbCdEf1234', 'GET'), true);
    assert.equal(isPublicStiHubPath('/api/p/AbCdEf1234', 'GET'), true);
    assert.equal(isPublicStiHubPath('/api/p/AbCdEf1234', 'POST'), false);
    assert.equal(isPublicStiHubPath('/api/p/a/b', 'GET'), false);
    const tab = fs.readFileSync(path.join(process.cwd(), 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');
    assert.ok(tab.includes('data-testid="menu-copy-client-link"'));
    assert.ok(tab.includes('data-testid="menu-share-email"'));
    assert.ok(tab.includes('data-testid="status-modal-copy-client-link"'));
    const pageSrc = fs.readFileSync(path.join(process.cwd(), 'src/app/proposta/[id]/page.tsx'), 'utf8');
    assert.ok(pageSrc.includes('data-testid="copy-client-link"'));
    assert.ok(pageSrc.includes('Entre no STI-hub para gerar o link do cliente'));
  });

  it('proposta publica: Pilares sempre abertos (sem <details>) e codigo exibido no padrao GC', () => {
    const pageSrc = fs.readFileSync(path.join(process.cwd(), 'src/app/proposta/[id]/page.tsx'), 'utf8');
    assert.equal(pageSrc.includes('<details'), false);
    assert.equal(pageSrc.includes('Ver Pilares'), false);
    assert.ok(pageSrc.includes('Pilares de Soluções &amp; Arquitetura'));
    assert.equal(pageSrc.includes('Pilares de Soluções &amp; Arquitetura Seta Telecom'), false);
    assert.ok(pageSrc.includes('data-testid="proposal-pillars"'));
    assert.ok(pageSrc.includes('{displayCode}'));
    assert.equal(pageSrc.includes('{proposal.code}'), false);
  });
});

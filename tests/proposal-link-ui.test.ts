// ============================================================================
// STI-hub — Funcionais da checagem final da v4 (01/11/2026):
//  - a tela nao gera mais links `?d=` como "link publico" (URL interna sem a proposta embutida);
//  - o compositor de e-mail bloqueia o envio (com erro) se a emissao do link assinado falhar;
//  - o link assinado usa STI_HUB_PUBLIC_ORIGIN (validado) quando existir.
// Sem rede: funcoes puras, leitura das fontes e router em memoria.
// ============================================================================
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from './helpers/legacy-proposal-fixtures';
import { CrmApiRouter } from '../src/api/router';
import { buildInternalProposalUrl, buildPublicProposalUrl } from '../src/app/lib/proposal-share';
import { proposalEmailLinkGate } from '../src/app/lib/proposal-link-client';
import { resolveProposalLinkOrigin } from '../src/app/lib/proposal-link';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const savedOrigin = process.env.STI_HUB_PUBLIC_ORIGIN;
afterEach(() => {
  if (savedOrigin === undefined) delete process.env.STI_HUB_PUBLIC_ORIGIN;
  else process.env.STI_HUB_PUBLIC_ORIGIN = savedOrigin;
});

describe('Checagem final v4: links ?d= fora da tela', () => {
  it('buildInternalProposalUrl/buildPublicProposalUrl nao embutem a proposta (sem ?d=, sem dados do cliente)', () => {
    const prop = { id: 'prop-fixture-001', code: 'PROP-2026-001', companyName: 'TOTVS S.A.', companyCnpj: '53.113.791/0001-22', contactEmail: 'cliente@exemplo.invalid', items: [{ unitPrice: 9500 }] };
    for (const url of [
      buildInternalProposalUrl(prop as never, { origin: 'https://sti-hub.vercel.app' }),
      buildPublicProposalUrl(prop as never, { origin: 'https://sti-hub.vercel.app' }),
    ]) {
      assert.equal(url, 'https://sti-hub.vercel.app/proposta/prop-fixture-001');
      assert.doesNotMatch(url, /[?&]d=|TOTVS|53\.113|cliente@|9500/);
    }
    assert.equal(buildInternalProposalUrl(prop as never, { origin: 'https://h', autoPrint: true }), 'https://h/proposta/prop-fixture-001?print=1');
  });

  it('telas (Negocios e ERP) nao montam ?d= nem chamam o link interno de "publico" para o cliente', () => {
    for (const f of ['src/app/components/DealsKanbanTab.tsx', 'src/app/components/ErpGestaoClickTab.tsx']) {
      const s = src(f);
      assert.doesNotMatch(s, /encodeProposalToQueryParam|searchParams\.set\(['"]d['"]|[?&]d=\$\{/, f);
      assert.doesNotMatch(s, /buildPublicProposalUrl\(/, f);
      assert.doesNotMatch(s, /Link P[uú]blico|link p[uú]blico|Acesso P[uú]blico|LINK P[UÚ]BLICO/, f);
    }
    // e-Assinatura do menu abre o link ASSINADO (nao a URL interna)
    assert.match(src('src/app/components/ErpGestaoClickTab.tsx'), /target === "E_ASSINATURA"\) \{[\s\S]{0,400}openWithSignedProposalLink\(prop\.id/);
  });
});

describe('Checagem final v4: compositor de e-mail com o link assinado', () => {
  const unsigned = 'https://sti-hub.vercel.app/proposta/prop-fixture-001';
  const signed = 'https://sti-hub.vercel.app/proposta/prop-fixture-001#t=eyJ2IjoxfQ.sig';
  it('falha na emissao (403/503/409/rede) ou emissao pendente => envio bloqueado com erro', () => {
    for (const error of ['Seu perfil não tem permissão para gerar o link desta proposta.', 'STI_HUB_PROPOSAL_LINK_SECRET ausente', 'A validade desta proposta já venceu.', 'Falha de conexão']) {
      const g = proposalEmailLinkGate({ isProposal: true, state: { status: 'error', error }, body: `Link: ${unsigned}`, unsignedUrl: unsigned });
      assert.equal(g.ok, false);
      if (!g.ok) {
        assert.match(g.error, /não foi enviado/);
        assert.ok(g.error.includes(error));
      }
    }
    assert.equal(proposalEmailLinkGate({ isProposal: true, state: { status: 'loading' }, body: unsigned, unsignedUrl: unsigned }).ok, false);
  });
  it('link assinado ok => libera; corpo ainda com o link sem token => bloqueia; outros documentos nao exigem', () => {
    assert.equal(proposalEmailLinkGate({ isProposal: true, state: { status: 'ok', url: signed }, body: `Link: ${signed}`, unsignedUrl: unsigned }).ok, true);
    assert.equal(proposalEmailLinkGate({ isProposal: true, state: { status: 'ok', url: signed }, body: `Link: ${unsigned} (antigo)`, unsignedUrl: unsigned }).ok, false);
    assert.equal(proposalEmailLinkGate({ isProposal: false, state: { status: 'error', error: 'x' }, body: unsigned, unsignedUrl: unsigned }).ok, true);
    assert.equal(proposalEmailLinkGate({ isProposal: true, state: { status: 'not-needed' }, body: signed }).ok, true);
  });
  it('o modal usa o bloqueio no envio, no copiar e no abrir no app de e-mail (nao manda o link sem token em silencio)', () => {
    const s = src('src/app/components/ClientEmailComposerModal.tsx');
    assert.match(s, /if \(!linkGate\.ok\) \{\s*setGateError\(linkGate\.error\);\s*return;\s*\}\s*setSending\(true\)/);
    assert.match(s, /disabled=\{sending \|\| !linkGate\.ok\}/);
    assert.match(s, /href=\{linkGate\.ok \? mailtoHref : undefined\}/);
    assert.match(s, /role="alert"/);
    assert.doesNotMatch(s, /if \(!active \|\| !r\.ok\) return;/, 'a falha da emissao nao pode ser ignorada');
  });
});

describe('Checagem final v4: STI_HUB_PUBLIC_ORIGIN no link assinado', () => {
  it('resolveProposalLinkOrigin: env valido (so a origem) > origem da requisicao > padrao; env invalido e ignorado', () => {
    delete process.env.STI_HUB_PUBLIC_ORIGIN;
    assert.equal(resolveProposalLinkOrigin('https://preview.exemplo.invalid'), 'https://preview.exemplo.invalid');
    assert.equal(resolveProposalLinkOrigin(undefined), 'https://sti-hub.vercel.app');
    process.env.STI_HUB_PUBLIC_ORIGIN = ' https://sti-hub.setatelecom.com.br/qualquer/caminho?x=1#y ';
    assert.equal(resolveProposalLinkOrigin('https://preview.exemplo.invalid'), 'https://sti-hub.setatelecom.com.br');
    for (const bad of ['javascript:alert(1)', 'sti-hub.vercel.app', 'https://user:pw@evil.example', 'ftp://x']) {
      process.env.STI_HUB_PUBLIC_ORIGIN = bad;
      assert.equal(resolveProposalLinkOrigin('https://req.exemplo.invalid'), 'https://req.exemplo.invalid', bad);
    }
  });

  it('POST /public-link monta o link com STI_HUB_PUBLIC_ORIGIN (ignora o host da requisicao) e cai para a origem da requisicao sem o env', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const rec = repo.findRbacUserRecord('usr-seta-01', '')!;
    const session = signStiHubSessionToken({ uid: rec.id, email: rec.email, name: rec.name, roleId: rec.roleId, scope: rec.scope, enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true }, mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000 } as Parameters<typeof signStiHubSessionToken>[0]);
    // prop-fixture-002 (EM_NEGOCIACAO): a 001 do seed e CONVERTIDA_CONTRATO => 409 pelo D3.
    const issue = () => router.dispatch({ method: 'POST', path: '/api/erp/proposals/prop-fixture-002/public-link', query: { _fromHttpBridge: '1', _clientIp: '198.51.100.31', _origin: 'https://preview-xyz.vercel.app', _sessionToken: session }, body: {} });
    process.env.STI_HUB_PUBLIC_ORIGIN = 'https://sti-hub.setatelecom.com.br/';
    let r = await issue();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match((r.body as { data: { url: string } }).data.url, /^https:\/\/sti-hub\.setatelecom\.com\.br\/proposta\/prop-fixture-002#t=/);
    delete process.env.STI_HUB_PUBLIC_ORIGIN;
    r = await issue();
    assert.equal(r.status, 200);
    assert.match((r.body as { data: { url: string } }).data.url, /^https:\/\/preview-xyz\.vercel\.app\/proposta\/prop-fixture-002#t=/);
  });
});

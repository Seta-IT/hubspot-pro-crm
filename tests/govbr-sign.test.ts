import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { createInMemoryRepository } from './helpers/legacy-proposal-fixtures';
import { toPublicProposalDto } from '../src/app/lib/proposal-public-dto';
import { isPublicStiHubPath } from '../src/middleware';
import {
  buildGovBrAuthorizeUrl,
  exchangeGovBrCode,
  fetchGovBrCertificate,
  govBrOptionLabel,
  issueGovBrResult,
  issueGovBrState,
  parseGovBrCertificateIdentity,
  proposalSignaturePdf,
  readGovBrResult,
  readGovBrSignConfig,
  readGovBrState,
  signGovBrPkcs7,
  GOVBR_OAUTH_SCOPE,
} from '../src/app/lib/govbr-sign';

const secret = 'govbr-test-secret-not-a-real-credential';
const env = {
  GOVBR_SIGN_CLIENT_ID: 'client-id',
  GOVBR_SIGN_CLIENT_SECRET: secret,
  GOVBR_SIGN_ENV: 'staging',
  GOVBR_SIGN_REDIRECT_URI: 'https://sti-hub.vercel.app/api/govbr/sign/callback',
};

describe('Assinatura Gov.br', () => {
  it('sem as quatro variáveis a integração fica desligada e o rótulo é aceite eletrônico', () => {
    assert.equal(readGovBrSignConfig({}), null);
    assert.equal(readGovBrSignConfig({ ...env, GOVBR_SIGN_ENV: 'local' }), null);
    assert.equal(govBrOptionLabel(false), 'Aceite eletrônico');
    assert.equal(govBrOptionLabel(true), 'Assinatura Eletrônica Gov.br (ITI)');
  });

  it('o state fica ligado ao token do link e rejeita adulteração', () => {
    const config = readGovBrSignConfig(env);
    assert.ok(config);
    const issued = issueGovBrState({
      proposalId: 'prop-4712',
      boundToken: 'link-token-da-proposta',
      role: 'Diretor',
      returnPath: '/p/AbCdEf1234',
      secret,
      nonce: 'nonce-fixo',
    });
    const claims = readGovBrState(issued.state, secret);
    assert.equal(claims?.pid, 'prop-4712');
    assert.equal(claims?.nonce, 'nonce-fixo');
    assert.equal(claims?.returnPath, '/p/AbCdEf1234');
    assert.equal(readGovBrState(issued.state, 'outro-segredo'), null);
    assert.equal(readGovBrState(`${issued.state}x`, secret), null);
    const url = buildGovBrAuthorizeUrl(config!, issued.state, issued.nonce);
    assert.match(url, /^https:\/\/cas\.staging\.iti\.br\/oauth2\.0\/authorize\?/);
    assert.match(url, new RegExp(`scope=${GOVBR_OAUTH_SCOPE}`));
    assert.doesNotMatch(url, /client_secret|access_token/);
  });

  it('troca o code e assina o hash no endpoint PKCS7, sem vazar o token', async () => {
    const config = readGovBrSignConfig(env)!;
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
      seen.push(`${url}|${init?.body || ''}|${init?.headers?.Authorization || ''}`);
      if (String(url).includes('/oauth2.0/token')) {
        return { ok: true, json: async () => ({ access_token: 'AT-teste', token_type: 'bearer' }) };
      }
      if (String(url).endsWith('/certificadoPublico')) {
        const body = Buffer.from('CN=MARIA SILVA:52998224725', 'latin1').toString('base64');
        return { ok: true, text: async () => `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n` };
      }
      return { ok: true, arrayBuffer: async () => Buffer.from('pkcs7-bytes') };
    }) as unknown as typeof fetch;
    const access = await exchangeGovBrCode(config, 'code-opaco', fetchImpl);
    assert.equal(access, 'AT-teste');
    const pem = await fetchGovBrCertificate(config, access, fetchImpl);
    assert.deepEqual(parseGovBrCertificateIdentity(pem), { name: 'MARIA SILVA', cpf: '52998224725' });
    const pkcs7 = await signGovBrPkcs7(config, access, 'aGFzaA==', fetchImpl);
    assert.equal(Buffer.from(pkcs7, 'base64').toString(), 'pkcs7-bytes');
    assert.match(seen[0], /cas\.staging\.iti\.br\/oauth2\.0\/token/);
    assert.match(seen[0], /grant_type=authorization_code/);
    assert.match(seen[2], /assinatura-api\.staging\.iti\.br\/externo\/v2\/assinarPKCS7/);
    assert.match(seen[2], /hashBase64/);
    assert.match(seen[2], /Bearer AT-teste/);
    assert.doesNotMatch(seen.join('\n'), /console|GOVBR_SIGN_CLIENT_SECRET/);
    const round = issueGovBrResult({ proposalId: 'prop-4712', name: 'MARIA SILVA', cpf: '52998224725', secret });
    assert.equal(readGovBrResult(round, secret)?.name, 'MARIA SILVA');
  });

  it('o PDF assinado não contém internalNotes e a gravação não gera contrato', () => {
    const pdf = Buffer.from(proposalSignaturePdf({
      id: 'prop-4712',
      code: '4712',
      companyName: 'Via Itália',
      title: 'Locação',
      monthly: 4490,
      months: 36,
      items: [{ description: 'FortiGate', quantity: 2, unitPrice: 780 }],
      internalNotes: 'NOTA_INTERNA_SECRETA',
    })).toString('latin1');
    assert.match(pdf, /Via It.lia/);
    assert.doesNotMatch(pdf, /NOTA_INTERNA_SECRETA/);
    const repo = createInMemoryRepository();
    const created = repo.createProposal({
      title: 'Locação Via Itália',
      companyName: 'Via Itália',
      companyCnpj: '07.638.845/0001-56',
      status: 'ENVIADA',
      contractMonths: 36,
      monthlyRecurringTotal: 4490,
      items: [],
    } as never);
    const before = repo.listRentalContracts().length;
    const saved = repo.recordGovBrSignature(created.id, {
      signerName: 'MARIA SILVA',
      signerCpf: '52998224725',
      signerRole: 'Diretora',
      signatureHashSha256: 'abc',
      pkcs7Base64: 'cGtjczc=',
    });
    assert.equal(saved?.status, 'ENVIADA');
    assert.equal(saved?.digitalSignature?.govBrSigned, true);
    assert.equal(repo.listRentalContracts().length, before);
    const dto = JSON.stringify(toPublicProposalDto(saved!));
    assert.match(dto, /Assinado|Gov\.br|govBrSigned":true/);
    assert.doesNotMatch(dto, /pkcs7Base64|NOTA_INTERNA|internalNotes/);
    assert.equal(isPublicStiHubPath('/api/govbr/sign/callback', 'GET'), true);
    assert.equal(isPublicStiHubPath('/api/internal/govbr-signature/prop-1', 'POST'), false);
  });

  it('a rota HTTP de gravação não aceita PKCS7 sem o contexto interno', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const denied = await router.dispatch({
      method: 'POST',
      path: '/api/internal/govbr-signature/prop-x',
      query: { _fromHttpBridge: '1' },
      body: { pkcs7Base64: 'cGtjczc=', signerName: 'A', signerCpf: '52998224725', signatureHashSha256: 'h' },
    });
    assert.equal(denied.status, 401);
    assert.equal(JSON.stringify(denied.body).includes('cGtjczc'), false);
    const trusted = await router.dispatch({
      method: 'POST',
      path: '/api/internal/govbr-signature/prop-x',
      context: TRUSTED_INTERNAL_CONTEXT,
      body: {
        pkcs7Base64: 'cGtjczc=',
        signerName: 'MARIA SILVA',
        signerCpf: '52998224725',
        signerRole: 'Diretora',
        signatureHashSha256: 'abc',
      },
    });
    assert.equal(trusted.status, 404);
  });
});

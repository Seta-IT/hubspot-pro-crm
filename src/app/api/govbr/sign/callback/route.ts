import { NextRequest, NextResponse } from 'next/server';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../../../../../api/router';
import {
  exchangeGovBrCode,
  fetchGovBrCertificate,
  issueGovBrResult,
  parseGovBrCertificateIdentity,
  proposalSignatureHashBase64,
  readGovBrSignConfig,
  readGovBrState,
  signGovBrPkcs7,
} from '../../../../lib/govbr-sign';
import { resolveProposalCommercialFigures } from '../../../../lib/proposal-share';
import type { ErpCommercialProposal } from '../../../../../db/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function fail(message: string, status = 400): NextResponse {
  return new NextResponse(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

export async function GET(req: NextRequest) {
  const config = readGovBrSignConfig();
  if (!config) return fail('A assinatura Gov.br não está ativa.', 404);
  const code = String(req.nextUrl.searchParams.get('code') || '').trim();
  const state = String(req.nextUrl.searchParams.get('state') || '');
  const claims = readGovBrState(state, config.clientSecret);
  const nonce = req.cookies.get('govbr_nonce')?.value || '';
  if (!code || !claims || !nonce || nonce !== claims.nonce) {
    return fail('Retorno Gov.br inválido ou expirado.', 400);
  }
  let accessToken = '';
  try {
    accessToken = await exchangeGovBrCode(config, code);
    const pem = await fetchGovBrCertificate(config, accessToken);
    const identity = parseGovBrCertificateIdentity(pem);
    if (!identity) return fail('Não foi possível ler o nome e o CPF do certificado Gov.br.', 422);
    const router = new CrmApiRouter();
    const loaded = await router.dispatch({
      method: 'GET',
      path: `/api/erp/proposals/${encodeURIComponent(claims.pid)}`,
      context: TRUSTED_INTERNAL_CONTEXT,
    });
    const proposal = (loaded.body as { data?: ErpCommercialProposal })?.data;
    if (loaded.status !== 200 || !proposal || proposal.id !== claims.pid) {
      return fail('Proposta não encontrada para assinatura.', 404);
    }
    const figures = resolveProposalCommercialFigures(proposal);
    const hashBase64 = proposalSignatureHashBase64({
      id: proposal.id,
      code: proposal.code,
      companyName: proposal.companyName,
      title: proposal.title,
      monthly: figures.monthly,
      months: figures.months,
      items: (proposal.items || []).map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    });
    const pkcs7Base64 = await signGovBrPkcs7(config, accessToken, hashBase64);
    const saved = await router.dispatch({
      method: 'POST',
      path: `/api/internal/govbr-signature/${encodeURIComponent(proposal.id)}`,
      context: TRUSTED_INTERNAL_CONTEXT,
      body: {
        signerName: identity.name,
        signerCpf: identity.cpf,
        signerRole: claims.role,
        signatureHashSha256: hashBase64,
        pkcs7Base64,
      },
    });
    if (saved.status !== 200) return fail('Não foi possível guardar a assinatura Gov.br.', 502);
    const back = new URL(claims.returnPath, req.nextUrl.origin);
    back.searchParams.set('govbr', '1');
    const res = NextResponse.redirect(back, 302);
    res.cookies.set('govbr_nonce', '', { httpOnly: true, path: '/api/govbr/sign', maxAge: 0 });
    res.cookies.set('govbr_result', issueGovBrResult({
      proposalId: proposal.id,
      name: identity.name,
      cpf: identity.cpf,
      secret: config.clientSecret,
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/govbr/sign/result',
      maxAge: 600,
    });
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('Referrer-Policy', 'no-referrer');
    return res;
  } catch {
    return fail('A assinatura Gov.br não foi concluída. Tente novamente.', 502);
  } finally {
    accessToken = '';
  }
}

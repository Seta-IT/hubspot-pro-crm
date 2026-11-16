import { NextRequest, NextResponse } from 'next/server';
import { verifyStiHubSessionToken } from '../../../../lib/auth';
import { buildGovBrAuthorizeUrl, isSafeReturnPath, issueGovBrState, readGovBrSignConfig } from '../../../../lib/govbr-sign';
import { verifyProposalLinkToken } from '../../../../lib/proposal-link';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

export async function POST(req: NextRequest) {
  const config = readGovBrSignConfig();
  if (!config) {
    return NextResponse.json(
      { error: 'A assinatura Gov.br não está ativa. O aceite eletrônico continua disponível.', code: 'GOVBR_SIGN_DISABLED' },
      { status: 404, headers: NO_STORE }
    );
  }
  const body = (await req.json().catch(() => null)) as { proposalId?: string; signerRole?: string; returnPath?: string } | null;
  const proposalId = String(body?.proposalId || '').trim();
  const returnPath = String(body?.returnPath || '');
  if (!proposalId || !isSafeReturnPath(returnPath)) {
    return NextResponse.json({ error: 'Proposta não identificada.', code: 'GOVBR_SIGN_BAD_REQUEST' }, { status: 400, headers: NO_STORE });
  }
  const linkToken = String(req.headers.get('x-proposal-token') || '').trim();
  const session = req.cookies.get('stihub_session')?.value || '';
  let bound = '';
  if (linkToken) {
    const verified = verifyProposalLinkToken(linkToken, { proposalId });
    if (!verified.valid) {
      return NextResponse.json({ error: 'Link da proposta inválido ou expirado.', code: 'GOVBR_SIGN_LINK' }, { status: 401, headers: NO_STORE });
    }
    bound = linkToken;
  } else if (session && verifyStiHubSessionToken(session).valid) {
    bound = session;
  } else {
    return NextResponse.json(
      { error: 'É preciso estar no link da proposta ou na sessão do STI-hub.', code: 'GOVBR_SIGN_AUTH' },
      { status: 401, headers: NO_STORE }
    );
  }
  const issued = issueGovBrState({
    proposalId,
    boundToken: bound,
    role: String(body?.signerRole || 'Signatário').slice(0, 160),
    returnPath,
    secret: config.clientSecret,
  });
  const res = NextResponse.json(
    { authorizeUrl: buildGovBrAuthorizeUrl(config, issued.state, issued.nonce) },
    { headers: NO_STORE }
  );
  res.cookies.set('govbr_nonce', issued.nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/govbr/sign',
    maxAge: 600,
  });
  return res;
}

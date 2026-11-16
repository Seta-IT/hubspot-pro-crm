import { NextRequest, NextResponse } from 'next/server';
import { readGovBrResult, readGovBrSignConfig } from '../../../../lib/govbr-sign';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const config = readGovBrSignConfig();
  if (!config) return NextResponse.json({ error: 'Assinatura Gov.br inativa.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const raw = req.cookies.get('govbr_result')?.value || '';
  const result = readGovBrResult(raw, config.clientSecret);
  if (!result) return NextResponse.json({ error: 'Nenhuma assinatura Gov.br pendente.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const res = NextResponse.json(
    { proposalId: result.proposalId, signerName: result.name, signerCpf: result.cpf },
    { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }
  );
  res.cookies.set('govbr_result', '', { httpOnly: true, path: '/api/govbr/sign/result', maxAge: 0 });
  return res;
}

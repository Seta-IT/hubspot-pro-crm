// STI-hub — Assistente: /api/assistente/conversas (sessão MFA do usuário; regra em modules/assistente/conversas-api).
import type { NextRequest } from 'next/server';
import { rotaAssistenteApi } from '../../_sessao';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: { slug?: string[] } };
const h = (req: NextRequest, ctx: Ctx) => rotaAssistenteApi(req, 'conversas', ctx.params?.slug);
export const GET = h;
export const POST = h;
export const PATCH = h;
export const PUT = h;
export const DELETE = h;

// ============================================================================
// STI-hub — Assistente: API das conversas, da memória aprendida e das regras de acessórios.
// Rotas finas em src/app/api/assistente/{conversas,memorias,regras}; a regra de negócio fica
// aqui para teste (node --test) com o MemoryAssistenteStore.
//  - Tudo filtrado pelo dono (uid da sessão): ninguém lê, encerra ou apaga conversa de outro.
//  - Apagar (uma ou todas) exige confirmação explícita e vai para a auditoria.
//  - Memória: nunca guarda segredo; Trava Fiscal (um CNPJ por lição).
//  - Regras de acessórios (globais): só perfis de gestão editam.
// ============================================================================
import { z } from 'zod';
import { LIMITES_CONVERSA, sanearItem, type AssistenteStore, type CategoriaAcessorio } from './conversas-store';
import { cnpjsDoTexto, contemSegredo, licaoDeFeedback } from './memoria';
import type { AssistenteUser } from './tools';

export interface ApiReq {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Segmentos depois de /api/assistente/ (ex.: ['conversas', 'conv-1', 'itens']). */
  segs: string[];
  query?: URLSearchParams;
  body?: unknown;
}
export interface ApiRes { status: number; body: Record<string, unknown> }

const ok = (body: Record<string, unknown>, status = 200): ApiRes => ({ status, body });
const erro = (status: number, code: string, error: string): ApiRes => ({ status, body: { error, code } });

/** Perfis que editam a tabela global de compatibilidade de acessórios. */
export const PERFIS_EDITAM_REGRAS = new Set(['SUPER_ADMIN', 'DIRETORIA', 'SALES_MANAGER', 'STOCK_MANAGER']);
export const CONFIRMA_APAGAR_TODAS = 'APAGAR_TODAS';

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const itemSchema = z.object({ id: z.string().regex(ID_RE), item: z.record(z.unknown()) });
const salvarSchema = z.object({ itens: z.array(itemSchema).min(1).max(40) });
const patchConversaSchema = z.object({ titulo: z.string().max(200).optional(), status: z.enum(['aberta', 'encerrada']).optional() }).strict();
const feedbackSchema = z.object({ itemId: z.string().regex(ID_RE), nota: z.enum(['positivo', 'negativo']).nullable(), motivo: z.string().max(LIMITES_CONVERSA.maxMotivo).optional(), pergunta: z.string().max(2000).optional() }).strict();
const patchMemoriaSchema = z.object({ texto: z.string().trim().min(3).max(LIMITES_CONVERSA.maxTextoMemoria).optional(), ativa: z.boolean().optional() }).strict();
const novaMemoriaSchema = z.object({ texto: z.string().trim().min(3).max(LIMITES_CONVERSA.maxTextoMemoria) }).strict();
const PADRAO_RE = /^[A-Za-z0-9*._\- /]{1,60}$/;
const regraSchema = z.object({
  id: z.string().regex(ID_RE).optional(),
  familia: z.string().trim().regex(PADRAO_RE),
  categoria: z.enum(['fonte', 'optico', 'uplink', 'acessorio']),
  padrao: z.string().trim().regex(PADRAO_RE),
  excluir: z.string().trim().regex(PADRAO_RE).nullable().optional(),
  observacao: z.string().trim().max(200).optional(),
  ativa: z.boolean().optional(),
  ordem: z.number().int().min(0).max(9999).optional(),
}).strict();

export async function handleAssistenteApi(req: ApiReq, user: AssistenteUser, store: AssistenteStore): Promise<ApiRes> {
  const [recurso, id, sub] = req.segs;
  const uid = user.uid;
  if (!uid) return erro(401, 'SEM_SESSAO', 'Sessão inválida.');

  // ------------------------------------------------------------- conversas
  if (recurso === 'conversas') {
    if (id && !ID_RE.test(id)) return erro(400, 'ENTRADA_INVALIDA', 'Conversa inválida.');
    if (!id) {
      if (req.method === 'GET') {
        const busca = String(req.query?.get('busca') || '').slice(0, 100);
        return ok({ data: await store.listarConversas(uid, { busca }) });
      }
      if (req.method === 'POST') {
        const titulo = typeof (req.body as any)?.titulo === 'string' ? String((req.body as any).titulo) : undefined;
        return ok({ data: await store.criarConversa(uid, titulo) }, 201);
      }
      if (req.method === 'DELETE') {
        if ((req.body as any)?.confirmar !== CONFIRMA_APAGAR_TODAS) return erro(400, 'CONFIRMACAO_OBRIGATORIA', 'Confirme para apagar todas as suas conversas.');
        const n = await store.apagarTodasConversas(uid);
        await store.auditar({ ownerUid: uid, acao: 'conversas.apagar_todas', alvo: '*', detalhe: `${n} conversa(s) apagada(s) pelo dono` });
        return ok({ apagadas: n });
      }
      return erro(405, 'METODO', 'Método não permitido.');
    }
    if (!sub) {
      if (req.method === 'GET') {
        const c = await store.obterConversa(uid, id);
        return c ? ok({ data: c }) : erro(404, 'NAO_ENCONTRADA', 'Conversa não encontrada.');
      }
      if (req.method === 'PATCH') {
        const p = patchConversaSchema.safeParse(req.body ?? {});
        if (!p.success) return erro(400, 'ENTRADA_INVALIDA', 'Dados inválidos.');
        const c = await store.atualizarConversa(uid, id, p.data);
        if (!c) return erro(404, 'NAO_ENCONTRADA', 'Conversa não encontrada.');
        if (p.data.status) await store.auditar({ ownerUid: uid, acao: p.data.status === 'encerrada' ? 'conversa.encerrar' : 'conversa.reabrir', alvo: id, detalhe: c.titulo });
        return ok({ data: c });
      }
      if (req.method === 'DELETE') {
        // So o dono apaga: o store filtra por owner_uid (conversa de outro = 404, sem vazar que existe).
        const c = await store.obterConversa(uid, id);
        if (!c) return erro(404, 'NAO_ENCONTRADA', 'Conversa não encontrada.');
        if ((req.body as any)?.confirmar !== true) return erro(400, 'CONFIRMACAO_OBRIGATORIA', 'Confirme para apagar a conversa.');
        await store.apagarConversa(uid, id);
        await store.auditar({ ownerUid: uid, acao: 'conversa.apagar', alvo: id, detalhe: `${c.titulo} (${c.mensagens} itens)` });
        return ok({ apagada: true });
      }
      return erro(405, 'METODO', 'Método não permitido.');
    }
    if (sub === 'itens' && req.method === 'POST') {
      const p = salvarSchema.safeParse(req.body);
      if (!p.success) return erro(400, 'ENTRADA_INVALIDA', 'Itens inválidos.');
      const atual = await store.obterConversa(uid, id);
      if (!atual) return erro(404, 'NAO_ENCONTRADA', 'Conversa não encontrada.');
      if (atual.status === 'encerrada') return erro(409, 'CONVERSA_ENCERRADA', 'Conversa encerrada: reabra para continuar.');
      const itens = p.data.itens.map((i) => ({ id: i.id, item: sanearItem(i.item) })).filter((i): i is { id: string; item: Record<string, unknown> } => !!i.item);
      const c = await store.salvarItens(uid, id, itens);
      return c ? ok({ data: c }) : erro(404, 'NAO_ENCONTRADA', 'Conversa não encontrada.');
    }
    if (sub === 'feedback' && req.method === 'POST') {
      const p = feedbackSchema.safeParse(req.body);
      if (!p.success) return erro(400, 'ENTRADA_INVALIDA', 'Feedback inválido.');
      const motivo = (p.data.motivo || '').trim();
      if (motivo && contemSegredo(motivo)) return erro(400, 'SEGREDO', 'Não guardo senhas, tokens ou chaves. Reescreva o motivo sem esses dados.');
      const it = await store.registrarFeedback(uid, id, p.data.itemId, p.data.nota, motivo || null);
      if (!it) return erro(404, 'NAO_ENCONTRADA', 'Mensagem não encontrada.');
      // Nao gostei (ou gostei) com motivo vira lição para as próximas conversas.
      let memoria: unknown = null;
      if (p.data.nota && motivo) {
        const l = licaoDeFeedback(motivo, p.data.pergunta || '');
        if (l && l.ok) {
          const texto = p.data.nota === 'positivo' ? l.texto.replace(/^Resposta reprovada/, 'Resposta aprovada') : l.texto;
          memoria = await store.criarMemoria(uid, { tipo: 'feedback', texto, cnpj: l.cnpj, origemConversaId: id });
        }
      }
      return ok({ data: it, memoria });
    }
    return erro(404, 'NAO_ENCONTRADO', 'Não encontrado.');
  }

  // ------------------------------------------------------------- memorias
  if (recurso === 'memorias') {
    if (id && !ID_RE.test(id)) return erro(400, 'ENTRADA_INVALIDA', 'Item inválido.');
    if (!id && req.method === 'GET') return ok({ data: await store.listarMemorias(uid) });
    if (!id && req.method === 'POST') {
      const p = novaMemoriaSchema.safeParse(req.body);
      if (!p.success) return erro(400, 'ENTRADA_INVALIDA', 'Texto inválido.');
      if (contemSegredo(p.data.texto)) return erro(400, 'SEGREDO', 'Não guardo senhas, tokens, chaves ou cartões.');
      const cnpjs = cnpjsDoTexto(p.data.texto);
      if (cnpjs.length > 1) return erro(400, 'TRAVA_FISCAL', 'Trava Fiscal: uma lição não pode misturar CNPJs distintos.');
      return ok({ data: await store.criarMemoria(uid, { tipo: 'preferencia', texto: p.data.texto, cnpj: cnpjs[0] || null }) }, 201);
    }
    if (id && req.method === 'PATCH') {
      const p = patchMemoriaSchema.safeParse(req.body ?? {});
      if (!p.success) return erro(400, 'ENTRADA_INVALIDA', 'Dados inválidos.');
      if (p.data.texto && contemSegredo(p.data.texto)) return erro(400, 'SEGREDO', 'Não guardo senhas, tokens, chaves ou cartões.');
      if (p.data.texto && cnpjsDoTexto(p.data.texto).length > 1) return erro(400, 'TRAVA_FISCAL', 'Trava Fiscal: uma lição não pode misturar CNPJs distintos.');
      const m = await store.atualizarMemoria(uid, id, p.data);
      return m ? ok({ data: m }) : erro(404, 'NAO_ENCONTRADA', 'Item não encontrado.');
    }
    if (id && req.method === 'DELETE') {
      const apagou = await store.apagarMemoria(uid, id);
      if (!apagou) return erro(404, 'NAO_ENCONTRADA', 'Item não encontrado.');
      await store.auditar({ ownerUid: uid, acao: 'memoria.apagar', alvo: id, detalhe: '' });
      return ok({ apagada: true });
    }
    return erro(405, 'METODO', 'Método não permitido.');
  }

  // ------------------------------------------------------------- regras de acessorios
  if (recurso === 'regras') {
    if (req.method === 'GET') return ok({ data: await store.listarRegras(), podeEditar: PERFIS_EDITAM_REGRAS.has(user.roleId) });
    if (!PERFIS_EDITAM_REGRAS.has(user.roleId)) return erro(403, 'SEM_PERMISSAO', 'Só gestores editam as regras de acessórios.');
    if (req.method === 'POST' || req.method === 'PUT') {
      const p = regraSchema.safeParse({ ...(req.body as any), ...(id ? { id } : {}) });
      if (!p.success) return erro(400, 'ENTRADA_INVALIDA', 'Regra inválida (use part numbers com *, ex.: WS-C3850-*).');
      const r = await store.salvarRegra({
        ...(p.data.id ? { id: p.data.id } : {}),
        familia: p.data.familia.toUpperCase(),
        categoria: p.data.categoria as CategoriaAcessorio,
        padrao: p.data.padrao.toUpperCase(),
        excluir: p.data.excluir ? p.data.excluir.toUpperCase() : null,
        observacao: p.data.observacao || '',
        ativa: p.data.ativa ?? true,
        ordem: p.data.ordem ?? 50,
      });
      await store.auditar({ ownerUid: uid, acao: 'regra.salvar', alvo: r.id, detalhe: `${r.familia} -> ${r.padrao} (${r.categoria})` });
      return ok({ data: r }, p.data.id ? 200 : 201);
    }
    if (req.method === 'DELETE' && id && ID_RE.test(id)) {
      const apagou = await store.apagarRegra(id);
      if (!apagou) return erro(404, 'NAO_ENCONTRADA', 'Regra não encontrada.');
      await store.auditar({ ownerUid: uid, acao: 'regra.apagar', alvo: id, detalhe: '' });
      return ok({ apagada: true });
    }
    return erro(405, 'METODO', 'Método não permitido.');
  }
  return erro(404, 'NAO_ENCONTRADO', 'Não encontrado.');
}

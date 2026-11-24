// ============================================================================
// STI-hub — Assistente robusto: roteamento de intencao, busca universal por qualquer
// identificador, base de conhecimento, datas relativas e leituras novas (sem rede).
// Caso real (t164u): "Proposta Comercial #prop-1795473263142-d5b63b não localizada, por
// que essa proposta não abre?" => acha o orçamento 4725 e explica o link sem assinatura.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rotearPergunta, periodoRelativo, termoDeBusca } from '../src/modules/assistente/roteador';
import { extrairIdentificadores, normalizarPergunta, corrigirPalavra, cpfValido, cnpjValido, type TipoIdentificador } from '../src/modules/assistente/identificadores';
import { BASE_CONHECIMENTO, buscarConhecimento, responderConhecimento, resumoConhecimentoParaPrompt } from '../src/modules/assistente/conhecimento';
import { getTool, statusCombina, toolDefinitionsFor, type ApiCaller, type ApiCallRequest, type AssistenteUser } from '../src/modules/assistente/tools';
import { handleChat, handleExecute, type AssistenteDeps, type AssistenteAuditEntry } from '../src/modules/assistente/service';
import { isAllowedAssistenteRoute } from '../src/modules/assistente/api-caller';
import type { LlmClient } from '../src/modules/assistente/omniroute-client';

const AGORA = Date.parse('2026-11-24T15:00:00-03:00');
const SECRET = 'segredo-de-teste-assistente-robusto-0123456789';
const ALL: AssistenteUser = { uid: 'usr-ana', email: 'ana@seta.test', name: 'Ana', roleId: 'SUPER_ADMIN', moduleAccess: { crm: true, erp: true, chamados: true } };
const ERP_ONLY: AssistenteUser = { ...ALL, uid: 'usr-eva', moduleAccess: { crm: false, erp: true, chamados: false } };
const CRM_ONLY: AssistenteUser = { ...ALL, uid: 'usr-bia', moduleAccess: { crm: true, erp: false, chamados: false } };

function fakeApi(routes: Record<string, (r: ApiCallRequest) => { status: number; body: any }>) {
  const calls: ApiCallRequest[] = [];
  const api: ApiCaller = async (r) => {
    calls.push(r);
    const key = `${r.method} ${r.path.split('?')[0]}`;
    const h = routes[key];
    return h ? h(r) : { status: 404, body: { error: 'nao encontrado' } };
  };
  return { api, calls };
}

function llmQueNaoDeveSerChamado(): LlmClient & { calls: number } {
  const o = {
    calls: 0,
    async complete() {
      o.calls += 1;
      return { text: 'resposta do modelo', toolCalls: [], model: 'teste' };
    },
  };
  return o;
}

function deps(over: Partial<AssistenteDeps> = {}): AssistenteDeps & { audits: AssistenteAuditEntry[] } {
  const audits: AssistenteAuditEntry[] = [];
  const nonces = new Set<string>();
  return {
    llm: llmQueNaoDeveSerChamado(),
    api: fakeApi({}).api,
    user: ALL,
    secret: SECRET,
    sid: 'sessao-1',
    now: () => AGORA,
    async rateLimit() {
      return true;
    },
    async consumeNonce(n) {
      if (nonces.has(n)) return false;
      nonces.add(n);
      return true;
    },
    async audit(e) {
      audits.push(e);
    },
    audits,
    ...over,
  } as AssistenteDeps & { audits: AssistenteAuditEntry[] };
}

// ---------------------------------------------------------------------------
// Dados de exemplo
// ---------------------------------------------------------------------------
const PROP_4725 = {
  id: 'prop-1795473263142-d5b63b',
  code: '4725',
  title: 'Locação de servidor',
  companyName: 'Condomínio do Parangaba',
  companyCnpj: '11.222.333/0001-81',
  status: 'ENVIADA',
  budgetType: 'LOCACAO',
  contractMonths: 36,
  monthlyRecurringTotal: 2350,
  totalContractValue: 84600,
  validUntil: '2099-12-31',
  createdAt: '2026-11-23T22:34:00.000Z',
  items: [{ description: 'Servidor Dell R640', quantity: 1, unitPrice: 2350 }],
};
const PROP_4709 = {
  id: 'prop-4709',
  code: '4709',
  companyName: 'Dafiti Group',
  status: 'ENVIADA',
  budgetType: 'SERVICOS',
  contractMonths: 1,
  totalContractValue: 18600,
  validUntil: '2020-01-10',
  createdAt: '2026-10-05T12:00:00.000Z',
  items: [],
};
const CONTRATOS = [
  { id: 'c1', contractNumber: 'LOC-2026-101', companyName: 'Alfa Ltda', companyCnpj: '11.222.333/0001-81', status: 'ATIVO', monthlyValue: 1000, startDate: '2026-01-10', endDate: '2028-01-09', contractMonths: 24, readjustmentIndex: 'IGP-M', lastReadjustmentDate: '2026-06-01', lastReadjustmentPercent: 4.2 },
  { id: 'c2', contractNumber: 'LOC-2025-090', companyName: 'Beta SA', status: 'ENCERRADO', monthlyValue: 500, startDate: '2025-05-01', endDate: '2026-04-30', readjustmentIndex: 'IPCA' },
];
const FATURAS = [
  { id: 'f1', documentNumber: 'FAT-1234', documentType: 'FATURA_LOCACAO', companyName: 'Alfa Ltda', companyCnpj: '11.222.333/0001-81', status: 'EMITIDA', grossAmount: 1000, issueDate: '2026-09-01', dueDate: '2026-09-10' },
  { id: 'f2', documentNumber: '4567', documentType: 'NFSE_SERVICO', companyName: 'Beta SA', status: 'PAGA', grossAmount: 300, issueDate: '2026-10-02', dueDate: '2026-10-12', verificationCodeOrKey: '35191114806925000132550010000012341000012345' },
  { id: 'f3', documentNumber: 'FAT-2000', documentType: 'FATURA_LOCACAO', companyName: 'Gama', status: 'EMITIDA', grossAmount: 50, issueDate: '2026-11-01', dueDate: '2099-01-01' },
];
const OVERVIEW = {
  serviceOrders: [{ id: 'os-1', code: '1203', companyName: 'Alfa Ltda', description: 'Troca de fonte', status: 'Em aberto', totalAmount: 0, entryDate: '20/11/2026' }],
  suppliers: [{ id: 's1', name: 'Dell Computadores', cnpj: '72.381.189/0001-10', email: 'vendas@dell.test', phone: '(11) 3333-4444', active: true }],
  salesOrders: [{ id: 'v1', code: '880', companyName: 'Gama', status: 'Concluída', totalAmount: 99, date: '2026-11-23' }],
};
const TICKETS = [{ id: 't1', key: 'SETA-123', subject: 'Impressora parada', status: 'OPEN', priority: 'HIGH', createdAt: '2026-11-20T10:00:00Z', requesterEmail: 'joao@alfa.test', company: { name: 'Alfa Ltda' } }];
const COMPANIES = [
  { id: 'co-1', name: 'Alfa Ltda', cnpj: '11.222.333/0001-81', phone: '(85) 99999-8888', email: 'financeiro@alfa.test' },
  { id: 'co-2', name: 'Condomínio do Parangaba', cnpj: '22.333.444/0001-05' },
];
const CONTATOS = [{ id: 'ct1', firstName: 'João', lastName: 'Silva', email: 'joao@alfa.test', phone: '(85) 98888-7777', companyName: 'Alfa Ltda' }];
const CATALOGO = [
  { id: 'p1', gestaoClickCode: 'R640', name: 'Servidor Dell R640', stockAvailable: 0, stockRentedInClients: 3, monthlyRentalPrice: 2350, saleOrSetupPrice: 0, isActive: true },
  { id: 'p2', gestaoClickCode: 'SW24', name: 'Switch 24 portas', stockAvailable: 5, minStock: 10, stockRentedInClients: 1, monthlyRentalPrice: 150, saleOrSetupPrice: 1200, isActive: true },
];

function apiCompleta(over: Record<string, (r: ApiCallRequest) => { status: number; body: any }> = {}) {
  const props: any[] = [PROP_4725, PROP_4709];
  return fakeApi({
    'GET /api/erp/proposals': (r) => {
      const q = new URLSearchParams(r.path.split('?')[1] || '').get('q') || '';
      const qq = q.toLowerCase();
      const d = q.replace(/\D+/g, '');
      const data = q ? props.filter((p: any) => `${p.id} ${p.code} ${p.companyName} ${p.title || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(qq) || (d.length >= 2 && `${p.code}${String(p.companyCnpj || '').replace(/\D+/g, '')}`.includes(d))) : props;
      return { status: 200, body: { data, total: data.length } };
    },
    'GET /api/erp/proposals/prop-1795473263142-d5b63b': () => ({ status: 200, body: { data: PROP_4725 } }),
    'GET /api/erp/proposals/prop-4709': () => ({ status: 200, body: { data: PROP_4709 } }),
    'GET /api/erp/contracts': () => ({ status: 200, body: { data: CONTRATOS } }),
    'GET /api/erp/invoices': () => ({ status: 200, body: { data: FATURAS } }),
    'GET /api/erp/fiscal-documents': () => ({ status: 200, body: { data: FATURAS } }),
    'GET /api/erp/overview': () => ({ status: 200, body: { data: OVERVIEW } }),
    'GET /api/tickets': () => ({ status: 200, body: { data: TICKETS } }),
    'GET /api/companies': () => ({ status: 200, body: { data: COMPANIES } }),
    'GET /api/contacts': () => ({ status: 200, body: { data: CONTATOS } }),
    'GET /api/erp/catalog': () => ({ status: 200, body: { data: CATALOGO } }),
    ...over,
  });
}

// ---------------------------------------------------------------------------
// 1) Roteamento: pergunta => ferramenta e argumentos (ou resposta da base, ou modelo)
// ---------------------------------------------------------------------------
type Esperado = { f: string; args?: Record<string, unknown> } | { texto: string } | null;
const R = (f: string, args?: Record<string, unknown>): Esperado => ({ f, args });
const KB = (id: string): Esperado => ({ texto: id });
const LLM: Esperado = null;

const CASOS_ROTEAMENTO: Array<[string, Esperado]> = [
  // caso real
  ['Proposta Comercial #prop-1795473263142-d5b63b não localizada, por que essa proposta não abre?', R('buscar', { termo: 'prop-1795473263142-d5b63b', contexto: 'nao_abre' })],
  ['por que a prop-1795473263142-d5b63b não abre', R('buscar', { termo: 'prop-1795473263142-d5b63b', contexto: 'nao_abre' })],
  ['prop-1795473263142-d5b63b', R('buscar', { termo: 'prop-1795473263142-d5b63b' })],
  ['PROP-1795473263142-D5B63B', R('buscar', { termo: 'prop-1795473263142-d5b63b' })],
  ['prop-gc-4696', R('buscar', { termo: 'prop-gc-4696' })],
  // links colados
  ['https://sti-hub.setatelecom.com.br/proposta/prop-1795473263142-d5b63b', R('buscar', { termo: '/proposta/prop-1795473263142-d5b63b', contexto: 'nao_abre' })],
  ['https://sti-hub.vercel.app/proposta/prop-1795473263142-d5b63b#t=eyJhbGciOiJIUzI1NiJ9abcdefghijklmnop', R('buscar', { termo: '/proposta/prop-1795473263142-d5b63b', link_com_assinatura: true })],
  ['https://sti-hub.setatelecom.com.br/proposta/prop-4709/v/3', R('buscar', { termo: '/proposta/prop-4709', contexto: 'nao_abre' })],
  ['https://sti-hub.setatelecom.com.br/interno/proposta/prop-4709 não abre', R('buscar', { termo: '/interno/proposta/prop-4709', contexto: 'nao_abre' })],
  ['/interno/proposta/prop-4709', R('buscar', { termo: '/interno/proposta/prop-4709' })],
  ['esse link https://sti-hub.setatelecom.com.br/p/AbC123xYz9 não abre', R('buscar', { termo: '/p/AbC123xYz9', contexto: 'nao_abre' })],
  // numero de orcamento/proposta
  ['proposta 4709', R('consultar_propostas', { busca: '4709' })],
  ['orçamento 4725', R('consultar_propostas', { busca: '4725' })],
  ['orcamento nº 4725', R('consultar_propostas', { busca: '4725' })],
  ['orcamneto 4725', R('consultar_propostas', { busca: '4725' })],
  ['me mostra o orç 4709', R('consultar_propostas', { busca: '4709' })],
  ['localize a proposta 4709', R('consultar_propostas', { busca: '4709' })],
  ['como está a proposta 4709?', R('consultar_propostas', { busca: '4709' })],
  ['qual o status do orçamento #4709', R('consultar_propostas', { busca: '4709' })],
  ['GC-ORC-4696', R('consultar_propostas', { busca: '4696' })],
  ['proposta comercial 4720', R('consultar_propostas', { busca: '4720' })],
  ['proposta 4709 não abre', R('buscar', { termo: 'orçamento 4709', contexto: 'nao_abre' })],
  ['#4709', R('buscar', { termo: 'número 4709' })],
  ['4709', R('buscar', { termo: 'número 4709' })],
  // contrato
  ['contrato LOC-2026-101', R('buscar', { termo: 'contrato loc-2026-101' })],
  ['contrato 101', R('buscar', { termo: 'contrato 101' })],
  ['vigência do contrato LOC-2026-101', R('buscar', { termo: 'contrato loc-2026-101' })],
  ['LOC-2026-101', R('buscar', { termo: 'LOC-2026-101' })],
  // fatura e notas
  ['fatura 1234', R('buscar', { termo: 'fatura 1234' })],
  ['boleto 5566', R('buscar', { termo: 'fatura 5566' })],
  ['fatura FAT-1234', R('buscar', { termo: 'fatura fat-1234' })],
  ['NF 4567', R('buscar', { termo: 'nota 4567' })],
  ['nf-e 4567', R('buscar', { termo: 'nota 4567' })],
  ['nfs-e 000123', R('buscar', { termo: 'nota 123' })],
  ['nota fiscal 889', R('buscar', { termo: 'nota 889' })],
  ['NFCom 77', R('buscar', { termo: 'nota 77' })],
  ['35191114806925000132550010000012341000012345', R('buscar', { termo: '35191114806925000132550010000012341000012345' })],
  ['chave 3519 1114 8069 2500 0132 5500 1000 0012 3410 0001 2345', R('buscar', { termo: '35191114806925000132550010000012341000012345' })],
  // OS
  ['OS 1203', R('buscar', { termo: 'OS 1203' })],
  ['O.S. 1203', R('buscar', { termo: 'OS 1203' })],
  ['ordem de serviço 55', R('buscar', { termo: 'OS 55' })],
  ['os nº 1203', R('buscar', { termo: 'OS 1203' })],
  // chamados
  ['chamado SETA-123', R('buscar', { termo: 'chamado SETA-123' })],
  ['ticket 45', R('buscar', { termo: 'chamado 45' })],
  ['SETA-123', R('buscar', { termo: 'SETA-123' })],
  ['jira STI-77', R('buscar', { termo: 'chamado STI-77' })],
  // CNPJ / CPF / e-mail / telefone
  ['CNPJ 14.806.925/0001-32', R('buscar', { termo: 'CNPJ 14806925000132' })],
  ['14806925000132', R('buscar', { termo: 'CNPJ 14806925000132' })],
  ['quem é o 14.806.925/0001-32', R('buscar', { termo: 'CNPJ 14806925000132' })],
  ['cpf 123.456.789-09', R('buscar', { termo: 'CPF 12345678909' })],
  ['12345678909', R('buscar', { termo: 'CPF 12345678909' })],
  ['financeiro@cliente.com.br', R('buscar', { termo: 'financeiro@cliente.com.br' })],
  ['de quem é o e-mail Joao@Alfa.test?', R('buscar', { termo: 'joao@alfa.test' })],
  ['(85) 99999-8888', R('buscar', { termo: 'telefone 85999998888' })],
  ['telefone 85999998888', R('buscar', { termo: 'telefone 85999998888' })],
  ['+55 85 99999-8888', R('buscar', { termo: 'telefone 85999998888' })],
  // listas por entidade e situacao
  ['faturas vencidas', R('consultar', { entidade: 'faturas', status: 'vencido' })],
  ['fatruas vencidas', R('consultar', { entidade: 'faturas', status: 'vencido' })],
  ['boletos em atraso', R('consultar', { entidade: 'faturas', status: 'vencido' })],
  ['faturas pagas', R('consultar', { entidade: 'faturas', status: 'PAGA' })],
  ['faturas da Alfa', R('consultar', { entidade: 'faturas', busca: 'alfa' })],
  ['faturas vencidas do mês passado', R('consultar', { entidade: 'faturas', status: 'vencido', de: '2026-10-01', ate: '2026-10-31' })],
  ['quais contas a receber vencem este mês?', R('consultar', { entidade: 'contas_receber', de: '2026-11-01', ate: '2026-11-30' })],
  ['contas a receber vencidas', R('consultar', { entidade: 'contas_receber', status: 'vencido' })],
  ['inadimplentes', LLM],
  ['contas a pagar em aberto', R('consultar', { entidade: 'contas_pagar', status: 'aberto' })],
  ['contas a pagar da semana que vem', R('consultar', { entidade: 'contas_pagar', de: '2026-11-30', ate: '2026-12-06' })],
  ['notas fiscais de outubro', R('consultar', { entidade: 'notas_fiscais', de: '2026-10-01', ate: '2026-10-31' })],
  ['NFs emitidas ontem', R('consultar', { entidade: 'notas_fiscais', status: 'EMITIDA', de: '2026-11-23', ate: '2026-11-23' })],
  ['contratos ativos', R('consultar', { entidade: 'contratos', status: 'ATIVO' })],
  ['cntratos ativos', R('consultar', { entidade: 'contratos', status: 'ATIVO' })],
  ['contratos da Alfa', R('consultar', { entidade: 'contratos', busca: 'alfa' })],
  ['contratos encerrados no ano passado', R('consultar', { entidade: 'contratos', status: 'ENCERRADO', de: '2025-01-01', ate: '2025-12-31' })],
  ['contratos em renovação', R('consultar', { entidade: 'contratos', status: 'RENOVACAO_PROXIMA' })],
  ['contratos suspensos', R('consultar', { entidade: 'contratos', status: 'SUSPENSO' })],
  ['locações ativas', R('consultar', { entidade: 'contratos', status: 'ATIVO' })],
  ['OS em aberto', R('consultar', { entidade: 'ordens_servico', status: 'aberto' })],
  ['as OS abertas', R('consultar', { entidade: 'ordens_servico', status: 'aberto' })],
  ['minhas OS', R('consultar', { entidade: 'ordens_servico' })],
  ['ordens de serviço concluídas', R('consultar', { entidade: 'ordens_servico', status: 'conclu' })],
  ['ordens de serviço em andamento', R('consultar', { entidade: 'ordens_servico', status: 'em andamento' })],
  ['chamados abertos', R('consultar', { entidade: 'chamados', status: 'aberto' })],
  ['chamados da semana passada', R('consultar', { entidade: 'chamados', de: '2026-11-16', ate: '2026-11-22' })],
  ['tickets resolvidos', R('consultar', { entidade: 'chamados', status: 'resolvido' })],
  ['chamados da Alfa', R('consultar', { entidade: 'chamados', busca: 'alfa' })],
  ['propostas aprovadas', R('consultar_propostas', { status: 'APROVADA' })],
  ['propostas enviadas', R('consultar_propostas', { status: 'ENVIADA' })],
  ['propostas rascunho', R('consultar_propostas', { status: 'RASCUNHO' })],
  ['orçamentos recusados', R('consultar_propostas', { status: 'RECUSADA' })],
  ['orçamentos em negociação', R('consultar_propostas', { status: 'EM_NEGOCIACAO' })],
  ['propostas convertidas em contrato', R('consultar_propostas', { status: 'CONVERTIDA_CONTRATO' })],
  ['orçamentos enviados para Parangaba', R('consultar_propostas', { busca: 'parangaba', status: 'ENVIADA' })],
  ['orçamentos aprovados de outubro', R('consultar_propostas', { status: 'APROVADA', de: '2026-10-01', ate: '2026-10-31' })],
  ['propostas de ontem', R('consultar_propostas', { de: '2026-11-23', ate: '2026-11-23' })],
  ['propostas do Condomínio do Parangaba', R('consultar_propostas', { busca: 'condominio parangaba' })],
  ['orcamentos', R('consultar_propostas', {})],
  ['estoque do Dell R640', R('consultar', { entidade: 'estoque', busca: 'dell r640' })],
  ['produtos sem estoque', R('consultar', { entidade: 'estoque', status: 'sem estoque' })],
  ['estoque baixo', R('consultar', { entidade: 'estoque', status: 'abaixo do minimo' })],
  ['produtos', R('consultar', { entidade: 'produtos' })],
  ['tabela de preços do switch', R('consultar', { entidade: 'produtos', busca: 'switch' })],
  ['equipamentos inativos', R('consultar', { entidade: 'produtos', status: 'inativo' })],
  ['fornecedores', R('consultar', { entidade: 'fornecedores' })],
  ['fornecedor Dell', R('consultar', { entidade: 'fornecedores', busca: 'dell' })],
  ['vendas de ontem', R('consultar', { entidade: 'vendas', de: '2026-11-23', ate: '2026-11-23' })],
  ['vendas dos últimos 7 dias', R('consultar', { entidade: 'vendas', de: '2026-11-18', ate: '2026-11-24' })],
  ['negócios do CRM', R('consultar', { entidade: 'negocios' })],
  ['contatos da Alfa', R('consultar', { entidade: 'contatos', busca: 'alfa' })],
  ['clientes', R('consultar', { entidade: 'empresas' })],
  // relatorios
  ['relatório de faturas por mês', R('relatorio', { entidade: 'faturas', agrupar_por: 'mes' })],
  ['relatório de contratos por situação', R('relatorio', { entidade: 'contratos' })],
  ['total a receber este mês', R('relatorio', { entidade: 'contas_receber', de: '2026-11-01', ate: '2026-11-30' })],
  ['quanto temos a pagar no mês que vem', R('relatorio', { entidade: 'contas_pagar', de: '2026-12-01', ate: '2026-12-31' })],
  ['quantos chamados abertos', R('relatorio', { entidade: 'chamados', status: 'aberto' })],
  ['soma das vendas mês a mês', R('relatorio', { entidade: 'vendas', agrupar_por: 'mes' })],
  // painel
  ['painel', R('painel', {})],
  ['painel de outubro', R('painel', { mes: '2026-10' })],
  ['dashboard do mês passado', R('painel', { mes: '2026-10' })],
  ['quanto faturamos mês passado?', R('painel', { mes: '2026-10' })],
  ['faturamento de 09/2026', R('painel', { mes: '2026-09' })],
  ['taxa de aprovação das propostas', R('painel', {})],
  ['quantas propostas aprovadas mês passado', R('painel', { mes: '2026-10' })],
  ['propostas feitas e aprovadas em setembro de 2026', R('painel', { mes: '2026-09' })],
  // busca por nome
  ['cliente Parangaba', R('buscar', { termo: 'parangaba' })],
  ['procure Parangaba', R('buscar', { termo: 'parangaba' })],
  ['busque condominio parangaba', R('buscar', { termo: 'condominio parangaba' })],
  ['pesquise por dafiti', R('buscar', { termo: 'dafiti' })],
  ['quem é a Alfa Distribuidora', R('buscar', { termo: 'alfa distribuidora' })],
  ['dados da empresa A3C cloud', R('buscar', { termo: 'a3c cloud' })],
  ['ache o cadastro do condomínio parangaba', R('buscar', { termo: 'condominio parangaba' })],
  // base de conhecimento (regras do Marcéllo e telas)
  ['a Seta aceita cartão de crédito?', KB('formas-pagamento')],
  ['pode parcelar no cartão?', KB('formas-pagamento')],
  ['quais as formas de pagamento?', KB('formas-pagamento')],
  ['vocês usam PDV?', KB('pdv')],
  ['como faço venda no balcão?', KB('pdv')],
  ['é locação pura ou locação?', KB('locacao-nome')],
  ['serviço pontual mostra /mês?', KB('servico-pontual')],
  ['na locação o setup entra na mensalidade?', KB('setup-locacao')],
  ['existe contrato para orçamento de produtos?', KB('contrato-produtos')],
  ['proposta vencida abre?', KB('proposta-vencida')],
  ['como revalidar uma proposta vencida?', KB('proposta-vencida')],
  ['o que é a versão contrato?', KB('versao-contrato')],
  ['o que é o link interno?', KB('versao-contrato')],
  ['como gero o link do cliente?', KB('link-cliente')],
  ['por que o link da proposta não abre?', KB('link-cliente')],
  ['por que aparece proposta não localizada?', KB('link-cliente')],
  ['como funciona a sincronização com o gestaoclick?', KB('sincronizacao-gc')],
  ['o painel conta o GC?', KB('painel')],
  ['posso misturar dois CNPJs na mesma proposta?', KB('trava-fiscal')],
  ['o que é a trava fiscal?', KB('trava-fiscal')],
  ['como faço um orçamento?', KB('criar-orcamento')],
  ['como editar uma proposta?', KB('editar-orcamento')],
  ['como vejo o histórico de versões?', KB('editar-orcamento')],
  ['como converter em contrato?', KB('aprovar-converter')],
  ['onde vejo a vigência e o reajuste do contrato?', KB('contratos')],
  ['como dar baixa em uma fatura?', KB('faturas')],
  ['onde vejo as notas fiscais?', KB('notas-fiscais')],
  ['como emitir nota fiscal?', KB('notas-fiscais')],
  ['como abrir OS?', KB('ordens-servico')],
  ['como funciona o SLA dos chamados?', KB('chamados')],
  ['onde fica o estoque?', KB('estoque-produtos')],
  ['onde vejo contas a receber?', KB('financeiro')],
  ['como cadastrar cliente?', KB('cadastros')],
  ['qual a diferença entre negócio e orçamento?', KB('crm-negocios')],
  ['estou com acesso negado no financeiro, por quê?', KB('erro-permissao')],
  ['minha sessão expirou', KB('erro-sessao')],
  ['o que você faz?', KB('assistente-escopo')],
  // gravacao vai para o modelo (com cartao)
  ['adicione 2800 de despesas na proposta 4709', LLM],
  ['localize a proposta 4709 e adicione 2800,00 de despesas de locomoção e hospedagem', LLM],
  ['crie uma proposta de locação de 36 meses para A3C cloud de 3 servidores Dell R640', LLM],
  ['abra um chamado para a Alfa: impressora parada', LLM],
  ['abra uma OS para Alfa troca de fonte', LLM],
  ['altere a quantidade do item 2 da proposta 4709 para 3', LLM],
  ['mude o prazo da proposta 4725 para 24 meses', LLM],
  ['emita a nota da fatura 1234', LLM],
  ['envie a proposta 4709 para o cliente', LLM],
  ['na proposta 4709 coloca 2800 de locomoção', LLM],
  ['proposta 4709 com R$ 2.800,00 de hospedagem', LLM],
  ['tira o item 3 da proposta 4725', LLM],
  ['aumente a quantidade do orçamento 4725 para 4', LLM],
  ['oi', LLM],
  ['obrigado', LLM],
  ['ok', LLM],
];

describe('assistente robusto — roteamento de intenção', () => {
  for (const [pergunta, esperado] of CASOS_ROTEAMENTO) {
    it(`"${pergunta}"`, () => {
      const r = rotearPergunta(pergunta, { agora: AGORA });
      if (esperado === null) {
        assert.equal(r, null, `esperava seguir ao modelo, veio ${JSON.stringify(r)}`);
        return;
      }
      assert.ok(r, 'esperava uma rota');
      if ('texto' in esperado) {
        assert.equal(r!.tipo, 'texto', JSON.stringify(r));
        assert.equal(r!.motivo, `conhecimento:${esperado.texto}`);
        return;
      }
      assert.equal(r!.tipo, 'ferramenta', JSON.stringify(r));
      if (r!.tipo !== 'ferramenta') return;
      assert.equal(r!.ferramenta, esperado.f, JSON.stringify(r));
      if (esperado.args) assert.deepEqual(r!.args, esperado.args);
      // a rota sempre produz argumentos validos para a ferramenta
      const tool = getTool(r!.ferramenta)!;
      assert.equal(tool.schema.safeParse(r!.args).success, true, JSON.stringify(r!.args));
    });
  }
});

// ---------------------------------------------------------------------------
// 2) Identificadores
// ---------------------------------------------------------------------------
const CASOS_IDS: Array<[string, TipoIdentificador, string]> = [
  ['#prop-1795473263142-d5b63b', 'id_proposta', 'prop-1795473263142-d5b63b'],
  ['https://x/proposta/prop-abc123#t=eyJ0b2tlbi1hc3NpbmFkbw', 'link_proposta', 'prop-abc123'],
  ['https://x/interno/proposta/prop-abc123', 'link_proposta', 'prop-abc123'],
  ['https://x/proposta/prop%2Dabc123', 'link_proposta', 'prop-abc123'],
  ['https://x/p/AbC123xYz9', 'link_proposta', 'AbC123xYz9'],
  ['orçamento 4725', 'proposta', '4725'],
  ['proposta nº 4709', 'proposta', '4709'],
  ['GC-ORC-4696', 'proposta', '4696'],
  ['contrato LOC-2026-101', 'contrato', 'loc-2026-101'],
  ['contrato de locação 77', 'contrato', '77'],
  ['fatura 1234', 'fatura', '1234'],
  ['boleto nº 99', 'fatura', '99'],
  ['NF-e 000.123', 'nota', '123'],
  ['nfs-e 456', 'nota', '456'],
  ['nota fiscal eletrônica 789', 'nota', '789'],
  ['3519 1114 8069 2500 0132 5500 1000 0012 3410 0001 2345', 'chave_nfe', '35191114806925000132550010000012341000012345'],
  ['OS 1203', 'os', '1203'],
  ['ordem de serviço nº 55', 'os', '55'],
  ['chamado SETA-123', 'chamado', 'SETA-123'],
  ['ticket 45', 'chamado', '45'],
  ['SETA-123', 'codigo', 'SETA-123'],
  ['14.806.925/0001-32', 'cnpj', '14806925000132'],
  ['14806925000132', 'cnpj', '14806925000132'],
  ['123.456.789-09', 'cpf', '12345678909'],
  ['CPF 52998224725', 'cpf', '52998224725'],
  ['Fulano@Empresa.COM.br', 'email', 'fulano@empresa.com.br'],
  ['(85) 3333-4444', 'telefone', '8533334444'],
  ['whatsapp 85999998888', 'telefone', '85999998888'],
  ['#4709', 'numero', '4709'],
];

describe('assistente robusto — identificadores', () => {
  for (const [texto, tipo, valor] of CASOS_IDS) {
    it(`${tipo}: "${texto}"`, () => {
      const ids = extrairIdentificadores(texto);
      assert.ok(ids.some((i) => i.tipo === tipo && i.valor === valor), JSON.stringify(ids));
    });
  }
  it('link assinado: registra que tinha assinatura, mas nunca guarda o token', () => {
    const ids = extrairIdentificadores('https://sti-hub.setatelecom.com.br/proposta/prop-abc#t=eyJTOKENSECRETO1234567890');
    const l = ids.find((i) => i.tipo === 'link_proposta')!;
    assert.equal(l.link?.comToken, true);
    assert.doesNotMatch(JSON.stringify(ids), /TOKENSECRETO/);
  });
  it('link sem assinatura e Versão contrato', () => {
    assert.equal(extrairIdentificadores('/proposta/prop-abc').find((i) => i.tipo === 'link_proposta')?.link?.comToken, false);
    assert.equal(extrairIdentificadores('/interno/proposta/prop-abc')[0].link?.area, 'interno');
    assert.equal(extrairIdentificadores('/proposta/prop-abc/v/2')[0].link?.versao, 2);
  });
  it('valores em reais e anos não viram número de registro', () => {
    assert.deepEqual(extrairIdentificadores('adicione R$ 2.800,00 em 2026'), []);
  });
  it('CPF e CNPJ: dígitos verificadores', () => {
    assert.equal(cpfValido('529.982.247-25'), true);
    assert.equal(cpfValido('111.111.111-11'), false);
    assert.equal(cnpjValido('14.806.925/0001-32'), cnpjValido('14806925000132'));
    assert.equal(cnpjValido('00.000.000/0000-00'), false);
  });
  it('erros de digitação comuns são corrigidos pelo vocabulário do sistema', () => {
    assert.equal(corrigirPalavra('orcamneto'), 'orcamento');
    assert.equal(corrigirPalavra('fatruas'), 'faturas');
    assert.equal(corrigirPalavra('cntratos'), 'contratos');
    assert.equal(corrigirPalavra('propsota'), 'proposta');
    assert.equal(corrigirPalavra('estoqeu'), 'estoque');
    assert.equal(corrigirPalavra('orc'), 'orcamento');
    assert.equal(corrigirPalavra('alfa'), 'alfa', 'nomes curtos não mudam');
    assert.equal(normalizarPergunta('Orçamento VENCIDO?'), 'orcamento vencido?');
  });
});

// ---------------------------------------------------------------------------
// 3) Datas relativas (fuso de Brasília, hoje = 24/11/2026)
// ---------------------------------------------------------------------------
const CASOS_DATAS: Array<[string, string, string, string?]> = [
  ['hoje', '2026-11-24', '2026-11-24'],
  ['ontem', '2026-11-23', '2026-11-23'],
  ['anteontem', '2026-11-22', '2026-11-22'],
  ['este mês', '2026-11-01', '2026-11-30', '2026-11'],
  ['mês passado', '2026-10-01', '2026-10-31', '2026-10'],
  ['mes que vem', '2026-12-01', '2026-12-31', '2026-12'],
  ['semana passada', '2026-11-16', '2026-11-22'],
  ['esta semana', '2026-11-23', '2026-11-24'],
  ['últimos 30 dias', '2026-10-26', '2026-11-24'],
  ['ano passado', '2025-01-01', '2025-12-31'],
  ['em outubro', '2026-10-01', '2026-10-31', '2026-10'],
  ['dezembro', '2025-12-01', '2025-12-31', '2025-12'],
  ['março de 2026', '2026-03-01', '2026-03-31', '2026-03'],
  ['10/2026', '2026-10-01', '2026-10-31', '2026-10'],
  ['de 01/10/2026 a 15/10/2026', '2026-10-01', '2026-10-15'],
];
describe('assistente robusto — datas relativas', () => {
  for (const [texto, de, ate, mes] of CASOS_DATAS) {
    it(`"${texto}"`, () => {
      const p = periodoRelativo(texto, AGORA)!;
      assert.ok(p, 'reconhece o período');
      assert.equal(p.de, de);
      assert.equal(p.ate, ate);
      if (mes) assert.equal(p.mes, mes);
    });
  }
  it('meia-noite em Brasília ainda é o dia anterior em UTC', () => {
    const p = periodoRelativo('hoje', Date.parse('2026-11-25T01:30:00Z'))!;
    assert.equal(p.de, '2026-11-24');
  });
  it('sem período: null; termo de busca sem palavras de comando', () => {
    assert.equal(periodoRelativo('contratos da alfa', AGORA), null);
    assert.equal(termoDeBusca('me mostre as faturas vencidas do cliente Alfa Distribuidora', null), 'alfa distribuidora');
  });
});

// ---------------------------------------------------------------------------
// 4) Busca universal (execução, mesmo RBAC das rotas da tela)
// ---------------------------------------------------------------------------
describe('assistente robusto — busca universal', () => {
  it('caso real: chat + confirmar acham o orçamento 4725 e explicam o link sem assinatura', async () => {
    const { api } = apiCompleta();
    const llm = llmQueNaoDeveSerChamado();
    const d = deps({ api, llm });
    const chat = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'Proposta Comercial #prop-1795473263142-d5b63b não localizada, por que essa proposta não abre?' }] }, d);
    assert.equal(chat.status, 200);
    assert.equal(chat.body.tipo, 'proposta', 'sai o cartão de busca (só leitura)');
    assert.equal((chat.body.proposta as any).ferramenta, 'buscar');
    assert.equal((chat.body.proposta as any).acao, 'leitura');
    assert.equal(llm.calls, 0, 'o caso claro não depende do modelo');
    const exec = await handleExecute({ token: (chat.body.proposta as any).token, confirmar: true }, d);
    assert.equal(exec.status, 200);
    assert.equal(exec.body.ok, true);
    const msg = String(exec.body.mensagem);
    assert.match(msg, /4725/);
    assert.match(msg, /Parangaba/);
    assert.match(msg, /R\$\s?2\.350,00\/mês por 36 meses/);
    assert.match(msg, /sem a assinatura do cliente/);
    assert.match(msg, /Copiar link do cliente/);
    assert.equal((exec.body.registro as any).codigo, '4725');
    assert.doesNotMatch(String(exec.body.resumoParaModelo), /Parangaba/, 'o modelo não recebe o cliente');
    assert.equal(d.audits.length, 1);
  });

  it('link colado sem assinatura: acha e explica; com assinatura: orienta gerar outro', async () => {
    const { api } = apiCompleta();
    const t = getTool('buscar')!;
    const sem = await t.executar({ termo: 'https://sti-hub.setatelecom.com.br/proposta/prop-1795473263142-d5b63b' }, api);
    assert.match(sem.ok ? sem.mensagem : '', /4725.*sem a assinatura/s);
    const com = await t.executar({ termo: '/proposta/prop-1795473263142-d5b63b', link_com_assinatura: true }, api);
    assert.match(com.ok ? com.mensagem : '', /tinha a assinatura/);
  });

  it('Versão contrato colada: explica que exige login com ERP', async () => {
    const { api } = apiCompleta();
    const r = await getTool('buscar')!.executar({ termo: '/interno/proposta/prop-1795473263142-d5b63b', contexto: 'nao_abre' }, api);
    assert.match(r.ok ? r.mensagem : '', /Versão contrato.*logado/s);
  });

  it('proposta vencida: avisa da revalidação; serviço pontual mostra pagamento único', async () => {
    const { api } = apiCompleta();
    const r = await getTool('buscar')!.executar({ termo: 'prop-4709', contexto: 'nao_abre' }, api);
    const msg = r.ok ? r.mensagem : '';
    assert.match(msg, /pagamento único/);
    assert.doesNotMatch(msg, /\/mês/);
    assert.match(msg, /revalidação/);
  });

  it('número solto acha em todos os recursos (orçamento, OS, fatura, venda...)', async () => {
    const { api } = apiCompleta();
    const r = await getTool('buscar')!.executar({ termo: 'número 1203' }, api);
    assert.match(r.ok ? r.mensagem : '', /OS 1203/);
  });

  it('contrato pelo número: vigência e reajuste', async () => {
    const { api } = apiCompleta();
    const r = await getTool('buscar')!.executar({ termo: 'contrato 101' }, api);
    const msg = r.ok ? r.mensagem : '';
    assert.match(msg, /LOC-2026-101/);
    assert.match(msg, /vigência 10\/01\/2026 a 09\/01\/2028/);
    assert.match(msg, /reajuste IGP-M/);
  });

  it('fatura e nota pelo número e pela chave de 44 dígitos', async () => {
    const { api } = apiCompleta();
    const t = getTool('buscar')!;
    assert.match(((await t.executar({ termo: 'fatura 1234' }, api)) as any).mensagem, /FAT-1234.*VENCIDA/s);
    assert.match(((await t.executar({ termo: 'nota 4567' }, api)) as any).mensagem, /4567/);
    assert.match(((await t.executar({ termo: '35191114806925000132550010000012341000012345' }, api)) as any).mensagem, /4567/);
  });

  it('chamado pela chave e pelo número', async () => {
    const { api } = apiCompleta();
    const t = getTool('buscar')!;
    assert.match(((await t.executar({ termo: 'SETA-123' }, api)) as any).mensagem, /SETA-123/);
    assert.match(((await t.executar({ termo: 'chamado 123' }, api)) as any).mensagem, /SETA-123/);
  });

  it('CNPJ com ou sem máscara acha cliente e os documentos dele', async () => {
    const { api } = apiCompleta();
    for (const termo of ['CNPJ 11.222.333/0001-81', '11222333000181']) {
      const r = await getTool('buscar')!.executar({ termo }, api);
      assert.equal(r.ok, true);
      const tipos = (r.ok && r.tabela?.linhas.map((l) => l[0])) || [];
      assert.ok(tipos.includes('Cliente') && tipos.includes('Contrato') && tipos.includes('Fatura'), JSON.stringify(tipos));
    }
  });

  it('e-mail e telefone acham contato, cliente e chamado', async () => {
    const { api } = apiCompleta();
    const t = getTool('buscar')!;
    const e = await t.executar({ termo: 'joao@alfa.test' }, api);
    const tiposE = (e.ok && e.tabela?.linhas.map((l) => l[0])) || [];
    assert.ok(tiposE.includes('Contato') && tiposE.includes('Chamado'), JSON.stringify(tiposE));
    const f = await t.executar({ termo: 'telefone (85) 99999-8888' }, api);
    assert.match(f.ok ? f.mensagem : '', /Alfa Ltda/);
  });

  it('nome parcial e sem acento: "condominio parangaba"', async () => {
    const { api } = apiCompleta();
    const r = await getTool('buscar')!.executar({ termo: 'condominio parangaba' }, api);
    const tipos = (r.ok && r.tabela?.linhas.map((l) => l[0])) || [];
    assert.ok(tipos.includes('Cliente') && tipos.includes('Orçamento'), JSON.stringify(tipos));
  });

  it('fallback amplo: "orçamento 1203" que na verdade é uma OS', async () => {
    const { api } = apiCompleta();
    const r = await getTool('buscar')!.executar({ termo: 'orçamento 1203' }, api);
    assert.match(r.ok ? r.mensagem : '', /OS 1203/);
  });

  it('consultar_propostas sem resultado amplia para a busca universal', async () => {
    const { api } = apiCompleta();
    const r = await getTool('consultar_propostas')!.executar({ busca: 'Dell Computadores' }, api);
    assert.match(r.ok ? r.mensagem : '', /fornecedor|Dell/i);
  });

  it('nada encontrado: diz onde procurou e sugere alternativas concretas', async () => {
    const { api } = apiCompleta();
    const r = await getTool('buscar')!.executar({ termo: 'prop-naoexiste-123', contexto: 'nao_abre' }, api);
    const msg = r.ok ? r.mensagem : '';
    assert.match(msg, /Não encontrei/);
    assert.match(msg, /orçamentos, contratos, faturas/);
    assert.match(msg, /carteira|sincronizada/);
    assert.match(msg, /Copiar link do cliente/);
  });

  it('RBAC: rota negada (403) não vaza dados e avisa o que não foi procurado', async () => {
    const { api } = apiCompleta({ 'GET /api/tickets': () => ({ status: 403, body: { error: 'sem módulo' } }) });
    const r = await getTool('buscar')!.executar({ termo: 'SETA-999' }, api);
    const msg = r.ok ? r.mensagem : '';
    assert.match(msg, /não tem acesso a: .*Chamados/);
  });

  it('RBAC: usuário só CRM não recebe a ferramenta painel e não vê orçamentos', async () => {
    const names = toolDefinitionsFor(CRM_ONLY).map((t) => t.function.name);
    assert.ok(names.includes('buscar'));
    assert.ok(!names.includes('painel'));
    assert.ok(!names.includes('consultar_propostas'));
    const d = deps({ user: CRM_ONLY });
    const r = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'painel de outubro' }] }, d);
    assert.notEqual(r.body.tipo, 'proposta', 'sem ERP não sai cartão de painel');
  });

  it('a busca só usa rotas de leitura da lista fixa do assistente', async () => {
    const { api, calls } = apiCompleta();
    await getTool('buscar')!.executar({ termo: 'condominio parangaba' }, api);
    await getTool('buscar')!.executar({ termo: 'joao@alfa.test' }, api);
    assert.ok(calls.length > 0);
    for (const c of calls) {
      assert.equal(c.method, 'GET');
      assert.equal(isAllowedAssistenteRoute(c.method, c.path), true, c.path);
    }
  });
});

// ---------------------------------------------------------------------------
// 5) Leituras novas: financeiro (com alçada), notas, estoque, chamados, fornecedores, painel
// ---------------------------------------------------------------------------
describe('assistente robusto — leituras dos módulos', () => {
  const FIN = [
    { id: 'l1', type: 'RECEBER', description: 'Mensalidade Alfa', companyName: 'Alfa Ltda', amount: 1000, dueDate: '2026-10-10', paidAt: null, status: 'ABERTO' },
    { id: 'l2', type: 'RECEBER', description: 'Mensalidade Beta', companyName: 'Beta SA', amount: 500, dueDate: '2026-11-10', paidAt: '2026-11-10', status: 'PAGO' },
    { id: 'l3', type: 'PAGAR', description: 'Aluguel', companyName: 'Imobiliária', amount: 3000, dueDate: '2099-12-01', paidAt: null, status: 'ABERTO' },
  ];
  const finApi = (financeVisible: boolean) =>
    fakeApi({
      'GET /api/erp/dashboard': () => ({ status: 200, body: { data: { financeVisible } } }),
      'GET /api/erp/financial': () => ({ status: 200, body: { data: FIN } }),
    });

  it('contas a receber vencidas (ABERTO com vencimento passado = atrasado)', async () => {
    const { api } = finApi(true);
    const r = await getTool('consultar')!.executar({ entidade: 'contas_receber', status: 'vencido' }, api);
    assert.equal(r.ok && r.tabela?.linhas.length, 1);
    assert.equal(r.ok && r.tabela?.linhas[0][0], 'Mensalidade Alfa');
  });

  it('contas a pagar não misturam com a receber', async () => {
    const { api } = finApi(true);
    const r = await getTool('consultar')!.executar({ entidade: 'contas_pagar' }, api);
    assert.equal(r.ok && r.tabela?.linhas.length, 1);
  });

  it('sem alçada financeira: não mostra o financeiro, mesmo com ERP', async () => {
    const { api, calls } = finApi(false);
    const r = await getTool('consultar')!.executar({ entidade: 'contas_receber' }, api);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.mensagem : '', /alçada financeira/);
    assert.equal(calls.some((c) => c.path.startsWith('/api/erp/financial')), false, 'nem chega a ler o financeiro');
  });

  it('notas fiscais exclui faturas de locação; faturas vencidas usam o vencimento', async () => {
    const { api } = apiCompleta();
    const n = await getTool('consultar')!.executar({ entidade: 'notas_fiscais' }, api);
    assert.equal(n.ok && n.tabela?.linhas.length, 1);
    const f = await getTool('consultar')!.executar({ entidade: 'faturas', status: 'vencido' }, api);
    assert.equal(f.ok && f.tabela?.linhas.length, 1);
    assert.equal(f.ok && f.tabela?.linhas[0][0], 'FAT-1234');
  });

  it('estoque: sem estoque e abaixo do mínimo', async () => {
    const { api } = apiCompleta();
    const sem = await getTool('consultar')!.executar({ entidade: 'estoque', status: 'sem estoque' }, api);
    assert.equal(sem.ok && sem.tabela?.linhas[0][1], 'Servidor Dell R640');
    const baixo = await getTool('consultar')!.executar({ entidade: 'estoque', status: 'abaixo do minimo' }, api);
    assert.equal(baixo.ok && baixo.tabela?.linhas.length, 2);
  });

  it('chamados vêm de /api/tickets com situação em português', async () => {
    const { api, calls } = apiCompleta();
    const r = await getTool('consultar')!.executar({ entidade: 'chamados', status: 'aberto' }, api);
    assert.equal(r.ok && r.tabela?.linhas[0][3], 'Aberto');
    assert.ok(calls.some((c) => c.path.startsWith('/api/tickets')));
    assert.deepEqual(getTool('consultar')!.modulos({ entidade: 'chamados' }), ['chamados']);
  });

  it('fornecedores vêm do overview do ERP', async () => {
    const { api } = apiCompleta();
    const r = await getTool('consultar')!.executar({ entidade: 'fornecedores', busca: 'dell' }, api);
    assert.equal(r.ok && r.tabela?.linhas[0][0], 'Dell Computadores');
  });

  it('contratos mostram fim da vigência e reajuste', async () => {
    const { api } = apiCompleta();
    const r = await getTool('consultar')!.executar({ entidade: 'contratos', status: 'ATIVO' }, api);
    assert.equal(r.ok && r.tabela?.colunas.includes('Reajuste'), true);
    assert.match((r.ok && r.tabela?.linhas[0][6]) || '', /IGP-M/);
  });

  it('propostas por período (data de criação)', async () => {
    const { api } = apiCompleta();
    const r = await getTool('consultar_propostas')!.executar({ de: '2026-10-01', ate: '2026-10-31' }, api);
    assert.equal(r.ok && r.tabela?.linhas.length, 1);
    assert.equal(r.ok && r.tabela?.linhas[0][0], '4709');
  });

  it('painel: feitas x aprovadas, faturado e (com alçada) recebido', async () => {
    const { api, calls } = fakeApi({
      'GET /api/erp/dashboard': () => ({
        status: 200,
        body: { data: { month: '2026-10', monthLabel: 'outubro/2026', financeVisible: true, proposals: { made: { count: 12, value: 100000 }, approved: { count: 3, value: 25000 }, approvalRate: 25 }, invoiced: { count: 5, value: 9000 }, sales: { monthTotal: 4000 }, summary: { receivedMonth: 7000, paidMonth: 2000 }, monthly: [] } },
      }),
    });
    const r = await getTool('painel')!.executar({ mes: '2026-10' }, api);
    assert.equal(r.ok, true);
    assert.equal(calls[0].path, '/api/erp/dashboard?mes=2026-10');
    assert.match(r.ok ? r.mensagem : '', /12 propostas feitas e 3 aprovadas/);
    const rot = (r.ok && r.totais?.map((t) => t.rotulo)) || [];
    assert.ok(rot.includes('Recebido (pelo vencimento)'));
  });

  it('painel sem alçada financeira não mostra recebido/pago', async () => {
    const { api } = fakeApi({ 'GET /api/erp/dashboard': () => ({ status: 200, body: { data: { financeVisible: false, proposals: { made: { count: 1, value: 1 }, approved: { count: 0, value: 0 } }, sales: {} } } }) });
    const r = await getTool('painel')!.executar({}, api);
    assert.equal(((r.ok && r.totais) || []).some((t) => /Recebido|Pago/.test(t.rotulo)), false);
  });

  it('filtro de situação tolerante', () => {
    assert.equal(statusCombina('vencido', 'VENCIDA'), true);
    assert.equal(statusCombina('vencido', 'ATRASADO'), true);
    assert.equal(statusCombina('aberto', 'EMITIDA'), true);
    assert.equal(statusCombina('aberto', 'PAGA'), false);
    assert.equal(statusCombina('aberto', 'Resolvido'), false);
    assert.equal(statusCombina('PAGA', 'PAGA'), true);
    assert.equal(statusCombina('em implantacao', 'EM_IMPLANTACAO'), true);
  });

  it('lista de rotas: leituras novas liberadas, nenhuma escrita nova', () => {
    for (const p of ['/api/erp/dashboard', '/api/erp/catalog', '/api/erp/financial', '/api/erp/fiscal-documents', '/api/tickets']) {
      assert.equal(isAllowedAssistenteRoute('GET', p), true, p);
      assert.equal(isAllowedAssistenteRoute('POST', p) && p !== '/api/tickets', false, `POST ${p}`);
      assert.equal(isAllowedAssistenteRoute('PATCH', p), false, `PATCH ${p}`);
    }
    assert.equal(isAllowedAssistenteRoute('POST', '/api/erp/financial/x/pay'), false);
    assert.equal(isAllowedAssistenteRoute('GET', '/api/erp/proposals/x/public-link'), false);
  });

  it('ferramentas novas são só leitura', () => {
    for (const n of ['buscar', 'painel', 'consultar', 'relatorio', 'consultar_propostas']) assert.equal(getTool(n)!.tipo, 'leitura', n);
  });
});

// ---------------------------------------------------------------------------
// 6) Base de conhecimento e prompt
// ---------------------------------------------------------------------------
describe('assistente robusto — base de conhecimento', () => {
  it('todas as entradas têm id único, palavras-chave e resposta', () => {
    const ids = new Set<string>();
    for (const e of BASE_CONHECIMENTO) {
      assert.ok(!ids.has(e.id), e.id);
      ids.add(e.id);
      assert.ok(e.chaves.length >= 2 && e.resposta.length > 40, e.id);
      assert.doesNotMatch(e.resposta, /Locação Pura"?\s*\./, 'nunca recomenda "Locação Pura"');
    }
    assert.ok(BASE_CONHECIMENTO.length >= 25);
  });
  it('regras de negócio do Marcéllo estão na base', () => {
    const tudo = BASE_CONHECIMENTO.map((e) => e.resposta).join('\n');
    assert.match(tudo, /Boleto, Pix e Ted \/ Transferência/);
    assert.match(tudo, /Não aceitamos cartão/);
    assert.match(tudo, /não usa PDV/);
    assert.match(tudo, /se chama só "Locação"/);
    assert.match(tudo, /sem "\/mês"/);
    assert.match(tudo, /setup é cobrado à parte da mensalidade/);
    assert.match(tudo, /rótulo é sempre "Serviço"/);
    assert.match(tudo, /Não existe contrato para orçamento de produtos/);
    assert.match(tudo, /aviso no topo/);
    assert.match(tudo, /Versão contrato/);
    assert.match(tudo, /só abre com a assinatura/);
    assert.match(tudo, /ERP de origem → STI HUB ERP/);
    assert.match(tudo, /negócios gerados e faturados no STI-hub/);
    assert.match(tudo, /nunca misture CNPJs distintos/);
  });
  it('dúvida sem assunto conhecido não inventa resposta', () => {
    assert.equal(responderConhecimento('como está o tempo hoje?'), null);
    assert.equal(buscarConhecimento('bom dia'), null);
  });
  it('o prompt do modelo leva a base, os sinônimos e a regra de nunca dizer "não achei" sem buscar', async () => {
    const llm = {
      seen: '' as string,
      async complete(messages: any[]) {
        llm.seen = messages[0].content;
        return { text: 'ok', toolCalls: [], model: 't' };
      },
    };
    await handleChat({ mensagens: [{ papel: 'usuario', texto: 'bom dia, tudo bem com você hoje' }] }, deps({ llm }));
    assert.match(llm.seen, /orçamento = proposta/);
    assert.match(llm.seen, /Nunca diga que não encontrou/);
    assert.match(llm.seen, /Boleto, Pix e Ted/);
    assert.match(llm.seen, /2026-11-24/);
    assert.ok(resumoConhecimentoParaPrompt().length < 12000, 'resumo cabe no prompt');
  });
  it('dúvida respondida pela base não chama o modelo nem consulta dados', async () => {
    const { api, calls } = fakeApi({});
    const llm = llmQueNaoDeveSerChamado();
    const r = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'a Seta aceita cartão de crédito?' }] }, deps({ api, llm }));
    assert.equal(r.body.tipo, 'texto');
    assert.match(String(r.body.texto), /Boleto, Pix e Ted/);
    assert.equal(llm.calls, 0);
    assert.equal(calls.length, 0);
  });
  it('resposta a uma pergunta do assistente (ex.: escolher a empresa pelo CNPJ) vai ao modelo com o histórico', async () => {
    const llm = llmQueNaoDeveSerChamado();
    await handleChat(
      {
        mensagens: [
          { papel: 'usuario', texto: 'proposta de locação para Alfa de 2 PABX' },
          { papel: 'assistente', texto: 'Encontrei 2 empresas para "Alfa": 1) Alfa Ltda (CNPJ 11.222.333/0001-81); 2) Alfa Distribuidora. Qual delas?' },
          { papel: 'usuario', texto: '11.222.333/0001-81' },
        ],
      },
      deps({ llm }),
    );
    assert.equal(llm.calls, 1);
  });
  it('pedido de gravação continua indo para o modelo (cartão de confirmação)', async () => {
    const llm = llmQueNaoDeveSerChamado();
    await handleChat({ mensagens: [{ papel: 'usuario', texto: 'adicione 2800 de despesas na proposta 4709' }] }, deps({ llm, user: ERP_ONLY }));
    assert.equal(llm.calls, 1);
  });
});

// ============================================================================
// STI-hub — Assistente: base de conhecimento do sistema (telas, tarefas comuns,
// regras de negocio da Seta e diagnostico de erros).
//
// Modulo puro, sem dados de clientes. Serve para duas coisas:
//  1) responder direto, sem modelo e sem consultar nada, perguntas de "como faço",
//     "onde fica", "aceita cartão?", "por que o link não abre?" etc.;
//  2) um resumo curto que vai no prompt de sistema do modelo.
// Para acrescentar um assunto: inclua uma entrada em BASE_CONHECIMENTO com as
// palavras-chave (sem acento, minusculas) e a resposta; o teste cobre o resto.
// ============================================================================
import { normalizarPergunta } from './identificadores';

export interface EntradaConhecimento {
  id: string;
  titulo: string;
  /** Expressoes sem acento e minusculas. Cada uma que aparecer soma o peso. */
  chaves: Array<string | [string, number]>;
  resposta: string;
}

export const BASE_CONHECIMENTO: EntradaConhecimento[] = [
  // ---------------- Regras de negocio da Seta ----------------
  {
    id: 'formas-pagamento',
    titulo: 'Formas de pagamento',
    chaves: [['cartao', 3], ['credito', 2], ['debito', 1], ['forma de pagamento', 3], ['formas de pagamento', 3], ['parcelar no cartao', 3], ['aceita', 1], ['pagar com', 2], ['pix', 1], ['boleto', 1], ['ted', 1]],
    resposta:
      'A Seta aceita só três formas de pagamento: Boleto, Pix e Ted / Transferência. Não aceitamos cartão de crédito nem de débito. No orçamento, escolha uma dessas três no campo "Forma de pagamento".',
  },
  {
    id: 'pdv',
    titulo: 'PDV / venda de balcão',
    chaves: [['pdv', 4], ['venda no balcao', 5], ['balcao', 3], ['ponto de venda', 4], ['frente de caixa', 3], ['cupom', 1], ['nfc-e', 2], ['nfce', 2]],
    resposta:
      'A Seta não usa PDV (venda de balcão). Vendas de produtos são feitas por orçamento em Orçamentos / Propostas → Propostas de Produtos e, depois de aprovadas, viram venda.',
  },
  {
    id: 'locacao-nome',
    titulo: 'Nome "Locação"',
    chaves: [['locacao pura', 5], ['nome da locacao', 3], ['tipo locacao', 2], ['locacao', 1]],
    resposta:
      'O tipo se chama só "Locação" (não use "Locação Pura"). Propostas de locação ficam em Orçamentos / Propostas → Propostas de Locação e, aprovadas, viram contrato em Contratos → Locações.',
  },
  {
    id: 'servico-pontual',
    titulo: 'Serviço pontual (pagamento único)',
    chaves: [['servico pontual', 5], ['pagamento unico', 4], ['valor total', 2], ['/mes', 2], ['por mes', 1], ['sem mes', 3], ['mostra mes', 3], ['avulso', 3]],
    resposta:
      'Serviço pontual (prazo de 1 mês / pagamento único) mostra o valor total, sem "/mês", na lista, no link do cliente, na Versão contrato e no PDF. Despesas como locomoção e hospedagem entram no total. Só serviço mensal e locação mostram "/mês".',
  },
  {
    id: 'setup-locacao',
    titulo: 'Setup na locação',
    chaves: [['setup', 4], ['taxa de instalacao', 3], ['instalacao', 1], ['implantacao', 1], ['mensalidade', 2]],
    resposta:
      'Na locação, o setup é cobrado à parte da mensalidade: aparece como "pagamento único, à parte da mensalidade" e não soma no valor mensal. Em serviço o rótulo é "Serviço" (não "Locação").',
  },
  {
    id: 'rotulo-servico',
    titulo: 'Rótulo de serviço',
    chaves: [['rotulo', 3], ['servico aparece como locacao', 5], ['escrito locacao', 4], ['label', 2]],
    resposta:
      'Em propostas de serviço o rótulo é sempre "Serviço"; "Locação" só aparece em propostas de locação. Se uma proposta de serviço mostrar "Locação", confira o tipo do orçamento (Serviços) na edição.',
  },
  {
    id: 'contrato-produtos',
    titulo: 'Contrato para orçamento de produtos',
    chaves: [['contrato', 1], ['produtos', 1], ['contrato de produto', 5], ['contrato para produto', 5], ['produtos vira contrato', 5], ['converter produto', 4], ['orcamento de produtos', 3], ['venda de produto', 2]],
    resposta:
      'Não existe contrato para orçamento de produtos. Orçamento de produtos aprovado vira venda (Vendas → Produtos). Contrato só existe para locação e serviço mensal.',
  },
  {
    id: 'proposta-vencida',
    titulo: 'Proposta vencida',
    chaves: [['proposta vencida', 4], ['vencida abre', 3], ['abre', 1], ['vencida', 3], ['validade', 3], ['expirou', 3], ['expirada', 3], ['revalidar', 4], ['revalidacao', 4], ['prazo de validade', 4]],
    resposta:
      'Proposta com a validade vencida continua abrindo, mas com um aviso no topo: "Esta proposta está vencida e precisa ser revalidada". Para revalidar, edite o orçamento e atualize a data de validade; o link do cliente volta a valer até a nova data.',
  },
  {
    id: 'versao-contrato',
    titulo: 'Versão contrato (folha interna)',
    chaves: [['versao contrato', 5], ['link interno', 5], ['folha interna', 5], ['interno/proposta', 5], ['versao interna', 4]],
    resposta:
      'A "Versão contrato" (antigo "Link interno") é a folha interna da proposta, em /interno/proposta/<id>. Ela só abre para quem está logado no STI-hub com acesso ao ERP e segue os mesmos valores e regras do link do cliente. Abra pelo botão "Versão contrato" na lista de Orçamentos.',
  },
  {
    id: 'link-cliente',
    titulo: 'Link do cliente (assinado)',
    chaves: [
      ['link do cliente', 5], ['link publico', 5], ['link nao abre', 6], ['nao abre', 4], ['nao localizada', 5], ['nao encontrada', 3], ['link invalido', 5],
      ['copiar link', 4], ['enviar link', 3], ['link da proposta', 4], ['token', 3], ['assinatura do link', 4], ['link expirado', 4], ['link', 1],
    ],
    resposta:
      'O link do cliente só abre com a assinatura dele (o trecho #t=... no fim do endereço). Colar só /proposta/<id>, sem a assinatura, não abre por segurança: a página mostra "Link inválido ou sem permissão" (antes aparecia "não localizada"). Para abrir: na lista de Orçamentos use o botão "Copiar link do cliente" (gera o link assinado) ou abra a proposta pela própria lista. O link também deixa de valer depois da validade da proposta; revalide a data para gerar um novo.',
  },
  {
    id: 'sincronizacao-gc',
    titulo: 'Sincronização com o ERP de origem',
    chaves: [['gestaoclick', 4], ['gestao click', 4], ['gc', 2], ['sincronizacao', 4], ['sincronizar', 4], ['sincronizou', 4], ['sincronizado', 4], ['sync', 4], ['importar do gc', 4], ['nao apareceu', 2]],
    resposta:
      'A sincronização é só de mão única: ERP de origem → STI HUB ERP. Nada do STI HUB volta para o sistema de origem. Registros importados de lá (ex.: orçamentos prop-gc-...) não são editados pelo assistente. Se algo do GC ainda não apareceu, espere a sincronização diária ou peça a um administrador para rodar a sincronização do ERP de origem.',
  },
  {
    id: 'painel',
    titulo: 'Painel (Início)',
    chaves: [['painel', 4], ['dashboard', 4], ['inicio', 1], ['feitas', 2], ['aprovadas', 1], ['faturado', 3], ['taxa de aprovacao', 4], ['recebido', 2], ['saldo bancario', 3]],
    resposta:
      'O Painel (Início do ERP) conta os negócios gerados e faturados no STI-hub, não os do ERP de origem: Feitas = propostas criadas no mês (sem rascunho); Aprovadas = aprovadas ou convertidas; Faturado = faturas emitidas ou pagas pela data de emissão. "Recebido" usa a data de vencimento. Os valores financeiros só aparecem para quem tem alçada financeira. Peça "painel do mês" ou "painel de outubro" que eu mostro os números.',
  },
  {
    id: 'trava-fiscal',
    titulo: 'Trava Fiscal (CNPJs distintos)',
    chaves: [['misturar', 3], ['cnpjs', 3], ['mesma proposta', 2], ['trava fiscal', 6], ['cnpj diferente', 5], ['dois cnpj', 5], ['cnpjs distintos', 5], ['misturar cnpj', 6], ['outro cnpj', 4], ['filial', 3], ['matriz', 3]],
    resposta:
      'Trava Fiscal: nunca misture CNPJs distintos no mesmo documento. Cada proposta, contrato, fatura ou nota pertence a um único CNPJ; matriz e filial são clientes diferentes. Se precisar atender os dois, faça um documento para cada CNPJ.',
  },
  // ---------------- Telas e tarefas comuns ----------------
  {
    id: 'criar-orcamento',
    titulo: 'Criar orçamento / proposta',
    chaves: [['criar orcamento', 5], ['novo orcamento', 5], ['fazer orcamento', 5], ['criar proposta', 5], ['nova proposta', 5], ['fazer proposta', 5], ['montar proposta', 5], ['como faco um orcamento', 6], ['como faco uma proposta', 6]],
    resposta:
      'Para criar: Orçamentos / Propostas → escolha Produtos, Locação ou Serviços → "Novo". Preencha cliente (por nome ou CNPJ), itens, prazo e forma de pagamento (Boleto, Pix ou Ted / Transferência). Eu também posso montar um rascunho: diga, por exemplo, "proposta de locação de 36 meses para <cliente> de 3 servidores Dell R640". O rascunho não é enviado ao cliente.',
  },
  {
    id: 'editar-orcamento',
    titulo: 'Editar orçamento e versões',
    chaves: [['editar', 3], ['alterar', 2], ['editar orcamento', 5], ['editar proposta', 5], ['alterar proposta', 4], ['alterar orcamento', 4], ['versao', 2], ['versoes', 3], ['historico de versoes', 5], ['v2', 2], ['restaurar versao', 5]],
    resposta:
      'Para editar: abra o orçamento na lista de Orçamentos e clique em editar. Cada gravação gera uma nova versão (v1, v2, v3...) com o histórico de valores, itens, prazo e forma de pagamento; dá para ver e restaurar no histórico de versões. Propostas aprovadas, convertidas ou recusadas não são editadas. Eu também edito: "na proposta 4709 adicione 2.800,00 de locomoção".',
  },
  {
    id: 'aprovar-converter',
    titulo: 'Aprovar e converter em contrato',
    chaves: [['aprovar proposta', 5], ['aprovar orcamento', 5], ['converter em contrato', 5], ['virar contrato', 5], ['gerar contrato', 4], ['aceite', 3], ['assinatura digital', 4]],
    resposta:
      'O cliente aprova pelo link assinado (aceite digital) ou você aprova na lista de Orçamentos. Proposta de locação ou serviço mensal aprovada pode ser convertida em contrato (Contratos). Orçamento de produtos aprovado vira venda, não contrato. O assistente não aprova nem converte: faça pela tela.',
  },
  {
    id: 'contratos',
    titulo: 'Contratos, vigência e reajuste',
    chaves: [['contrato', 2], ['vigencia', 4], ['reajuste', 4], ['igp-m', 4], ['igpm', 4], ['ipca', 4], ['ist', 2], ['renovacao', 3], ['fim do contrato', 4], ['vencimento do contrato', 4], ['devolucao parcial', 4]],
    resposta:
      'Contratos ficam em Contratos → Locações, Serviços ou Todos. Cada um mostra início, fim (vigência), prazo em meses, dia de vencimento, valor mensal e o índice de reajuste (IGP-M, IPCA, IST Anatel ou fixo) com o último reajuste. Peça "contrato LOC-2026-101" ou "contratos da <empresa>" que eu mostro a vigência e o reajuste.',
  },
  {
    id: 'faturas',
    titulo: 'Faturas',
    chaves: [['fatura', 3], ['faturas', 3], ['faturar', 3], ['emitir fatura', 5], ['template', 2], ['recibo', 2], ['dar baixa', 4], ['baixa', 2], ['segunda via', 4], ['2 via', 4]],
    resposta:
      'Faturas ficam em Fiscal → Todas as notas e faturas (e no contrato, em Faturamento). A fatura usa o template claro, escolhido no seletor de modelo. Dar baixa (pagamento) exige alçada financeira. O assistente consulta faturas (ex.: "faturas vencidas", "fatura 123"), mas não emite, não envia e não dá baixa.',
  },
  {
    id: 'notas-fiscais',
    titulo: 'Notas fiscais (NF-e, NFS-e, NFCom)',
    chaves: [['nota fiscal', 4], ['notas fiscais', 4], ['notas de servico', 4], ['notas de produtos', 4], ['emitir nota', 5], ['nf-e', 3], ['nfe', 3], ['nfs-e', 3], ['nfse', 3], ['nfcom', 3], ['danfe', 3], ['xml', 2], ['certificado', 3], ['cfop', 3]],
    resposta:
      'Notas ficam em Fiscal: Notas de produtos (NF-e), Notas de serviços (NFS-e) e NFCom (telecom). A emissão exige o certificado A1 configurado em ERP → Configurações fiscais. O assistente consulta notas pelo número ou chave, mas não emite: emita pela tela Fiscal.',
  },
  {
    id: 'ordens-servico',
    titulo: 'Ordens de serviço',
    chaves: [['ordem de servico', 4], ['ordens de servico', 4], [' os ', 3], ['abrir os', 5], ['nova os', 5], ['laudo', 3], ['tecnico', 2], ['duplicar os', 4], ['status da os', 4]],
    resposta:
      'Ordens de serviço ficam em Ordens de serviços → Gerenciar O.S. (e o Painel de O.S.). Lá você abre, muda a situação, duplica e gera o PDF com o laudo. Eu abro uma OS "Em aberto" (ex.: "abra uma OS para <cliente>: troca de fonte") e consulto pelo número (ex.: "OS 1203").',
  },
  {
    id: 'chamados',
    titulo: 'Chamados (STI HUB Desk Service)',
    chaves: [['chamado', 3], ['chamados', 3], ['ticket', 3], ['desk', 3], ['service desk', 4], ['sla', 3], ['jira', 3], ['abrir chamado', 5], ['suporte', 1]],
    resposta:
      'Chamados ficam no STI HUB Desk Service (módulo Chamados). Cada um tem chave (ex.: SETA-123), prioridade, SLA e responsável. Eu consulto pela chave ou pelo assunto e abro chamados novos (com confirmação). Se você não tem o módulo Chamados liberado, não consigo ver nem abrir.',
  },
  {
    id: 'estoque-produtos',
    titulo: 'Produtos, serviços e estoque',
    chaves: [['estoque', 4], ['produto', 2], ['produtos', 2], ['catalogo', 3], ['cadastrar produto', 5], ['item', 1], ['itens', 1], ['equipamento', 2], ['saldo', 2], ['sku', 3], ['ncm', 3]],
    resposta:
      'Produtos e serviços ficam em Itens (Todos os itens, Produtos, Serviços); o estoque em Estoque → Movimentações. Cada item tem preço de locação mensal, preço de venda/setup, estoque disponível e em clientes. Peça "estoque do Dell R640" ou "produtos sem estoque" que eu consulto.',
  },
  {
    id: 'financeiro',
    titulo: 'Financeiro',
    chaves: [['financeiro', 4], ['contas a receber', 5], ['contas a pagar', 5], ['a receber', 3], ['a pagar', 3], ['fluxo de caixa', 4], ['dre', 3], ['inadimplencia', 4], ['inadimplente', 4], ['inadimplentes', 4], ['conciliacao', 3], ['ofx', 3], ['banco', 2]],
    resposta:
      'Financeiro → Contas a receber, Contas a pagar, DRE gerencial e Fluxo de caixa. Só quem tem alçada financeira vê os valores. Eu consulto "contas a receber vencidas", "contas a pagar deste mês" etc. (só leitura, sem baixa).',
  },
  {
    id: 'cadastros',
    titulo: 'Clientes e fornecedores',
    chaves: [['cadastrar cliente', 5], ['novo cliente', 5], ['cliente', 1], ['fornecedor', 3], ['fornecedores', 3], ['cadastro', 2], ['consulta cnpj', 4], ['receita federal', 3], ['razao social', 3], ['nome fantasia', 3]],
    resposta:
      'Clientes e fornecedores ficam em Cadastros (Clientes, Fornecedores, Transportadoras). Ao cadastrar, digite o CNPJ que o sistema busca razão social e endereço. Eu acho clientes e fornecedores pelo nome (mesmo parcial ou sem acento), CNPJ/CPF, e-mail ou telefone.',
  },
  {
    id: 'crm-negocios',
    titulo: 'Negócios do CRM x orçamentos',
    chaves: [['negocio', 3], ['negocios', 3], ['funil', 3], ['pipeline', 3], ['crm', 2], ['deal', 3]],
    resposta:
      'Negócios ficam no STI HUB CRM (funil de vendas). Orçamentos/propostas ficam no ERP; uma proposta pode criar ou ficar ligada a um negócio. Para ver orçamentos, peça "orçamentos" ou "proposta 4709"; para o funil, "negócios do CRM".',
  },
  // ---------------- Diagnostico de erros ----------------
  {
    id: 'erro-permissao',
    titulo: 'Sem permissão / acesso negado',
    chaves: [['sem permissao', 6], ['permissao negada', 6], ['acesso negado', 6], ['nao tenho acesso', 6], ['403', 4], ['nao consigo ver', 3], ['bloqueado', 2], ['alcada', 3]],
    resposta:
      '"Sem permissão" quer dizer que o seu perfil não libera aquele módulo ou ação (ex.: ERP, Chamados ou alçada financeira). O assistente segue as mesmas permissões da tela. Peça a um administrador (Configurações → Usuários e permissões) para liberar o módulo ou a alçada.',
  },
  {
    id: 'erro-sessao',
    titulo: 'Sessão expirada / 2FA',
    chaves: [['sessao expirou', 6], ['expirou', 1], ['sessao expirada', 6], ['sessao', 2], ['401', 4], ['deslogou', 4], ['login', 2], ['2fa', 4], ['mfa', 4], ['autenticador', 4], ['codigo de verificacao', 4], ['senha', 2]],
    resposta:
      'Sessão expirada (401) ou pedido de 2FA: entre de novo no STI-hub e confirme o código do aplicativo autenticador. Se perdeu o autenticador ou a senha, use "Esqueci a senha" na tela de login ou peça a um administrador. Nunca envie senha ou código aqui no chat.',
  },
  {
    id: 'erro-nao-localizado',
    titulo: 'Registro não localizado',
    chaves: [['nao localizado', 5], ['nao localizada', 5], ['nao encontrado', 5], ['nao encontrei', 4], ['sumiu', 4], ['desapareceu', 4], ['nao aparece', 4], ['nao acho', 4]],
    resposta:
      'Quando algo "não é localizado", normalmente é: (1) link colado sem a assinatura do cliente (use "Copiar link do cliente" na lista); (2) seu perfil só vê os registros da sua carteira; (3) registro do ERP de origem ainda não sincronizado; ou (4) número digitado diferente. Me mande o número, o código prop-..., o link, o CNPJ ou o nome do cliente que eu procuro em todo o sistema.',
  },
  {
    id: 'assistente-escopo',
    titulo: 'O que o assistente faz',
    chaves: [['o que voce faz', 6], ['o que voce sabe', 6], ['o que voce consegue', 6], ['ajuda', 2], ['como usar', 4], ['comandos', 4], ['o que posso perguntar', 6], ['voce consegue', 3]],
    resposta:
      'Eu procuro qualquer registro pelo número, código prop-..., link colado, CNPJ/CPF, e-mail, telefone ou nome: orçamentos, contratos, faturas, notas, OS, chamados, clientes, fornecedores e produtos. Também mostro listas e relatórios (ex.: "faturas vencidas", "contas a receber do mês passado", "painel de outubro", "estoque do R640"), monto rascunho de proposta, edito proposta, abro OS e chamado. Toda ação passa pelo seu "Confirmar". Não emito nota, não envio e-mail/WhatsApp, não excluo registros nem mudo permissões.',
  },
];

const PERGUNTA_RE =
  /^(como|onde|posso|pode|podemos|aceita|aceitam|aceitamos|existe|tem como|da pra|da para|o que|oque|pra que|para que|por que|porque|pq|e possivel|devo|a seta|voce)\b|\b(como (faco|fazer|vejo|ver|crio|criar|gero|gerar|edito|editar|abro|abrir|envio|enviar|copio|copiar|revalido|revalidar|funciona)|o que (e|significa|quer dizer)|por que|porque|pq)\b/;

/** Pontuacao de uma entrada para o texto normalizado (palavras inteiras). */
function pontuar(texto: string, e: EntradaConhecimento): number {
  const t = ` ${texto} `;
  let total = 0;
  for (const c of e.chaves) {
    const [frase, peso] = Array.isArray(c) ? c : [c, 1];
    const f = frase.trim();
    if (!f) continue;
    const re = new RegExp(`(^|[^a-z0-9])${f.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=$|[^a-z0-9])`);
    if (re.test(t)) total += peso;
  }
  return total;
}

export interface RespostaConhecimento {
  entrada: EntradaConhecimento;
  pontos: number;
}

/** Melhor assunto da base para a pergunta (ou null). minimo = pontos necessarios. */
export function buscarConhecimento(texto: string, minimo = 4): RespostaConhecimento | null {
  const t = normalizarPergunta(texto);
  if (!t) return null;
  let best: RespostaConhecimento | null = null;
  for (const e of BASE_CONHECIMENTO) {
    const p = pontuar(t, e);
    if (p >= minimo && (!best || p > best.pontos)) best = { entrada: e, pontos: p };
  }
  return best;
}

/** Parece pergunta de "como/onde/pode/por que" (e nao pedido de dados)? */
export function pareceDuvida(texto: string): boolean {
  return PERGUNTA_RE.test(normalizarPergunta(texto));
}

/** Resposta pronta para uma duvida sobre o sistema, ou null se nao for duvida conhecida. */
export function responderConhecimento(texto: string): string | null {
  if (!pareceDuvida(texto)) return null;
  const r = buscarConhecimento(texto);
  return r ? r.entrada.resposta : null;
}

/** Resumo para o prompt de sistema: uma linha por assunto (sem dados de clientes). */
export function resumoConhecimentoParaPrompt(): string {
  return BASE_CONHECIMENTO.map((e) => `- ${e.titulo}: ${e.resposta}`).join('\n');
}

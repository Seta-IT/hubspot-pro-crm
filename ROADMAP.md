# ROADMAP OFICIAL — STI-hub | Seta Telecom CRM & ERP (`SETA | IT`)

> Documento mestre de diretrizes arquiteturais, operacionais, fiscais, comerciais e de segurança corporativa aprovadas por **Marcéllo Mira** para a plataforma **STI-hub (`/workspace/hubspot-pro-crm`)**, integrando o **ERP Seta Telecom (GestãoClick Loja Matriz `#118887` — `ERP-GROK`)** e o **CRM Enterprise (HubSpot Portal `4369067`)**.

---

## Seção 1 — Identidade `STI-hub`, UX/UI Clean, Drill-Down Total & Sidebar `SETA | IT`

1. **Identidade Visual & Branding Oficial (`STI-hub`)**:
   - Nome oficial unificado da plataforma: **`STI-hub | Seta Telecom CRM & ERP`** com selo **`SETA | IT`** (`#0d2b4e` + `#f26522`) na barra global superior (`#213343`).
   - Indicador em tempo real da conexão ao vivo com **GestãoClick ERP-GROK (`Matriz #118887 • MCP Online`)** e **HubSpot (`Portal #4369067`)**.
2. **UX/UI Clean com Gráficos, Flashcards e Badges 100% Clicáveis (Drill-Down)**:
   - Todos os 5 flashcards financeiros do topo (Saldo disponível, A receber hoje, A pagar hoje, Recebido no mês, Pago no mês), os gráficos SVG de **Fluxo de Caixa** e **Vendas Mensais**, as **Contas Bancárias**, a **Agenda de O.S.**, os **12 Aplicativos** e os **Indicadores de Base Sincronizada** possuem ação de clique direta (`onOpenSection(section, subId)`) que abre imediatamente a tela/listagem detalhada correspondente.
   - No CRM, todos os badges do sub-header (`Contatos`, `Empresas`, `Forecast`, `Saúde da Base`, `Service Desk`) e os cards de forecast do Kanban executam drill-down imediato.
3. **Sidebar `SETA | IT` Sempre Visível no Módulo ERP (12 Categorias Oficiais + Início)**:
   - Árvore de navegação lateral fixa e colapsável (`src/app/components/GestaoClickSidebar.tsx`) espelhando exatamente a estrutura operacional da Seta Telecom no GestãoClick:
     1. **Início (Visão Geral)**
     2. **Cadastros** (`Clientes`, `Fornecedores`, `Funcionários`, `Transportadoras`, `Opções auxiliares`)
     3. **Itens** (`Produtos`, `Serviços`, `Opções auxiliares`)
     4. **Orçamentos** (`Produtos`, `Serviços`, `Opções auxiliares`)
     5. **Vendas** (`Produtos`, `Serviços`, `Balcão / PDV`, `Devoluções`, `Opções auxiliares`)
     6. **Ordens de serviços** (`Gerenciar O.S.`, `Painel`, `Opções auxiliares`)
     7. **Estoque** (`Movimentações`, `Ajustes`, `Transferências`, `Cotações`, `Compras`, `Opções auxiliares`)
     8. **Financeiro** (`Contas a pagar`, `Contas a receber`, `DRE gerencial`, `Fluxo de caixa`, `Boletos bancários`, `Opções auxiliares`)
     9. **Fiscal** (`Notas de produtos`, `Notas de serviços`, `Notas do consumidor`, `Notas de compras`, `Opções auxiliares`)
     10. **Contratos** (`Serviços`, `Locações`, `Assinaturas`, `Opções auxiliares`)
     11. **Atendimentos**
     12. **Relatórios** (`Cadastros`, `Vendas`, `Ordens de serviços`, `Estoque`, `Financeiro`, `Contratos`, `Fiscal`, `Personalizados`, `Logs do sistema`)
     13. **Configurações** (`Gerais`, `Meu plano`, `Usuários`, `Dados da empresa`, `Marca da empresa`, `Empresas / Lojas`, `Certificado digital`, `Modelos de e-mails`, `Avisos por e-mail`)

---

## Seção 2 — Matriz Inicial SETA ERP (10 Pilares Sem Redundância)

Arquitetura enxuta e completa do ERP (`src/app/components/SetaErpTenPillarsAndPdv.tsx` e `src/app/components/ErpGestaoClickTab.tsx`), estruturada em **10 pilares operacionais sem sobreposição**:

1. **Pilar 1 — Cadastros (`1.184 Clientes • 101 Fornecedores • 14 Funcionários`) + Trava Fiscal Obrigatória de CNPJ**:
   - Gestão unificada de Clientes PJ/PF, Fornecedores, Funcionários e Transportadoras.
   - **Trava Fiscal Obrigatória de CNPJ (`haveConflictingCnpjs` + `detectProtectedBranchCompanies`)**: Empresas com CNPJs preenchidos e distintos (ex.: Matriz `/0001-XX` e Filial `/0002-XX` ou empresas do mesmo grupo econômico compartilhando domínio corporativo) **JAMAIS** são marcadas como duplicadas e têm qualquer tentativa de merge bloqueada com erro `400 Bad Request` na API (`POST /api/data-health/merge`) e selo de proteção fiscal na UI.
2. **Pilar 2 — Produtos e Serviços (`786 Produtos • 39 Serviços`)**:
   - Catálogo técnico de equipamentos Telecom/TI (PABX IP, Gateways E1/SIP, Aparelhos IP Yealink/Intelbras, Switches PoE, Firewalls SD-WAN, Roteadores, Headsets, Licenças Cisco) com código SKU GestãoClick, NCM, controle por Número de Série (`S/N`) e Serviços Técnicos NOC/Engenharia (Item `01.07` LC 116/03).
3. **Pilar 3 — Propostas e Vendas (`2.077 Orçamentos • 295 Vendas` + Editor 9 Blocos `#4695` + `/proposta/[id]` PDF A4)**:
   - Editor completo de Propostas Comerciais no padrão GestãoClick `#4695` (9 blocos estruturados: Cabeçalho/Status, Cliente/Decisor, Prazo/Vigência/Índice de Reajuste, Itens de Locação/Venda/Serviço, Resumo Financeiro MRR/TCV, Condições de Pagamento/Parcelas, Cláusulas Técnicas/SLA, Observações Comerciais e Ações).
   - Geração instantânea de **Link Público Permanente (`/proposta/[id]`)** para o cliente visualizar e imprimir a Proposta Comercial em formato A4 timbrado (`?print=1`), além de aprovação em 1 clique que converte em Contrato de Locação e Fatura.
4. **Pilar 4 — Estoque e Compras (`S/N Ativos • 54 Pedidos de Compra`)**:
   - Controle de Movimentações de Estoque, Ajustes de Inventário, Transferências entre Almoxarifados/Clientes, Cotações de Fornecedores e Ordens de Compra (`ErpPurchaseOrder` — CAPEX CFOP `1.551` / Revenda CFOP `1.102`).
5. **Pilar 5 — Contratos e Locações (`344 Contratos Ativos` + Patrimônio `S/N` + Reajuste `IPCA / IGP-M / IST Anatel`)**:
   - Gestão do ciclo de vida dos Contratos de Locação de Equipamentos (`ErpRentalContract`), Serviços e Assinaturas.
   - Vinculação individual de equipamentos por Número de Série (`S/N`) e Tag de Patrimônio, fluxo de substituição **RMA / Advance Replacement** (`EM_CLIENTE`, `MANUTENCAO_RMA`, `DEVOLVIDO`), renovação automática de vigência (`+12m`) e aplicação de reajuste anual auditado (`IPCA`, `IGP-M`, `IST_ANATEL` ou `FIXO`).
6. **Pilar 6 — Financeiro (`Contas a Pagar/Receber + Bancos Inter/Itaú/Integrada + Fluxo de Caixa + DRE`)**:
   - Painel bancário com as 9 contas da Seta Telecom (`Banco Inter`, `Itaú Seta`, `Conta Integrada`, `Caixinha`, `Seta Imp`, `Inter Aplicações`, etc. — Saldo disponível `R$ 2,20M`).
   - Contas a Receber (`153 títulos`) e Contas a Pagar (`43 títulos`), baixa de lançamentos, geração de Boleto Registrado + QR Code PIX Copia-e-Cola, Fluxo de Caixa mensal e **DRE Gerencial**.
7. **Pilar 7 — Fiscal & Tributário Brasileiro (`0% ISS SV 31 STF + NFS-e IRRF/CSRF + NF-e CFOP 5.908 + NFC-e + NFCom`)**:
   - **Fatura / Recibo de Locação Pura de Bens Móveis (`FATURA_LOCACAO`)**: Alíquota **0% de ISSQN** amparada pelo Veto Presidencial ao item 3.01 da **LC 116/2003** e pela **Súmula Vinculante nº 31 do STF**, sem retenção de IRRF/CSRF (IN RFB 1.234/12), gerando economia tributária auditada (`kpis.issSavedBySv31Stf`).
   - **NFS-e de Serviços Técnicos (`NFSE_SERVICO` — Item 01.07 LC 116/03)**: Cálculo automático de ISS municipal (2,90%) e retenções federais na fonte (**IRRF 1,5%** + **CSRF 4,65%** = PIS 0,65% + COFINS 3% + CSLL 1%).
   - **NF-e de Remessa em Locação (`NFE_REMESSA_LOCACAO` — Modelo 55)**: CFOP **`5.908 / 6.908`** (CST ICMS `041` não tributado, CST PIS/COFINS `08` sem incidência) para trânsito legal de equipamentos do ativo imobilizado até o cliente.
   - **NF-e de Venda (`5.102`), NFC-e Consumidor (`Modelo 65`) e NFCom Telecom (`Modelo 62` — SCM Anatel)** com espelho DANFE/Fatura pronto para impressão PDF.
8. **Pilar 8 — Ordens de Serviço (O.S.) e Suporte NOC (`1.378 O.S. • SLA 94%`)**:
   - Gestão completa de Ordens de Serviço de Instalação, Manutenção Preventiva/Corretiva, Mudança de Endereço e RMA, integradas diretamente aos chamados técnicos do **Service Desk (JSM)** em 1 clique.
9. **Pilar 9 — PDV / Frente de Caixa Balcão (`VENDAS_BALCAO` com Pix, NFC-e e Fechamento de Caixa)**:
   - Frente de caixa dedicada (`SetaErpPdvBalcaoView`) para venda rápida de balcão (cabos, fontes PoE, headsets, patch cords, adaptadores), carrinho ágil, cálculo de desconto/troco, pagamento via **PIX QR Code / Cartão / Dinheiro**, emissão imediata de **Cupom Fiscal NFC-e (Mod. 65)** e **Conferência / Fechamento de Turno de Caixa**.
10. **Pilar 10 — Integrações Ao Vivo & Copiloto IA (`ERP-GROK #118887 + HubSpot 4369067 + MCP`)**:
    - Conector bidirecional ao vivo com a API REST e Servidor MCP do GestãoClick (`src/modules/erp/gestaoclick-client.ts`) e sincronização nativa com o HubSpot CRM (`4369067`), assistidos pelo Copiloto IA Executivo.

---

## Seção 3 — Estrutura Completa do CRM (Marketing Hub + Sales Hub + Service Hub + Custom Properties HubSpot `4369067`)

1. **Sales Hub (`DEALS_KANBAN` + `CONTACTS_COMPANIES` + `HubSpotTasksQueueView`)**:
   - **Funil Comercial Multi-Pipeline**: Pipeline Enterprise B2B e Locação Recorrente com cálculo automático de MRR, TCV, prazo contratual, probabilidade por estágio, *Deal Rotting* (negócios estagnados acima do SLA da etapa) e geração de Proposta Comercial `#4695` diretamente do card do negócio.
   - **Visão 360º de Contatos e Empresas (`ContactDetailDrawer`)**: Timeline unificada (Notas, E-mails, Chamadas, Reuniões, Tarefas, Enriquecimento, Propostas e Faturas), Composer de E-mail embutido no card (`HubSpotCardEmailComposer`) e Fila de Tarefas (`Follow-up Comercial`, `Prospecção ABM Tier 1`, `Renovação & CS`).
   - **Custom Properties Oficiais do HubSpot (`Portal 4369067`)**:
     - Em **Contatos**: `buyingRole` (Papel no Comitê de Compras: `DECISION_MAKER`, `BUDGET_HOLDER`, `CHAMPION`, `TECHNICAL_EVALUATOR`, `INFLUENCER`, `END_USER`, `BLOCKER`), `ownerName` (Proprietário Seta Telecom), `isUnworked` (Lead não trabalhado), `leadScore`, `completenessScore`, `seniority`, `department`.
     - Em **Empresas**: `isTargetAccount` (Conta-Alvo ABM), `icpTier` (`TIER_1`, `TIER_2`, `TIER_3`), `cnpj` validado em Módulo-11, `annualRevenue`, `industry`, `completenessScore`.
     - Em **Deals**: `dealType` (`NEW_BUSINESS`, `LOCACAO_RECORRENTE`, `UPSELL_RENOVACAO`), `priority` (`ALTA`, `MEDIA`, `BAIXA`), `mrr`, `contractMonths`, `ownerName`.
2. **Marketing Hub (`MARKETING_FORMS` + `AUTOMATIONS`)**:
   - **Construtor Dinâmico de Formulários Web (`/api/forms`, `/api/forms/submit`)**: Criação de formulários com campos customizados, código embed JS, simulador com presets executivos, exportação CSV de submissões e conversão automática em Contato + Empresa enriquecida + Deal ou Ticket JSM.
   - **Motor de Workflows & Cadências (`Sequences`)**: Gatilhos automáticos (`CONTACT_CREATED`, `DEAL_STAGE_CHANGED`, `SCORE_THRESHOLD`, `FORM_SUBMITTED`) e sequências de e-mail com pausa automática imediata quando o cliente responde (`PAUSED_ON_REPLY`).
   - **Migrador Nativo HubSpot CRM v3 (`/api/migration/hubspot`)**: Importação em 1 clique de Empresas, Contatos, Deals e Tickets com enriquecimento e higienização automática.
3. **Service Hub & NOC Telecom (`SERVICE_DESK` + Portal Externo do Cliente `/portal`)**:
   - **Service Management (JSM)**: Filas de suporte escalonadas (**NOC N1, N2, N3**, Field Service RMA e Faturamento), motor dinâmico de SLA em tempo real (`ON_TRACK`, `AT_RISK`, `BREACHED`), separação estrita entre **Notas Técnicas Internas (`isInternal: true`)** e **Respostas Públicas ao Cliente**, conversão de ticket em **O.S. no GestãoClick** e pesquisa **CSAT**.
   - **Portal Externo do Cliente (`/portal` e `/api/portal/tickets`)**: Interface dedicada para clientes consultarem seus protocolos, abrirem chamados com SLA, responderem ao NOC (sem visualizar notas internas) e avaliarem o atendimento (CSAT).

---

## Seção 4 — Envio Validado de E-mails, Modelos Dinâmicos & Matriz Granular de Permissões (RBAC)

1. **Disparo Validado de E-mails & Modelos Dinâmicos (`ClientEmailComposerModal` + `HubSpotCardEmailComposer`)**:
   - **Central de Disparo ERP/CRM (`/api/communications/send-email` e `/api/emails/send`)**:
     - Suporte a envio transacional via **Resend HTTP Relay (`RESEND_API_KEY`)** ou registro auditado com protocolo único (`STI-MAIL-...`), gravação automática na Timeline do Contato/Empresa/Deal, comentário no Ticket e criação opcional de **Tarefa de Follow-up** em `+1, +2, +3 ou +7 dias`.
   - **5 Templates Transacionais ERP (`ClientEmailComposerModal`)**:
     1. `PROPOSAL`: Proposta Comercial / Orçamento com link público PDF A4 (`/proposta/[id]`).
     2. `TICKET_REPLY`: Atualização técnica de chamado / O.S. com status de SLA.
     3. `BOLETO`: Boleto Bancário Registrado (Inter/Itaú) + código PIX Copia-e-Cola.
     4. `RENTAL_RECEIPT`: Fatura / Recibo de Locação com cláusula fiscal de 0% ISS (LC 116/03 + SV 31 STF).
     5. `FISCAL_INVOICE`: DANFE NF-e (Venda / Remessa CFOP 5.908) ou NFS-e Nacional.
   - **Modelos Dinâmicos de E-mail (`/api/email-templates`) e Snippets Rápidos (`/api/snippets`)**:
     - Interpolação automática de variáveis (`{{contact.firstName}}`, `{{contact.fullName}}`, `{{contact.jobTitle}}`, `{{company.name}}`, `{{deal.title}}`, `{{sender.name}}`) e expansão de atalhos `#snippet` diretamente nos cards de Contatos, Empresas e Deals.
     - Gerenciamento completo de modelos de e-mail também disponível em **Configurações > Modelos de e-mails (`CFG_EMAILS`)**.
2. **Matriz Granular de Permissões por Usuário e Perfil — RBAC Unificado ERP + CRM (`⚙️ Administração STI-hub` / `CFG_USUARIOS`)**:
   - **Perfis de Acesso Oficiais (9 Perfis RBAC)**:
     1. `SUPER_ADMIN` — Diretoria / Super Admin STI-hub (Acesso irrestrito ERP + CRM + Configurações + Auditoria)
     2. `DIRETORIA_COMERCIAL` — Diretoria Comercial & Revenue Operations
     3. `EXECUTIVO_VENDAS` — Executivo de Contas / Closer B2B (Sales Hub + Propostas ERP)
     4. `SDR_PRE_VENDAS` — Pré-Vendas / SDR & Marketing Hub
     5. `FINANCEIRO_FATURAMENTO` — Financeiro, Faturamento, Contratos & Cobrança
     6. `FISCAL_CONTABIL` — Fiscal, Tributário & Emissão NF-e / NFS-e / Fatura SV 31
     7. `ENGENHARIA_NOC` — Engenharia Telecom, NOC N1/N2/N3 & Service Desk JSM
     8. `TECNICO_CAMPO_OS` — Field Service, O.S., RMA & Almoxarifado/Estoque
     9. `ATENDIMENTO_PDV` — Operador de Atendimento & Frente de Caixa (PDV Balcão)
   - **22 Usuários Sincronizados (GestãoClick Loja `#118887` + Equipe HubSpot `4369067`)**:
     - Inclui **Marcéllo Lopes Mira** (`SUPER_ADMIN`), **Evelyn Olivia de Rosa Ternero** (`FINANCEIRO_FATURAMENTO` / `DIRETORIA_COMERCIAL`), **Michelle da Rocha** (`EXECUTIVO_VENDAS`), além dos demais especialistas comerciais, técnicos NOC, campo, financeiro e fiscal da Seta Telecom.
   - **Escopo de Visibilidade de Dados por Módulo**:
     - `TODOS` (visualiza e opera registros de toda a empresa), `EQUIPE` (registros do seu departamento/fila) ou `PROPRIOS` (apenas negócios/contatos/O.S. atribuídos ao próprio `ownerName`).
   - **Travas Granulares de Ação (`Action Guards`)**:
     - Controle individual por usuário/perfil para: `canViewFinancialBalances` (ver saldos bancários e DRE), `canIssueFiscalDocuments` (emitir Fatura SV 31 / NFS-e / NF-e), `canApproveProposals` (converter proposta em contrato), `canMergeRecords` (executar merge/auto-clean no Data Health), `canDeleteRecords` (excluir registros no CRM/ERP), `canExportData` (exportar CSV/relatórios) e `canManageUsersRbac` (alterar permissões de usuários).

---

## Seção 5 — Segurança Corporativa: Tela de Login com MFA, Proteção Total de Rotas, RBAC por Usuário e Subdomínio

1. **Tela de Login Corporativa (`/login`) com Etapa Obrigatória de MFA (2FA 6 Dígitos)**:
   - **Etapa 1 — Credenciais Corporativas Seta Telecom**: Autenticação por e-mail corporativo (`@setatelecom.com.br`) e senha, com validação contra a base de usuários ativos do RBAC STI-hub.
   - **Etapa 2 — Verificação Multifator Obrigatória (MFA / 2FA)**: Solicitação de código de 6 dígitos (TOTP Autenticador / Código enviado por E-mail Corporativo) antes de liberar a sessão.
   - **Sessão Criptografada / Cookie HttpOnly**: Emissão de token de sessão assinado gravado em cookie `HttpOnly` (`stihub_session`, `SameSite=Lax`, `Path=/`) contendo `userId`, `email`, `name`, `role`, `scope` e `mfaVerified: true`, além de rota de encerramento de sessão (`POST /api/auth/logout`).
2. **Proteção Total das Rotas do Sistema e APIs (`src/middleware.ts` + Auth Guard)**:
   - **Next.js Edge Middleware (`src/middleware.ts`)**: Intercepta todas as requisições web e chamadas `/api/*`:
     - **Rotas Públicas Permitidas Sem Login**:
       - `/login` (Tela de Login + MFA da Seta Telecom)
       - `/api/auth/*` (`/api/auth/login`, `/api/auth/verify-mfa`, `/api/auth/session`, `/api/auth/logout`)
       - `/proposta/[id]` e `GET /api/erp/proposals/:id` (Visualização e impressão pública do PDF A4 da Proposta Comercial enviada ao cliente)
       - `/api/health` (Healthcheck de infraestrutura para monitoramento Vercel/Railway/Docker)
     - **Bloqueio Automático**: Qualquer acesso não autenticado (ou sem `mfaVerified`) às páginas protegidas (`/`, `/portal`, etc.) redireciona imediatamente para `/login?next=...`, e qualquer chamada direta às APIs protegidas (`/api/*`) sem sessão válida (ou header interno de teste automatizado) retorna `401 Unauthorized`.
3. **Permissões por Usuário Aplicadas em Tempo Real (RBAC Ativo na Sessão)**:
   - O usuário autenticado no topo do STI-hub (`Marcéllo Mira` ou qualquer um dos 22 colaboradores da Seta Telecom) tem seu perfil RBAC, escopo (`TODOS` / `EQUIPE` / `PROPRIOS`) e travas de ação aplicados tanto na interface (`⚙️ Administração STI-hub` e `Configurações > Usuários`) quanto nas rotas de mutação da API.
4. **Subdomínio Oficial Configurado (`sti-hub.vercel.app` + Subdomínio Customizado Seta Telecom)**:
   - **Subdomínio Padrão em Produção (Vercel)**: `https://sti-hub.vercel.app`.
   - **Subdomínios Corporativos Seta Telecom**: Suporte e painel de configuração para `https://stihub.setatelecom.com.br` e `https://erp.setatelecom.com.br` com instruções DNS **`CNAME -> cname.vercel-dns.com`**, verificação de status SSL/TLS e geração de links públicos de propostas (`/proposta/[id]`) respeitando automaticamente o domínio oficial configurado (`NEXT_PUBLIC_APP_URL` / host ativo).

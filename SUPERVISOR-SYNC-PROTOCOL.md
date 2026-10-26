# Protocolo Oficial de Governança e Sincronização entre Supervisores (STI-hub)

**Projeto:** STI-hub — Seta Telecom LTDA (`CNPJ 14.806.925/0001-32` • Loja Matriz `#118887` • HubSpot Portal `#4369067`)  
**Domínio Oficial em Produção:** [https://sti-hub.vercel.app](https://sti-hub.vercel.app)

---

## 1. Estrutura de Supervisão Dupla (Separação Estrita de Escopos)

| Agente Supervisor | ID do Agente | Escopo Exclusivo de Governança | Documento Mestre |
| :--- | :--- | :--- | :--- |
| **ERP - Supervisor & Roadmap** | `030e3bff-e30f-4e10-b854-fb85ce5a9f1e` | **SETA ERP (10 Pilares Operacionais e Fiscais):** 1. Cadastros (Clientes, Fornecedores, Funcionários, Transportadoras com Consulta RFB e Trava Fiscal de CNPJ), 2. Produtos e Serviços (786 produtos + 39 serviços), 3. Propostas e Vendas (Orçamento fiel ao `#4695`, Link Público `/proposta/[id]`, Assinatura ICP-Brasil/Gov.br), 4. Estoque e Compras (S/N, MAC, Importação XML NF-e Mod. 55), 5. Contratos de Locação (344 contratos, 0% ISS SV 31 STF, Devolução Parcial Pro-Rata), 6. Financeiro (Contas a Pagar/Receber, Conciliação OFX Banco Inter `077` / Itaú `341`, DRE Vertical), 7. Fiscal (Fatura SV 31, NFS-e LC 116, NF-e CFOP `5.908`/`6.908`, NFCom Mod. 62), 8. O.S. de Campo (1.378 O.S.), 9. PDV Frente de Caixa, 10. Integração e Sincronização Diária GestãoClick (`/api/erp/daily-sync`). | `ROADMAP-ERP.md` |
| **CRM - Supervisor & Roadmap** | `4d90e47d-e25a-4bd0-bc88-b8b8058cc78b` | **CRM, Chamados & Plataforma Corporativa:** Contatos & Empresas B2B (com ficha GestãoClick, Consulta CNPJ RFB e proteção contra exclusão na listagem), Sales Hub (Funil Kanban 4 pipelines, Forecast, Quotas, Playbooks, Meetings, Sequências), Marketing Hub (Campanhas ABM, Segmentos, Lead Scoring, Formulários), Item de Topo 3: Chamados (Service Hub NOC N1/N2/N3 SLA), Automações (Workflows), Saúde da Base (Data Health com trava anti-merge de CNPJ), Custom Properties (`#4369067`), Modelos/Validação de E-mail (`SPF/DKIM/DMARC`), Matriz Granular RBAC (9 perfis e 22 usuários), Login Corporativo com MFA 2FA (`/login`), Proteção de Rotas (`src/middleware.ts`) e Subdomínio Vercel (`sti-hub.vercel.app`). | `ROADMAP-CRM.md` |
| **STI-hub - Coordenador Geral (Histórico & Ponte ERP-CRM)** | `7aeb7dd8-c371-4542-8182-04ea61c5e098` | **Guardião Histórico & Árbitro de Integração:** preserva integralmente o histórico consolidado do projeto e atua exclusivamente como ponte/árbitro em contratos compartilhados entre ERP e CRM. | `ROADMAP.md` |

---

## 2. Hierarquia da Linha Principal do Sistema (3 Itens de Topo, Zero Emojis)

Toda a navegação principal do **STI-hub** obedece estritamente aos **3 itens de topo** com visual 100% corporativo e sem emojis:

1. **CRM**
   - Visão Geral & IA
   - Contatos & Empresas (Padrão GestãoClick + Consulta CNPJ Receita Federal + Exclusão restrita ao cadastro aberto com dupla confirmação)
   - Sales Hub (Funil Kanban de 4 Pipelines, Metas/Quotas, Playbooks, Reuniões e Sequências)
   - Marketing Hub (Formulários, Campanhas ABM, Segmentos e Lead Scoring)
   - Automações (Workflows Visuais e Sequências)
   - Data Health (Auditoria Base CRM & Base ERP com Trava Fiscal de CNPJ)
   - Administração & Configurações (Matriz RBAC 9 Perfis / 22 Usuários, Dados da Empresa, Certificado Digital A1 & Séries NF, Modelos de E-mail, Custom Properties `#4369067`, Sincronização Diária ERP & Logs, Homologação dos 11 Módulos e Segurança MFA/Subdomínio)
2. **ERP**
   - Sidebar fixa `SETA | IT` + 10 Pilares da Matriz SETA ERP (Cadastros, Produtos e Serviços, Propostas e Vendas, Estoque e Compras, Contratos e Locações, Financeiro, Fiscal, OS e Suporte, PDV Frente de Caixa e Integrações ERP) + Relatórios e Configurações.
3. **Chamados**
   - Service Desk & NOC Seta Telecom (Filas N1, N2 e N3, SLA Dinâmico em Tempo Real, Abertura de O.S. integrada ao ERP e Portal Externo do Cliente).

---

## 3. Rotina Diária de Sincronização entre Supervisores ERP e CRM

- **Nome da Rotina:** `Sincronização Diária Supervisores ERP e CRM (STI-hub)`
- **Frequência:** Dias úteis às **08h30 EDT** (janela flexível) + acionamento a cada deploy que altere contratos compartilhados.
- **O que o Supervisor CRM reporta ao Supervisor ERP:**
  1. Alterações em Login MFA (`/login`), `src/middleware.ts`, sessão `stihub_session` e matriz RBAC (`src/modules/erp/rbac-seed.ts`);
  2. Novos Deals ganhos (`closedwon`) aptos para geração de Orçamento (`#4695`) ou Contrato de Locação;
  3. Chamados NOC que demandem abertura de Ordem de Serviço (O.S.) de campo ou substituição de equipamento por S/N;
  4. Novas Custom Properties (`#4369067`) ou Modelos de E-mail compartilhados.
- **O que o Supervisor ERP reporta ao Supervisor CRM:**
  1. Novos clientes/empresas, propostas, vendas, contratos ou O.S. sincronizados na carga diária incremental do GestãoClick (`/api/erp/daily-sync`);
  2. Alterações de situação financeira/inadimplência ou limite de crédito (Banco Inter / Itaú / Serasa) que impactem o Sales Hub;
  3. Emissão de faturas de locação (SV 31 STF), NFS-e ou NF-e de remessa (`CFOP 5.908`/`6.908`) para registro na Timeline do cliente.
- **Regra de Resolução de Conflitos de Escopo:**
  - **Autenticação MFA, Middleware de Rotas, Subdomínio e Motor RBAC:** governança primária do **CRM - Supervisor & Roadmap**, com validação obrigatória do **ERP - Supervisor & Roadmap** para as travas de alçada dos 5 perfis operacionais do ERP (`FINANCEIRO_ERP`, `FISCAL_FATURAMENTO`, `ENGENHARIA_NOC_OS`, `ESTOQUE_COMPRAS`, `PDV_BALCAO`).
  - **10 Pilares do SETA ERP, Motor Fiscal e Sincronização GestãoClick:** governança primária do **ERP - Supervisor & Roadmap**.
  - **Trava Fiscal de CNPJ (Cláusula Pétrea):** nenhum módulo de CRM ou ERP pode mesclar cadastros com CNPJs distintos (Matriz `/0001` vs Filial `/0002`), retornando `HTTP 400` em qualquer tentativa.

---

## 4. Rotina Diária de Sincronização Incremental GestãoClick → STI-hub

- **Nome da Rotina:** `Sincronização Diária Incremental ERP GestãoClick → STI-hub`
- **Endpoint & Cron:** `GET/POST /api/erp/daily-sync` (configurado em `vercel.json` e na rotina diária às **07h00 EDT**).
- **Escopo dos 11 Módulos Reais Importados e Auditados (Loja Matriz `#118887`):**
  1. **Clientes / Empresas:** `1.184` registros
  2. **Fornecedores:** `101` registros
  3. **Funcionários:** `14` registros (+ `22` colaboradores mapeados no RBAC)
  4. **Produtos:** `786` registros (incluindo `SL-44-SEC-K9`)
  5. **Serviços:** `39` registros
  6. **Orçamentos / Propostas:** `2.077` registros (incluindo Orçamento `#4695` — Mundivox)
  7. **Pedidos de Venda:** `295` registros
  8. **Contratos de Locação:** `344` registros (0% ISS — Súmula Vinculante 31 STF)
  9. **Contas a Receber:** `153` registros
  10. **Contas a Pagar:** `43` registros
  11. **Ordens de Serviço / Chamados:** `1.378` registros

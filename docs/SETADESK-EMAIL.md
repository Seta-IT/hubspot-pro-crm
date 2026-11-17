# SetaDesk: abertura de chamados por e-mail

Status: implementado atrás de flag, **desligado por padrão**. Nada é lido nem enviado enquanto
`SETADESK_EMAIL_INTAKE_ENABLED` não estiver ligada.

## Arquitetura

1. **Leitura (Mail.Read)**: delta query do Graph em `mailFolders('inbox')/messages/delta`, por caixa,
   com o cursor (`deltaLink`/`nextLink`) guardado em `setadesk_mail_sync_state`. Na primeira execução,
   o cursor começa em "agora" (`$filter=receivedDateTime ge <início>`), e mensagens anteriores ao início
   são puladas: o histórico da caixa nunca vira chamado nem recebe confirmação. Só GET: não marca como
   lido nem move. O cursor só avança quando todas as mensagens da página foram gravadas.
   - Por que delta por ciclo e não webhook: não exige endpoint público novo com `clientState`,
     validação de `validationToken` e renovação de assinatura a cada 3 dias; é idempotente (deduplicação
     por Message-ID) e mais simples de auditar. Webhook pode vir depois para reduzir a latência.
2. **Processamento**: fila pela caixa destinatária (`setadesk_pipelines.mailbox`, que também precisa
   estar em `SETADESK_EMAIL_INTAKE_MAILBOXES`). Deduplicação só por Message-ID idêntico (índice único).
   Threading: In-Reply-To/References de mensagens conhecidas; depois `[TEC-n]`/`[FIN-n]` no assunto
   (só se o remetente participar do chamado); senão, chamado novo. Assunto parecido do mesmo cliente
   gera, no máximo, uma sugestão em `setadesk_related_tickets` (nunca fusão). Resposta do solicitante
   vira comentário público com papel `CUSTOMER` (o papel de solicitante já usado pelo portal); de
   terceiro, comentário interno. HTML sanitizado (allowlist) e texto puro guardados. Anexos: só
   metadados (sem upload; nenhum Blob). Ignorados: auto-replies (Auto-Submitted, X-Auto-Response-Suppress,
   Precedence bulk/list/junk/auto_reply), mensagens da própria caixa e bounces. Vínculo com
   contato/empresa só por e-mail exato; mais de um contato ou empresas com CNPJs diferentes => sem vínculo.
3. **Confirmação**: só para chamado novo, enfileirada em `setadesk_email_outbox` (dedupe
   `CONFIRMATION:<ticket>`), enviada por Mail.Send a partir da caixa da fila como `reply` da mensagem
   original (o Graph preenche In-Reply-To/References); se a original sumiu, `sendMail` com `[CHAVE]` no
   assunto. Retry com backoff (1, 5, 15, 60, 360 min), FAILED após 6 tentativas; envio travado em
   SENDING vira FAILED (nunca reenvia às cegas). Registrada como comentário AGENT, público só se todos
   os destinatários forem o solicitante/contato (pacote H).
4. **Aviso "Chamado em atendimento"**: `POST /api/tickets/:id/mark-viewed`, chamado pelo modal ao abrir (POST
   explícito, imune a prefetch). Grava `first_viewed_at`/`first_viewed_by` uma única vez (UPDATE
   condicional) e, só em chamado aberto por e-mail e com `SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED`,
   enfileira o aviso uma única vez. A flag vem **desligada por padrão**.

   Texto **APROVADO pelo Marcéllo em 17/11/2026** (chave real TEC- ou FIN-):
   - Assunto: `[TEC-249] Chamado em atendimento`
   - Corpo: "Olá, o chamado TEC-249 já está com um técnico da nossa equipe e está sendo tratado dentro
     do prazo de atendimento. Vamos responder por este e-mail com o andamento ou a solução. Se tiver
     mais informações, responda mantendo o número no assunto. Equipe de Suporte Seta Telecom."
5. **Disparo do ciclo**: `POST /api/tickets/email-intake/poll` (admin/coordenador com Chamados).
   O cron automático depende de liberar o caminho no `middleware.ts` e no `_bridge.ts` (allowlist do
   `CRON_SECRET`), arquivos que só mudam com o CISO. Ver checklist.

Migração `0006_email_intake` (idempotente; aplicada pelo `ensureSetaDeskSchema` no primeiro acesso).

## Variáveis de ambiente (somente nomes)

| Nome | Conteúdo | Segredo |
|---|---|---|
| `SETADESK_EMAIL_INTAKE_ENABLED` | `true` liga a entrada | não |
| `SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED` | `true` liga o aviso "Chamado em atendimento" (padrão: desligado) | não |
| `SETADESK_EMAIL_INTAKE_MAILBOXES` | `suporte-sti@setatelecom.com.br,financeiro-sti@setatelecom.com.br` | não |
| `SETADESK_GRAPH_TENANT_ID` | `05c800b3-8c5b-448b-912d-e1e51d667588` | não |
| `SETADESK_GRAPH_CLIENT_ID` | `9b5ce520-d659-4348-8044-70827160b247` | não |
| `SETADESK_GRAPH_CERT_THUMBPRINT` | `221CA3CB835C5B18A6894F7EDCE149DB7DDCC39E` (SHA-1) | não |
| `SETADESK_GRAPH_CERT_PFX_BASE64` | o `.pfx` em base64, uma linha | **sim** |
| `SETADESK_GRAPH_CERT_PASSWORD` | senha do `.pfx` | **sim** |

O código confere que o certificado do PFX tem exatamente o thumbprint informado, que a chave casa com
o certificado e que ele está dentro da validade. Erros só devolvem códigos.

## Permissões do Graph

Permissões de **aplicação** `Mail.Read` e `Mail.Send`, concedidas pelo RBAC for Applications do
Exchange Online com escopo limitado às duas caixas (sem consentimento de organização inteira no Entra).

## Checklist para ligar

1. CISO revisa e aprova o PR. (Texto do aviso "Chamado em atendimento" já aprovado pelo Marcéllo em 17/11/2026.)
2. Merge na main (deploy automático). A migração 0006 roda no primeiro acesso.
3. Marcéllo cadastra na Vercel (Production) as variáveis acima; as secretas só por ele.
4. Desligar no Jira o canal de e-mail dessas duas caixas (senão o cliente recebe duas confirmações).
5. Conferir DKIM e DMARC do domínio.
6. Ligar `SETADESK_EMAIL_INTAKE_ENABLED` com novo build do main e rodar o ciclo pelo
   `POST /api/tickets/email-intake/poll`; testar com um e-mail externo de teste.
7. Cron: com o CISO, liberar `/api/tickets/email-intake/poll` na allowlist do `CRON_SECRET`
   (`middleware.ts` e `_bridge.ts`) e adicionar ao `vercel.json`. No plano Hobby da Vercel o cron
   roda no máximo 1x/dia; para intervalos curtos é preciso plano Pro ou agendador externo.
8. Quando decidido, ligar `SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED` (continua desligada por padrão).

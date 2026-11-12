import React from 'react';
import type { InternalProposalSummaryModel } from '../lib/internal-proposal-summary';
import { downloadInternalProposalPdf, printInternalProposal } from '../lib/internal-proposal-pdf';
import { INTERNAL_FIELD_BLANK } from '../lib/internal-proposal-sheet';

const MISSING = 'text-[#9ca3af]';

/**
 * Folha interna v3. A barra com Imprimir e Baixar PDF não entra na impressão.
 */
export function InternalProposalSummaryView({ model }: { model: InternalProposalSummaryModel }) {
  const sheet = model.sheet;
  return (
    <div className="min-h-screen bg-[#f4f6fa] text-[#1f2937] print:bg-white" data-testid="internal-proposal-summary">
      <style>{`@media print { @page { size: A4; margin: 8mm 9mm; } .no-print { display: none !important; } }`}</style>
      <div className="no-print border-b border-[#dbe2ee] bg-white">
        <div className="mx-auto flex max-w-[794px] items-center justify-between px-4 py-3" data-testid="internal-proposal-toolbar">
          <b className="text-[13px] tracking-[0.06em] text-[#1e3a6e]">{sheet.brandTitle}</b>
          <span>
            <button
              type="button"
              data-testid="internal-proposal-print"
              onClick={() => printInternalProposal(model)}
              className="mr-2 rounded-md border border-[#1e3a6e] bg-white px-3 py-1.5 text-xs font-bold text-[#1e3a6e]"
            >
              Imprimir
            </button>
            <button
              type="button"
              data-testid="internal-proposal-download-pdf"
              onClick={() => downloadInternalProposalPdf(model)}
              className="rounded-md bg-[#1e3a6e] px-3 py-1.5 text-xs font-bold text-white"
            >
              Baixar PDF
            </button>
          </span>
        </div>
      </div>
      <main className="mx-auto my-4 max-w-[794px] rounded-md border border-[#dbe2ee] bg-white px-6 py-6 print:m-0 print:max-w-none print:border-0 print:p-0 sm:px-10">
        <header className="flex items-start justify-between gap-4 border-b-2 border-[#1e3a6e] pb-2">
          <div className="flex items-center gap-3">
            <img src="/brand/seta-it-logo.png" alt="SETA | IT" className="h-8 w-auto" />
            <div>
              <h1 className="text-sm font-semibold tracking-wide text-[#1e3a6e]">{sheet.brandTitle}</h1>
              <div className="text-[11px]">{sheet.issuerLegalName}</div>
              <div className="text-[11px]">CNPJ: {sheet.issuerCnpj}</div>
              <div className="text-[11px]">{sheet.issuerStreet}</div>
              <div className="text-[11px]">{sheet.issuerCity}</div>
            </div>
          </div>
          <div className="text-right text-[11px]">
            {sheet.issuerPhone ? <div className="font-semibold text-[#1e3a6e]">{sheet.issuerPhone}</div> : null}
            {sheet.issuerEmail ? <div className="font-semibold text-[#1e3a6e]">{sheet.issuerEmail}</div> : null}
            {sheet.sellerName ? <div>Vendedor: <strong className="text-[#1e3a6e]">{sheet.sellerName}</strong></div> : null}
          </div>
        </header>

        <div className="mt-2 grid grid-cols-[1fr_auto] items-center border border-[#cdd7e6] bg-[#eef2f8] px-3 py-1.5">
          <div className="text-center text-sm font-bold text-[#1e3a6e]" data-testid="internal-proposal-code">ORÇAMENTO Nº {sheet.budgetNumber}</div>
          <div className="text-sm font-bold text-[#1e3a6e]">{sheet.proposalDateLabel}</div>
        </div>
        <div className="mt-1 flex items-baseline gap-2 border border-[#cdd7e6] px-3 py-1.5" data-testid="internal-proposal-contract">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[#1e3a6e]">Nº do contrato:</span>
          {sheet.contractNumber ? (
            <span className="font-semibold">{sheet.contractNumber}</span>
          ) : (
            <span className="inline-block h-3.5 w-60 border-b border-[#1f2937]" />
          )}
          {!sheet.contractNumber ? (
            <span className="text-[10px] text-[#6b7280]">preenchido quando a proposta for convertida em contrato de locação</span>
          ) : null}
        </div>

        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[205px_1fr]">
          <section className="leading-snug" data-testid="internal-proposal-kind">
            <div className="font-bold text-[#1e3a6e]">{sheet.headline}</div>
            <div>{sheet.monthlyLine}</div>
            <div>{sheet.deliveryLine}</div>
            {sheet.freightLine ? <div>{sheet.freightLine}</div> : null}
            {sheet.slaLine ? <div>{sheet.slaLine}</div> : null}
            <div>{sheet.readjustmentLine}</div>
          </section>
          <section className="text-[10.5px] leading-snug">
            {sheet.notices.map((note) => (
              <p key={note} className="mb-0.5">
                <span className="font-bold text-[#1e3a6e]">› </span>
                {note}
              </p>
            ))}
          </section>
        </div>

        <div className="mt-2 grid grid-cols-1 border border-[#cdd7e6] text-[11px] font-bold sm:grid-cols-2">
          <div className="px-2 py-1">{sheet.validityLine}</div>
          <div className="border-t border-[#cdd7e6] px-2 py-1 sm:border-l sm:border-t-0">{sheet.deliveryForecastLine}</div>
        </div>

        <section className="mt-2">
          <div className="border border-b-0 border-[#cdd7e6] bg-[#eef2f8] px-2 py-1 text-[11px] font-bold tracking-wide text-[#1e3a6e]">DADOS DO CLIENTE</div>
          <table className="w-full border-collapse text-[11px]">
            <tbody>
              <ClientRow k1="Razão social:" v1={sheet.clientLegalName} k2="Nome fantasia:" v2={sheet.clientTradeName} />
              <ClientRow k1="CNPJ/CPF:" v1={sheet.clientCnpj} k2="Endereço:" v2={sheet.clientAddress} testId="internal-proposal-cnpj" />
              <ClientRow k1="CEP:" v1={sheet.clientCep} k2="Cidade/UF:" v2={sheet.clientCityUf} />
              <ClientRow k1="Telefone:" v1={sheet.clientPhone} k2="E-mail:" v2={sheet.clientEmail} />
            </tbody>
          </table>
        </section>

        <section className="mt-2" data-testid="internal-proposal-items">
          <div className="border border-b-0 border-[#cdd7e6] bg-[#eef2f8] px-2 py-1 text-[11px] font-bold tracking-wide text-[#1e3a6e]">{sheet.itemsSection}</div>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-[#fafbfd] text-left text-[10px] uppercase">
                <th className="border border-[#cdd7e6] px-1.5 py-1">Item</th>
                <th className="border border-[#cdd7e6] px-1.5 py-1">Código</th>
                <th className="border border-[#cdd7e6] px-1.5 py-1">Nome</th>
                <th className="border border-[#cdd7e6] px-1.5 py-1 text-center">Und.</th>
                <th className="border border-[#cdd7e6] px-1.5 py-1 text-right">Qtd.</th>
                <th className="border border-[#cdd7e6] px-1.5 py-1 text-right">Vr. unit. mensal</th>
                <th className="border border-[#cdd7e6] px-1.5 py-1 text-right">Subtotal mensal</th>
              </tr>
            </thead>
            <tbody>
              {sheet.lines.map((line) => (
                <tr key={line.index}>
                  <td className="border border-[#cdd7e6] px-1.5 py-1">{line.index}</td>
                  <td className="border border-[#cdd7e6] px-1.5 py-1">{line.sku}</td>
                  <td className="border border-[#cdd7e6] px-1.5 py-1">{line.name}{line.detail ? <div className="text-[10px] text-[#6b7280]">{line.detail}</div> : null}</td>
                  <td className="border border-[#cdd7e6] px-1.5 py-1 text-center">{line.unit}</td>
                  <td className="border border-[#cdd7e6] px-1.5 py-1 text-right whitespace-nowrap">{line.qty}</td>
                  <td className="border border-[#cdd7e6] px-1.5 py-1 text-right whitespace-nowrap">{line.unitPrice}</td>
                  <td className="border border-[#cdd7e6] px-1.5 py-1 text-right whitespace-nowrap">{line.subtotal}</td>
                </tr>
              ))}
              <tr className="bg-[#fafbfd] font-bold">
                <td className="border border-[#cdd7e6] px-1.5 py-1" colSpan={4}>TOTAL</td>
                <td className="border border-[#cdd7e6] px-1.5 py-1 text-right">{sheet.qtyTotal}</td>
                <td className="border border-[#cdd7e6] px-1.5 py-1" />
                <td className="border border-[#cdd7e6] px-1.5 py-1 text-right">{sheet.monthlyPlain}</td>
              </tr>
            </tbody>
          </table>
          <div className="ml-auto w-[270px] border border-t-0 border-[#cdd7e6] text-[11px]">
            <div className="flex justify-between border-b border-[#e5eaf2] px-2 py-0.5"><span>{sheet.itemsSection} (mensal):</span><span>{sheet.productsMonthly}</span></div>
            {sheet.showFreight ? <div className="flex justify-between border-b border-[#e5eaf2] px-2 py-0.5"><span>FRETE (pagamento único):</span><span>{sheet.freightAmount}</span></div> : null}
            <div className="flex justify-between px-2 py-0.5 font-bold text-[#1e3a6e]" data-testid="internal-proposal-monthly"><span>TOTAL MENSAL:</span><span>{sheet.totalMonthly}</span></div>
          </div>
        </section>

        <section className="mt-2">
          <div className="border border-b-0 border-[#cdd7e6] bg-[#eef2f8] px-2 py-1 text-[11px] font-bold tracking-wide text-[#1e3a6e]">DADOS DO PAGAMENTO</div>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-[#fafbfd] text-left text-[10px] uppercase">
                <th className="border border-[#cdd7e6] px-1.5 py-1">Vencimento</th>
                <th className="border border-[#cdd7e6] px-1.5 py-1 text-right">Valor</th>
                <th className="border border-[#cdd7e6] px-1.5 py-1">Forma de pagamento</th>
                <th className="border border-[#cdd7e6] px-1.5 py-1">Observação</th>
              </tr>
            </thead>
            <tbody>
              {sheet.paymentRows.map((row) => (
                <tr key={row.due}>
                  <td className="border border-[#cdd7e6] px-1.5 py-1">{row.due}</td>
                  <td className="border border-[#cdd7e6] px-1.5 py-1 text-right whitespace-nowrap">{row.amount}</td>
                  <td className={`border border-[#cdd7e6] px-1.5 py-1 ${row.methodMissing ? MISSING : ''}`}>{row.method}</td>
                  <td className="border border-[#cdd7e6] px-1.5 py-1">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-2">
          <div className="border border-b-0 border-[#cdd7e6] bg-[#eef2f8] px-2 py-1 text-[11px] font-bold tracking-wide text-[#1e3a6e]">OBSERVAÇÕES</div>
          <div className="columns-2 gap-3 border border-[#cdd7e6] px-2 py-1 text-[10px] leading-snug">
            {sheet.commercialNote ? <p className="mb-1">{sheet.commercialNote}</p> : null}
            <p className="mb-1"><b>CONFIDENCIALIDADE E CONDIÇÕES GERAIS</b> — {sheet.confidentiality}</p>
            {sheet.clauses.map((clause) => (
              <p key={clause.title} className="mb-1"><b>{clause.title}</b> — {clause.body}</p>
            ))}
          </div>
        </section>

        <section className="mt-2 border border-[#cdd7e6] px-2 pb-2 pt-6 text-center text-[11px]">
          <div className="mx-auto mb-1 w-[300px] border-t border-[#1f2937]" />
          Assinatura do cliente
        </section>
        <div className="mt-1 text-right text-[9.5px] text-[#6b7280]">Orçamento Nº {sheet.budgetNumber} · {sheet.brandTitle}</div>
      </main>
    </div>
  );
}

function ClientRow({
  k1,
  v1,
  k2,
  v2,
  testId,
}: {
  k1: string;
  v1: string;
  k2: string;
  v2: string;
  testId?: string;
}) {
  const tone = (value: string) => (value === INTERNAL_FIELD_BLANK ? MISSING : '');
  return (
    <tr>
      <td className="w-[15%] whitespace-nowrap border border-[#cdd7e6] bg-[#fafbfd] px-1.5 py-0.5 font-bold">{k1}</td>
      <td className={`w-[35%] border border-[#cdd7e6] px-1.5 py-0.5 ${tone(v1)}`} data-testid={testId}>{v1}</td>
      <td className="w-[15%] whitespace-nowrap border border-[#cdd7e6] bg-[#fafbfd] px-1.5 py-0.5 font-bold">{k2}</td>
      <td className={`w-[35%] border border-[#cdd7e6] px-1.5 py-0.5 ${tone(v2)}`}>{v2}</td>
    </tr>
  );
}

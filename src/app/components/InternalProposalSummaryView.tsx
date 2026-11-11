import React from 'react';
import type { InternalProposalSummaryModel } from '../lib/internal-proposal-summary';

/**
 * Folha interna resumida do orçamento. Não usa o cabeçalho global do STI-hub:
 * a barra desta página é só da visão, na cor primária #1e3a6e.
 */
export function InternalProposalSummaryView({ model }: { model: InternalProposalSummaryModel }) {
  return (
    <div className="min-h-screen bg-[#f4f6f9] text-slate-800" data-testid="internal-proposal-summary">
      <header className="bg-[#1e3a6e] text-white">
        <div className="mx-auto flex max-w-4xl flex-col gap-1 px-6 py-5 sm:px-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
            STI-hub · Seta Telecom
          </p>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-xl font-semibold tracking-tight">Visão interna do orçamento</h1>
            <p className="text-xs text-white/80">Para o contrato · não é o link do cliente</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 sm:px-8">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Orçamento</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-[#1e3a6e]" data-testid="internal-proposal-code">
                {model.codeLabel}
              </p>
              <p className="mt-1 text-sm text-slate-600" data-testid="internal-proposal-version">
                {model.versionLabel}
              </p>
            </div>
            <span
              data-testid="internal-proposal-status"
              data-status={model.status}
              className="inline-flex items-center rounded-full border border-[#c7d2e8] bg-[#eef2fa] px-3 py-1 text-xs font-semibold text-[#1e3a6e]"
            >
              {model.statusLabel}
            </span>
          </div>

          <div className="px-6 py-5 sm:px-8">
            <h2 className="text-base font-semibold text-slate-900">{model.title}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
              O endereço desta visão não muda com a versão. Uma correção comercial continua abrindo aqui a versão atual.
            </p>

            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cliente</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-900" data-testid="internal-proposal-client">
                  {model.companyName}
                </dd>
                {model.careOf ? <dd className="mt-0.5 text-xs text-slate-500">A/C {model.careOf}</dd> : null}
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">CNPJ</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-900" data-testid="internal-proposal-cnpj">
                  {model.companyCnpj}
                </dd>
              </div>
            </dl>

            <h3 className="mt-7 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Itens</h3>
            <div className="mt-2 overflow-hidden rounded-md border border-slate-200">
              <table className="w-full border-collapse text-sm" data-testid="internal-proposal-items">
                <thead>
                  <tr className="bg-[#1e3a6e] text-left text-[11px] font-semibold uppercase tracking-wide text-white">
                    <th className="px-3 py-2 font-semibold">Descrição</th>
                    <th className="px-3 py-2 text-right font-semibold">Qtd</th>
                    <th className="px-3 py-2 text-right font-semibold">Unitário</th>
                    <th className="px-3 py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {model.lines.map((line) => (
                    <tr key={line.id} className="border-t border-slate-200">
                      <td className="px-3 py-2.5 text-slate-800">{line.description}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{line.quantityLabel}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{line.unitPriceLabel}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{line.totalLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_16rem]">
              <div className="rounded-md border border-slate-200 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-4 py-1">
                  <span className="text-slate-500">Produtos</span>
                  <span className="tabular-nums text-slate-800">{model.productsLabel}</span>
                </div>
                {model.showFreight ? (
                  <div className="flex items-center justify-between gap-4 border-t border-slate-100 py-1">
                    <span className="text-slate-500">Frete</span>
                    <span className="tabular-nums text-slate-800" data-testid="internal-proposal-freight">
                      {model.freightLabel}
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-4 border-t border-slate-100 py-1">
                  <span className="text-slate-500">Valor mensal</span>
                  <span className="tabular-nums text-slate-800" data-testid="internal-proposal-monthly">
                    {model.monthlyLabel}
                  </span>
                </div>
              </div>
              <div className="flex flex-col justify-center rounded-md bg-[#1e3a6e] px-4 py-3 text-white">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Valor total</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums" data-testid="internal-proposal-total">
                  {model.totalLabel}
                </p>
              </div>
            </div>

            <h3 className="mt-7 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Condições</h3>
            <dl className="mt-2 grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-2">
              <Condition label="Prazo" value={model.deliveryLabel} testId="internal-proposal-term" />
              <Condition label="Contrato" value={model.contractLabel} testId="internal-proposal-contract" />
              <Condition label="SLA" value={model.slaLabel} testId="internal-proposal-sla" />
              <Condition label="Condição de pagamento" value={model.paymentLabel} testId="internal-proposal-payment" />
              <Condition label="Validade" value={model.validityLabel} testId="internal-proposal-validity" wide />
            </dl>
          </div>

          <section
            className="border-t border-amber-200 bg-amber-50 px-6 py-5 sm:px-8"
            data-testid="internal-proposal-notes"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-amber-950">Observações internas</h3>
              <p className="text-[11px] font-medium uppercase tracking-wide text-amber-800">
                Só nesta visão · não vai no link do cliente
              </p>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-amber-950">
              {model.internalNotes || 'Sem observações internas.'}
            </p>
          </section>

          <footer className="border-t border-slate-200 bg-slate-50 px-6 py-4 sm:px-8">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Link interno estável
            </p>
            <p className="mt-1 break-all font-mono text-xs text-[#1e3a6e]" data-testid="internal-proposal-url">
              {model.stableUrl}
            </p>
          </footer>
        </article>
      </main>
    </div>
  );
}

function Condition({
  label,
  value,
  testId,
  wide = false,
}: {
  label: string;
  value: string;
  testId: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'bg-white px-4 py-3 sm:col-span-2' : 'bg-white px-4 py-3'} data-testid={testId}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

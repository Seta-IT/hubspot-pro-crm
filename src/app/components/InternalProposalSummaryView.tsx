import React from 'react';
import type { InternalProposalSummaryModel } from '../lib/internal-proposal-summary';

/**
 * Folha interna resumida do orçamento, pensada para locação, serviço e spare parts.
 * Não usa o cabeçalho global do STI-hub: a barra desta página é só da visão, em #1e3a6e.
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
            <p className="text-xs text-white/80" data-testid="internal-proposal-kind">
              {model.kindLabel} · para o contrato
            </p>
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

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Metric label={model.termLabel} value={model.termValue} testId="internal-proposal-term" />
              <Metric label="Valor mensal" value={model.monthlyLabel} testId="internal-proposal-monthly" />
              <div className="rounded-md bg-[#1e3a6e] px-4 py-3 text-white" data-testid="internal-proposal-total">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">{model.periodLabel}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{model.periodValue}</p>
              </div>
            </div>

            {model.scopeLabel ? (
              <p className="mt-4 text-sm text-slate-700" data-testid="internal-proposal-scope">
                <span className="font-semibold text-slate-500">Escopo · </span>
                {model.scopeLabel}
              </p>
            ) : null}

            <h3 className="mt-7 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{model.itemsHeading}</h3>
            <div className="mt-2 overflow-hidden rounded-md border border-slate-200">
              <table className="w-full border-collapse text-sm" data-testid="internal-proposal-items">
                <thead>
                  <tr className="bg-[#1e3a6e] text-left text-[11px] font-semibold uppercase tracking-wide text-white">
                    <th className="px-3 py-2 font-semibold">{model.itemColumn}</th>
                    <th className="px-3 py-2 text-right font-semibold">Qtd</th>
                    <th className="px-3 py-2 text-right font-semibold">{model.unitColumn}</th>
                    <th className="px-3 py-2 text-right font-semibold">{model.lineColumn}</th>
                  </tr>
                </thead>
                <tbody>
                  {model.lines.map((line) => (
                    <tr key={line.id} className="border-t border-slate-200">
                      <td className="px-3 py-2.5 text-slate-800">
                        <div>{line.description}</div>
                        {line.detail ? <div className="mt-0.5 text-xs text-slate-500">{line.detail}</div> : null}
                      </td>
                      <td className="px-3 py-2.5 text-right align-top tabular-nums text-slate-700">{line.quantityLabel}</td>
                      <td className="px-3 py-2.5 text-right align-top tabular-nums text-slate-700">{line.unitLabel}</td>
                      <td className="px-3 py-2.5 text-right align-top font-semibold tabular-nums text-slate-900">{line.lineLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {model.oneTimeRows.length > 0 ? (
              <section className="mt-4 rounded-md border border-slate-200 px-4 py-3" data-testid="internal-proposal-onetime">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Valores únicos
                </h3>
                <p className="mt-1 text-xs text-slate-500">{model.oneTimeCaption}</p>
                <div className="mt-2 divide-y divide-slate-100 text-sm">
                  {model.oneTimeRows.map((row) => (
                    <div key={row.testId} className="flex items-center justify-between gap-4 py-1.5" data-testid={row.testId}>
                      <span className="text-slate-600">{row.label}</span>
                      <span className="font-semibold tabular-nums text-slate-900">{row.value}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <h3 className="mt-7 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Condições</h3>
            <dl className="mt-2 grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-2">
              {model.conditions.map((condition, index) => (
                <div
                  key={condition.testId}
                  className={
                    index === model.conditions.length - 1 && model.conditions.length % 2 === 1
                      ? 'bg-white px-4 py-3 sm:col-span-2'
                      : 'bg-white px-4 py-3'
                  }
                  data-testid={condition.testId}
                >
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{condition.label}</dt>
                  <dd className="mt-1 text-sm text-slate-900">{condition.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <section className="border-t border-amber-200 bg-amber-50 px-6 py-5 sm:px-8" data-testid="internal-proposal-notes">
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
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Link interno estável</p>
            <p className="mt-1 break-all font-mono text-xs text-[#1e3a6e]" data-testid="internal-proposal-url">
              {model.stableUrl}
            </p>
          </footer>
        </article>
      </main>
    </div>
  );
}

function Metric({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-md border border-slate-200 px-4 py-3" data-testid={testId}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-[#1e3a6e]">{value}</p>
    </div>
  );
}

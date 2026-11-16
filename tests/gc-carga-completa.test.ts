import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchAllGcPages,
  mapGcContractStatus,
  resolveGcContractKind,
  GestaoClickRawMeta,
} from '../src/modules/erp/gestaoclick-client';
import { mergeGestaoClickContracts, upsertRecordsById } from '../src/modules/erp/gestaoclick-merge';
import { ErpRentalContract } from '../src/db/types';

function fakeGc(total: number, perPage = 20, failOnce: number[] = []) {
  const calls: string[] = [];
  const failed = new Set<number>();
  const pages = Math.max(1, Math.ceil(total / perPage));
  const fetchPage = async (ep: string) => {
    calls.push(ep);
    const page = Number(new URL(`http://x${ep}`).searchParams.get('pagina') || '1');
    if (failOnce.includes(page) && !failed.has(page)) {
      failed.add(page);
      return { data: [], meta: {} as GestaoClickRawMeta, ok: false };
    }
    const start = (page - 1) * perPage;
    const data = Array.from({ length: Math.max(0, Math.min(perPage, total - start)) }, (_, i) => ({
      id: String(start + i + 1),
    }));
    return {
      data,
      meta: { total_registros: total, total_paginas: pages, pagina_atual: page, limite_por_pagina: perPage },
      ok: true,
    };
  };
  return { calls, fetchPage };
}

const noSleep = async () => {};

describe('GestaoClick: carga completa paginada', () => {
  it('le todas as paginas de OS (1397 registros, 70 paginas de 20)', async () => {
    const gc = fakeGc(1397);
    const res = await fetchAllGcPages('/ordens_servicos', gc.fetchPage, { sleepFn: noSleep });
    assert.equal(res.data.length, 1397);
    assert.equal(res.info.complete, true);
    assert.equal(res.info.pages, 70);
    assert.equal(gc.calls.length, 70);
    assert.ok(gc.calls.includes('/ordens_servicos?pagina=70'));
  });

  it('le contratos (345) e vendas (297) completos', async () => {
    for (const [ep, total] of [['/contratos', 345], ['/vendas', 297]] as const) {
      const res = await fetchAllGcPages(ep, fakeGc(total).fetchPage, { sleepFn: noSleep });
      assert.equal(res.data.length, total);
      assert.equal(res.info.complete, true);
    }
  });

  it('tenta de novo pagina com falha e nao duplica ids', async () => {
    const gc = fakeGc(60, 20, [2]);
    const res = await fetchAllGcPages('/vendas', gc.fetchPage, { sleepFn: noSleep });
    assert.equal(res.data.length, 60);
    assert.equal(new Set(res.data.map((r) => r.id)).size, 60);
    assert.equal(res.info.complete, true);
  });

  it('marca incompleto quando passa do teto de paginas', async () => {
    const res = await fetchAllGcPages('/ordens_servicos', fakeGc(100).fetchPage, { sleepFn: noSleep, maxPages: 2 });
    assert.equal(res.data.length, 40);
    assert.equal(res.info.complete, false);
  });

  it('respeita 3 requisicoes por segundo (espera entre lotes)', async () => {
    const waits: number[] = [];
    await fetchAllGcPages('/contratos', fakeGc(200).fetchPage, {
      sleepFn: async (ms) => {
        waits.push(ms);
      },
    });
    // 10 paginas: 1a sozinha + lotes de 3 (2-4, 5-7, 8-10) => espera entre os 3 lotes
    assert.equal(waits.length, 2);
  });
});

describe('GestaoClick: tipo e situacao do contrato', () => {
  it('LO = locacao, CO = servico', () => {
    assert.equal(resolveGcContractKind({ tipo: 'LO' }), 'LOCACAO');
    assert.equal(resolveGcContractKind({ tipo: 'CO' }), 'SERVICO');
    assert.equal(resolveGcContractKind({ nome_centro_custo: 'Locação de Equipamentos' }), 'LOCACAO');
  });
  it('Finalizado e Cancelado viram ENCERRADO; Faturamento e Em aberto mapeados', () => {
    assert.equal(mapGcContractStatus('Finalizado'), 'ENCERRADO');
    assert.equal(mapGcContractStatus('Cancelado'), 'ENCERRADO');
    assert.equal(mapGcContractStatus('Faturamento'), 'FATURAMENTO');
    assert.equal(mapGcContractStatus('Em aberto'), 'EM_IMPLANTACAO');
    assert.equal(mapGcContractStatus('Confirmado'), 'ATIVO');
    assert.equal(mapGcContractStatus('Ativo'), 'ATIVO');
  });
});

function ctr(id: string, extra: Partial<ErpRentalContract> = {}): ErpRentalContract {
  return {
    id,
    contractNumber: id,
    title: id,
    companyId: 'comp-gc-10',
    companyName: 'Cliente X',
    companyCnpj: '',
    contactId: null,
    dealId: null,
    proposalId: null,
    monthlyValue: 100,
    dueDay: 10,
    startDate: '2026-01-01',
    endDate: '2027-01-01',
    contractMonths: 12,
    readjustmentIndex: 'IPCA',
    status: 'ATIVO',
    equipments: [],
    remessaNfeNumber: '1',
    remessaCfop: '5.908',
    legalBasisNote: '',
    lastBilledCompetence: null,
    ...extra,
  } as ErpRentalContract;
}

describe('GestaoClick: merge de contratos', () => {
  const companies = [{ id: 'comp-gc-10', name: 'Cliente X', cnpj: '11222333000181' }];

  it('insere todos os contratos novos sem duplicar e completa o CNPJ pelo cadastro', () => {
    const list = [ctr('ctr-gc-1')];
    const stats = mergeGestaoClickContracts(
      list,
      [ctr('ctr-gc-1'), ctr('ctr-gc-2', { modality: 'SERVICO' }), ctr('ctr-gc-2')],
      companies
    );
    assert.equal(list.length, 2);
    assert.equal(stats.inserted, 1);
    assert.equal(list[1].companyCnpj, '11.222.333/0001-81');
    assert.equal(list[0].companyCnpj, '11.222.333/0001-81');
  });

  it('espelha o GestaoClick: status, valores, datas e tipo sobrescritos; campos so do STI-hub intactos', () => {
    const list = [
      ctr('ctr-gc-1', {
        status: 'ATIVO',
        monthlyValue: 750,
        endDate: '2027-01-01',
        readjustmentIndex: 'IGP-M',
        contractTemplateModel: 'MODELO_LOCACAO_BENS_MOVEIS',
        dealId: 'deal-9',
        proposalId: 'prop-local-1',
        equipments: [
          {
            id: 'eq-gc-1-0',
            skuGestaoClick: 'A',
            description: 'Antigo',
            serialNumber: 'SN-REAL-1',
            ncm: '8517.62.59',
            quantity: 1,
            unitMonthlyRent: 750,
            assetValueBrl: 9000,
            remessaCfop: '5.908',
            remessaNfeKey: 'k',
          },
          {
            id: 'eq-gc-1-1',
            skuGestaoClick: 'B',
            description: 'Saiu do GC',
            serialNumber: 'x',
            ncm: 'n',
            quantity: 1,
            unitMonthlyRent: 1,
            assetValueBrl: 1,
            remessaCfop: '5.908',
            remessaNfeKey: 'k',
          },
          {
            id: 'eq-local-7',
            skuGestaoClick: 'C',
            description: 'Criado no STI-hub',
            serialNumber: 'y',
            ncm: 'n',
            quantity: 1,
            unitMonthlyRent: 1,
            assetValueBrl: 1,
            remessaCfop: '5.908',
            remessaNfeKey: 'k',
          },
        ],
      }),
    ];
    const stats = mergeGestaoClickContracts(
      list,
      [
        ctr('ctr-gc-1', {
          status: 'ENCERRADO',
          modality: 'SERVICO',
          monthlyValue: 990,
          endDate: '2026-06-30',
          proposalId: null,
          readjustmentIndex: 'IPCA',
          equipments: [
            {
              id: 'eq-gc-1-0',
              skuGestaoClick: 'A2',
              description: 'Novo nome',
              serialNumber: 'SN-GC-FAKE',
              ncm: '0000',
              quantity: 3,
              unitMonthlyRent: 330,
              assetValueBrl: 1,
              remessaCfop: '5.908',
              remessaNfeKey: 'fake',
            },
          ],
        }),
      ],
      companies,
      '2026-11-16T20:00:00.000Z'
    );
    const c = list[0];
    assert.equal(stats.updated, 1);
    assert.equal(c.status, 'ENCERRADO');
    assert.equal(c.modality, 'SERVICO');
    assert.equal(c.monthlyValue, 990);
    assert.equal(c.endDate, '2026-06-30');
    assert.equal(c.updatedAt, '2026-11-16T20:00:00.000Z');
    // so do STI-hub
    assert.equal(c.readjustmentIndex, 'IGP-M');
    assert.equal(c.dealId, 'deal-9');
    assert.equal(c.proposalId, 'prop-local-1');
    assert.equal(c.contractTemplateModel, 'MODELO_LOCACAO_BENS_MOVEIS');
    // itens: campos do GC espelhados, serial/NCM/chave do STI-hub mantidos; item do GC removido; item local mantido
    assert.deepEqual(c.equipments.map((e) => e.id), ['eq-gc-1-0', 'eq-local-7']);
    assert.equal(c.equipments[0].description, 'Novo nome');
    assert.equal(c.equipments[0].quantity, 3);
    assert.equal(c.equipments[0].serialNumber, 'SN-REAL-1');
    assert.equal(c.equipments[0].ncm, '8517.62.59');
    assert.equal(c.equipments[0].remessaNfeKey, 'k');
  });

  it('segunda leitura igual nao altera nada (idempotente)', () => {
    const list: ErpRentalContract[] = [];
    mergeGestaoClickContracts(list, [ctr('ctr-gc-5', { status: 'FATURAMENTO' })], companies);
    const stats = mergeGestaoClickContracts(list, [ctr('ctr-gc-5', { status: 'FATURAMENTO' })], companies);
    assert.equal(list.length, 1);
    assert.equal(stats.unchanged, 1);
  });

  it('Trava Fiscal: CNPJ divergente vira conflito, CNPJ e cliente nao mudam, demais campos espelhados', () => {
    const list = [ctr('ctr-gc-1', { companyCnpj: '99.888.777/0001-66', companyName: 'Cliente X' })];
    const stats = mergeGestaoClickContracts(
      list,
      [ctr('ctr-gc-1', { companyCnpj: '11.222.333/0001-81', companyName: 'Outro', status: 'ENCERRADO' })],
      companies
    );
    assert.equal(stats.conflicts.length, 1);
    assert.equal(list[0].companyCnpj, '99.888.777/0001-66');
    assert.equal(list[0].companyName, 'Cliente X');
    assert.equal(list[0].status, 'ENCERRADO');
  });
});

describe('GestaoClick: upsert de vendas e OS', () => {
  it('atualiza pelo id, acrescenta novos e nunca encolhe a lista', () => {
    const cur = [
      { id: '1', status: 'Em andamento' },
      { id: 'local-9', status: 'Manual' },
    ];
    const out = upsertRecordsById(cur, [
      { id: '1', status: 'Concretizada' },
      { id: '2', status: 'Concretizada' },
    ]);
    assert.deepEqual(out.map((r) => `${r.id}:${r.status}`), ['1:Concretizada', 'local-9:Manual', '2:Concretizada']);
  });

  it('campos so do STI-hub (ex.: prioridade da OS) ficam intactos', () => {
    const out = upsertRecordsById<{ id: string; status: string; priority?: string }>(
      [{ id: '1', status: 'Em aberto', priority: 'ALTA' }],
      [{ id: '1', status: 'Concretizada' }]
    );
    assert.deepEqual(out[0], { id: '1', status: 'Concretizada', priority: 'ALTA' });
  });
});

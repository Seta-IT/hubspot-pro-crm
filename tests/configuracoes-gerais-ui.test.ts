// ============================================================================
// STI-hub ERP - Configurações gerais: funções puras e regras da tela. Sem rede.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ERP_GENERAL_SECTIONS,
  PRINT_FIELDS,
  buildDefaultErpGeneralSettings,
  filterGeneralSections,
  lastNumberFromCodes,
  mergeErpGeneralSettings,
  nextNumberLabel,
  printFieldSummary,
  sanitizeErpGeneralSettingsForSave,
} from '../src/app/lib/erp-general-settings';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('Configurações gerais: seções e busca', () => {
  it('tem as 9 seções na ordem do GestãoClick', () => {
    assert.deepEqual(
      ERP_GENERAL_SECTIONS.map((s) => s.title),
      ['Geral', 'Numerações', 'Impressão', 'Textos padrão', 'PDV', 'Compras', 'Fiscal', 'E-mails', 'Domínio próprio']
    );
  });
  it('busca ignora acento e caixa e procura em palavras-chave', () => {
    assert.deepEqual(filterGeneralSections('xml').map((s) => s.id), ['COMPRAS']);
    assert.ok(filterGeneralSections('IMPRESSAO').some((s) => s.id === 'IMPRESSAO'));
    assert.ok(filterGeneralSections('smtp').some((s) => s.id === 'EMAILS'));
    assert.ok(filterGeneralSections('certificado').some((s) => s.id === 'FISCAL'));
    assert.equal(filterGeneralSections('').length, 9);
    assert.equal(filterGeneralSections('zzzz').length, 0);
  });
});

describe('Configurações gerais: numerações a partir de códigos reais', () => {
  it('pega o maior número no fim dos códigos', () => {
    assert.equal(lastNumberFromCodes(['PROP-2026-0041', 'PROP-2026-0042', '4695', null, undefined, 'SEM-NUMERO-X']), 4695);
    assert.equal(lastNumberFromCodes(['OS-12', 'OS-9']), 12);
  });
  it('sem base real fica vazio', () => {
    assert.equal(lastNumberFromCodes([]), null);
    assert.equal(lastNumberFromCodes(['ABC', '']), null);
    assert.equal(nextNumberLabel(null), 'Próximo - sem base');
    assert.equal(nextNumberLabel(1352), 'Próximo - 1353');
  });
  it('padrão não inventa números', () => {
    assert.deepEqual(buildDefaultErpGeneralSettings().numeracoes, {});
  });
});

describe('Configurações gerais: impressão', () => {
  it('resumo Básico: todos, nenhum ou personalizado', () => {
    const f = PRINT_FIELDS.find((x) => x.key === 'descricaoProduto')!;
    assert.equal(printFieldSummary(f, { ORCAMENTO: true, VENDA: true, OS: true, COMPRA: true }).state, 'ALL');
    assert.equal(printFieldSummary(f, {}).state, 'NONE');
    assert.equal(printFieldSummary(f, { ORCAMENTO: true, VENDA: true }).label, 'Personalizado - 2 de 4');
  });
});

describe('Configurações gerais: sem segredos no modelo salvo', () => {
  it('merge descarta chaves de senha/token e e-mails ficam sempre no servidor do sistema', () => {
    const merged = mergeErpGeneralSettings({
      emails: { mode: 'SMTP', smtpHost: 'smtp.exemplo.invalid', smtpPassword: 'x' },
      geral: { recordsPerPage: 50, adminPassword: 'y', apiToken: 'z' },
    });
    assert.deepEqual(merged.emails, { mode: 'SISTEMA' });
    assert.equal(merged.geral.recordsPerPage, 50);
    assert.equal(merged.geral.valueDecimals, 2);
    const json = JSON.stringify(sanitizeErpGeneralSettingsForSave(merged as never));
    assert.doesNotMatch(json, /smtp|[Pp]assword|[Tt]oken|senha/);
  });
  it('E-mails: seção informativa (Resend), sem campo de senha, SMTP e Testar desabilitados', () => {
    const tsx = src('src/app/components/ErpGeneralSettingsPage.tsx')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    assert.doesNotMatch(tsx, /localStorage|sessionStorage|console\.(log|info|debug|warn|error)/);
    assert.doesNotMatch(tsx, /type="password"|smtpPassword|setSmtp/);
    assert.match(tsx, /Servidor do sistema \(Resend\)/);
    assert.match(tsx, /Disponível em breve/);
    assert.match(tsx, /aria-disabled="true"/);
    assert.match(tsx, /<button type="button" disabled[^>]*>\s*<Send[^>]*\/> Testar envio/);
  });
  it('ERP: item Gerais abre a página dedicada e Fiscal leva ao Certificado', () => {
    const erp = src('src/app/components/ErpGestaoClickTab.tsx');
    assert.match(erp, /activeSubId === 'CFG_GERAIS'\s*\?\s*'ERP_GENERAL_SETTINGS'/);
    assert.match(erp, /onOpenErpCertificate=\{\(\) => setActiveSubId\('CFG_CERTIFICADO'\)\}/);
  });
});

// ============================================================================
// STI-hub ERP - Limpeza visual no estilo GestãoClick (aprovada pelo Marcéllo 02/11/2026).
// Só interface: leitura das fontes. Dados, RBAC e rotas não mudam.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GESTAO_CLICK_MENU_TREE } from '../src/app/components/GestaoClickSidebar';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const ACCENT = '#1e3a6e';

describe('Cor de destaque única (#1e3a6e)', () => {
  it('tokens globais: --sti-accent no CSS e accent no Tailwind', () => {
    const css = src('src/app/globals.css');
    assert.match(css, /--sti-accent: #1e3a6e;/);
    assert.match(css, /--hs-lorax: var\(--sti-accent\);/);
    assert.match(src('tailwind.config.js'), /accent: \{ DEFAULT: 'var\(--sti-accent\)'/);
  });
  it('sem laranja #ff7a59 nem #1F2B68 nas telas de Configurações, IAM, Início e moldura do ERP', () => {
    for (const f of [
      'src/app/components/ErpGestaoClickTab.tsx',
      'src/app/components/GestaoClickSidebar.tsx',
      'src/app/components/GestaoClickDashboard.tsx',
      'src/app/components/StiHubAdminRbacPanel.tsx',
      'src/app/components/UserAccountModal.tsx',
      'src/app/components/DataHealthTab.tsx',
      'src/app/components/ErpGeneralSettingsPage.tsx',
      'src/app/lib/AuthCardShell.tsx',
      'src/app/login/page.tsx',
      'src/app/page.tsx',
    ]) {
      const s = src(f);
      assert.doesNotMatch(s, /#ff7a59|#e86646|#1F2B68/i, f);
    }
    assert.match(src('src/app/components/ErpGeneralSettingsPage.tsx'), new RegExp(`const NAVY = '${ACCENT}'`));
  });
});

describe('Início sem grade de aplicativos', () => {
  const dash = src('src/app/components/GestaoClickDashboard.tsx');
  it('sem GC_APPS, selos Novo/CONECTADO, bloco Novidades e textos "Clique em qualquer"', () => {
    assert.doesNotMatch(dash, /GC_APPS|badge: 'Novo'|CONECTADO|Novidades|Seus <span|Clique em qualquer/);
  });
  it('Recebido/Pago usam o mês corrente', () => {
    assert.doesNotMatch(dash, /Recebido em outubro|Pago em outubro/);
    assert.match(dash, /Recebido em \{currentMonthLabel\(\)\}/);
    assert.match(dash, /Pago em \{currentMonthLabel\(\)\}/);
  });
  it('mantém saldo, fluxo de caixa, vendas, contas bancárias e agenda', () => {
    for (const t of ['fluxo de caixa', 'vendas', 'contas bancárias', 'agenda &amp; O.S.']) assert.ok(dash.includes(t), t);
  });
});

describe('Moldura, sidebar e barra mobile do ERP', () => {
  const tab = src('src/app/components/ErpGestaoClickTab.tsx');
  const side = src('src/app/components/GestaoClickSidebar.tsx');
  it('sem selo API ERP-GROK e sem shadow-md no contêiner; status vai para Sincronização & Logs', () => {
    assert.doesNotMatch(tab, /API ERP-GROK • Loja/);
    assert.match(tab, /<div className="rounded-lg overflow-hidden border border-slate-200 bg-\[#f3f5f8\]">/);
    assert.match(tab, /activeSubId === 'CFG_LOGS' && \(\s*<p data-testid="status-integracao-gestaoclick"/);
  });
  it('sidebar sem contadores e sem rodapé CNPJ/regime; rótulos curtos', () => {
    assert.doesNotMatch(side, /countVal|moduleCounts|ERP • SETA TELECOM LTDA|Regime: \{taxRegime\}/);
    assert.doesNotMatch(tab, /moduleCounts=\{\{/);
    const labels = GESTAO_CLICK_MENU_TREE.flatMap((g) => (g.subItems || []).map((x) => x.label));
    assert.ok(labels.includes('NF-e de importação'));
    assert.ok(labels.includes('Homologação'));
    assert.ok(!labels.some((l) => /Sebrae 4\.0|11 Módulos/.test(l)));
  });
  it('item ativo com fundo neutro e texto na cor de destaque; chips mobile neutros', () => {
    assert.match(side, /'bg-white text-\[#1e3a6e\] font-semibold border border-slate-200'/);
    assert.match(side, /'bg-slate-100 text-\[#1e3a6e\] font-semibold'/);
    assert.match(tab, /\? 'bg-white text-\[#1e3a6e\] border-\[#1e3a6e\]'\s*: 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'/);
    assert.doesNotMatch(side, /font-black|font-extrabold/);
  });
});

describe('Abas de Configurações e Data Health', () => {
  const panel = src('src/app/components/StiHubAdminRbacPanel.tsx');
  it('textos de desenvolvimento e códigos saíram dos títulos', () => {
    assert.doesNotMatch(panel, /DIRETÓRIO DE CONTAS SETA TELECOM|STI-HUB MAILER|6\.414 Registros Reais|Ficha Fiscal e Bancária|CFG_EMPRESA \/ LOJA MATRIZ/);
    assert.doesNotMatch(panel, /\(`https:\/\/sti-hub\.vercel\.app\/proposta\/prop-seta-001`\)/); // texto de ajuda com link fixo
    assert.match(panel, />Dados da empresa</);
    assert.match(panel, />Homologação da migração</);
  });
  it('SMTP/DKIM em seção recolhida; status da homologação em pílula clara', () => {
    assert.match(panel, /<details data-testid="smtp-detalhes"/);
    assert.doesNotMatch(panel, /'bg-emerald-600 text-white'|'bg-rose-600 text-white'|'bg-amber-500 text-white'/);
  });
  it('Data Health do ERP: nota em cartão branco e checagens em tabela, sem gradiente', () => {
    const dh = src('src/app/components/DataHealthTab.tsx');
    const erp = dh.slice(dh.indexOf("resolvedScope === 'ERP' ? ("), dh.indexOf('{/* ERP AUDIT FILTER BAR */}'));
    assert.match(erp, /data-testid="erp-health-nota" className="bg-white rounded-lg border border-slate-200 p-5"/);
    assert.match(erp, /<table/);
    assert.doesNotMatch(erp, /bg-gradient|shadow-lg/);
    assert.match(dh, /'Data Health do ERP'/);
  });
});

describe('Fora do escopo desta rodada (decisões em aberto)', () => {
  it('menu de Configurações mantém Marca, Lojas, Avisos e Meu plano; barra de abas da Central continua (Campos customizáveis e Segurança)', () => {
    const cfg = GESTAO_CLICK_MENU_TREE.find((g) => g.id === 'CONFIGURACOES')!;
    const ids = (cfg.subItems || []).map((x) => x.id);
    for (const id of ['CFG_MARCA', 'CFG_LOJAS', 'CFG_AVISOS', 'CFG_PLANO']) assert.ok(ids.includes(id), id);
    const panel = src('src/app/components/StiHubAdminRbacPanel.tsx');
    assert.match(panel, /id: 'CUSTOM_PROPERTIES' as const/);
    assert.match(panel, /id: 'SUBDOMAIN_SECURITY' as const/);
  });
  it('aba Balcão (PDV) dentro de Vendas não foi alterada', () => {
    assert.match(src('src/app/components/ErpGestaoClickTab.tsx'), /activeSubId === 'VENDAS_BALCAO' \? \(/);
  });
});

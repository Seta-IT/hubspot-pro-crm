'use client';

import React, { useMemo, useState } from 'react';
import {
  FileSpreadsheet,
  FileCode2,
  Plus,
  Trash2,
  CheckCircle2,
  Download,
  Printer,
  Globe,
  Calculator,
  Upload,
  Sparkles,
} from 'lucide-react';
import {
  ErpFiscalInvoice,
  ErpImportDeclarationInfo,
  ErpImportNfeMetadata,
  GestaoClickConfig,
} from '../../db/types';
import {
  analyzeAndFixSebraeTxt,
  BACEN_COUNTRIES,
  calculateSebraeImportNfe,
  parseImportFileToSebraeDraft,
  RawImportItemDraft,
  SEBRAE_REFERENCE_CASES,
  SebraeImportDraftPayload,
  SebraeTxtAnalysisResult,
} from '../../modules/erp/sebrae-nfe-import-engine';
import { formatBRL } from './ui-helpers';

interface SebraeImportNfeWorkspaceProps {
  config: GestaoClickConfig;
  importInvoices: ErpFiscalInvoice[];
  initialUploadedFile?: { content: string; fileName: string; trigger: number } | null;
  onInvoiceCreated: (invoice: ErpFiscalInvoice) => Promise<void>;
  onPrintInvoice: (invoice: ErpFiscalInvoice) => void;
  onEditInvoice: (invoice: ErpFiscalInvoice) => void;
  onDeleteInvoice: (invoice: ErpFiscalInvoice) => Promise<void>;
  onShowToast: (msg: string) => void;
}

type SebraeStepTab =
  | 'ABA_1_NFE'
  | 'ABA_2_EXPORTADOR'
  | 'ABA_3_DI_ADUANA'
  | 'ABA_4_ITENS_IMPOSTOS'
  | 'ABA_5_TOTAIS_INFCPL'
  | 'ABA_6_TXT_XML_FIREWALL';

export default function SebraeImportNfeWorkspace({
  config,
  importInvoices,
  initialUploadedFile,
  onInvoiceCreated,
  onPrintInvoice,
  onEditInvoice,
  onDeleteInvoice,
  onShowToast,
}: SebraeImportNfeWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<SebraeStepTab>('ABA_4_ITENS_IMPOSTOS');
  const [emitting, setEmitting] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pastedText, setPastedText] = useState('');

  const [serie, setSerie] = useState('1');
  const [nNF, setNNF] = useState(String(12 + importInvoices.length));
  const [natOp, setNatOp] = useState(
    'IMPORTACAO DE MERCADORIA PARA COMERCIALIZACAO / PARQUE DE LOCACAO'
  );
  const [crt, setCrt] = useState<'1' | '2' | '3'>('1');
  const [finNFe, setFinNFe] = useState<'1' | '2'>('1');
  const [indFinal, setIndFinal] = useState<'0' | '1'>('0');
  const [indPres] = useState<'0' | '9'>('0');
  const [indIntermed, setIndIntermed] = useState<'0' | '1'>('0');

  const [di, setDi] = useState<ErpImportDeclarationInfo>({
    nDI: '26/1849201-4',
    dDI: '2026-10-18',
    xLocDesemb: 'PORTO DE SANTOS - ALFANDEGA RFB',
    UFDesemb: 'SP',
    dDesemb: '2026-10-21',
    tpViaTransp: '1',
    vAFRMM: 320.0,
    tpIntermedio: '1',
    cExportador: 'YEALINK-CN-XM88',
    currency: 'USD',
    exchangeRatePtax: 5.725,
    fobTotalForeign: 4200,
    freteInternacionalBrl: 1450.0,
    seguroInternacionalBrl: 310.0,
    taxaSiscomexTotalBrl: 214.5,
    outrasDespesasAduaneirasBrl: 680.0,
    somarTributosEmVOutroSimples: true,
    exporterIdEstrangeiro: 'CN-XM-91350200MA',
    exporterName: 'YEALINK NETWORK TECHNOLOGY CO., LTD.',
    exporterAddress: "No. 666 Hu'an Road, Huli District, Xiamen, Fujian",
    exporterCountryCodeBacen: '1600',
    exporterCountryName: 'CHINA, REPUBLICA POPULAR',
    additions: [
      { nAdicao: '1', nSeqAdic: '1', cFabricante: 'YEALINK-CN-XM88', vDescDI: 0 },
      { nAdicao: '2', nSeqAdic: '1', cFabricante: 'YEALINK-CN-XM88', vDescDI: 0 },
    ],
  });

  const [rawItems, setRawItems] = useState<RawImportItemDraft[]>([
    {
      id: 'imp-item-1',
      cProd: 'GC-EQ-00103',
      cEAN: 'SEM GTIN',
      xProd: 'TERMINAL IP GIGABIT YEALINK SIP-T43U POE HD VOICE',
      ncm: '85171891',
      cfop: '3.102',
      uCom: 'UN',
      qCom: 20,
      fobUnitForeign: 145,
      orig: '1',
      csosn: '900',
      cstIpi: '49',
      cstPisCofins: '70',
      iiRatePercent: 12.0,
      ipiRatePercent: 5.0,
      pisRatePercent: 2.1,
      cofinsRatePercent: 9.65,
      icmsRatePercent: 18.0,
      icmsReductionPercent: 0,
      nAdicao: '1',
      nSeqAdic: '1',
      cFabricante: 'YEALINK-CN-XM88',
    },
    {
      id: 'imp-item-2',
      cProd: 'GC-EQ-00104',
      cEAN: 'SEM GTIN',
      xProd: 'GATEWAY VOZ FXO/SIP & SWITCH 24P GIGABIT POE+ RACK 19',
      ncm: '85176259',
      cfop: '3.551',
      uCom: 'UN',
      qCom: 5,
      fobUnitForeign: 260,
      orig: '1',
      csosn: '900',
      cstIpi: '49',
      cstPisCofins: '70',
      iiRatePercent: 12.0,
      ipiRatePercent: 5.0,
      pisRatePercent: 2.1,
      cofinsRatePercent: 9.65,
      icmsRatePercent: 18.0,
      icmsReductionPercent: 0,
      nAdicao: '2',
      nSeqAdic: '1',
      cFabricante: 'YEALINK-CN-XM88',
    },
  ]);

  const [txtAnalyzerInput, setTxtAnalyzerInput] = useState<string>(
    SEBRAE_REFERENCE_CASES.NE000007.txt
  );
  const [txtAnalyzerFilename, setTxtAnalyzerFilename] = useState<string>(
    'NE000007_IMPORTACAO_SEBRAE_401.txt'
  );
  const [txtAnalysisResult, setTxtAnalysisResult] = useState<SebraeTxtAnalysisResult>(() =>
    analyzeAndFixSebraeTxt(SEBRAE_REFERENCE_CASES.NE000007.txt, 'NE000007_IMPORTACAO_SEBRAE_401.txt')
  );
  const [importedDraftBanner, setImportedDraftBanner] = useState<SebraeImportDraftPayload | null>(null);

  const computedMeta: ErpImportNfeMetadata = useMemo(() => {
    return calculateSebraeImportNfe({
      serie,
      nNF,
      natOp,
      crt,
      finNFe,
      indFinal,
      indPres,
      indIntermed,
      di,
      rawItems,
      emitterName: config.companyLegalName,
      emitterCnpj: config.companyCnpj,
      emitterIe: config.stateRegistration,
      emitterUf: 'SP',
    });
  }, [
    serie,
    nNF,
    natOp,
    crt,
    finNFe,
    indFinal,
    indPres,
    indIntermed,
    di,
    rawItems,
    config.companyLegalName,
    config.companyCnpj,
    config.stateRegistration,
  ]);

  const handleEmitImportNfe = async () => {
    setEmitting(true);
    try {
      const res = await fetch('/api/erp/nfe-importacao/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serie,
          nNF,
          natOp,
          crt,
          finNFe,
          indFinal,
          indPres,
          indIntermed,
          di,
          rawItems,
        }),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.data) {
          await onInvoiceCreated(j.data);
          setNNF(String(Number(nNF || 12) + 1));
          onShowToast(
            `NF-e de Importação ${j.data.documentNumber} (DI ${di.nDI}) emitida no padrão Sebrae 4.01 e escriturada em Compras!`
          );
        }
      }
    } finally {
      setEmitting(false);
    }
  };

  const handleDownloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    onShowToast(`Arquivo ${filename} baixado com sucesso!`);
  };

  const handleRunTxtAnalyzer = (txtToAnalyze?: string, name?: string) => {
    const src = txtToAnalyze ?? txtAnalyzerInput;
    const fname = name ?? txtAnalyzerFilename;
    const res = analyzeAndFixSebraeTxt(src, fname);
    setTxtAnalysisResult(res);
    onShowToast(
      `Análise concluída: ${res.recordsCount} registros, ${res.itemsCount} itens e ${res.findings.length} diagnósticos do Firewall Fiscal!`
    );
  };

  const handleImportFileAndPopulateTabs = (rawContent: string, fileName: string) => {
    try {
      const parsed = parseImportFileToSebraeDraft(rawContent, fileName, {
        emitterName: config.companyLegalName,
        emitterCnpj: config.companyCnpj,
        emitterIe: config.stateRegistration,
        emitterUf: "SP",
      });
      setSerie(parsed.serie);
      setNNF(parsed.nNF);
      setNatOp(parsed.natOp);
      setCrt(parsed.crt);
      setFinNFe(parsed.finNFe);
      setIndFinal(parsed.indFinal);
      setIndIntermed(parsed.indIntermed);
      setDi(parsed.di);
      setRawItems(parsed.rawItems);
      setTxtAnalyzerInput(rawContent);
      setTxtAnalyzerFilename(fileName);
      setTxtAnalysisResult({
        filename: fileName,
        recordsCount: rawContent.split(/\r?\n/).filter((l) => l.trim()).length,
        itemsCount: parsed.rawItems.length,
        noteNumber: parsed.nNF,
        crt: parsed.crt,
        findings: parsed.findings,
        correctedTxt: parsed.correctedTxt,
      });
      setImportedDraftBanner(parsed);
      setActiveTab("ABA_4_ITENS_IMPOSTOS");
      onShowToast(parsed.summaryText);
    } catch (err) {
      onShowToast(
        err instanceof Error ? err.message : "Erro ao processar o arquivo TXT/XML de importação."
      );
    }
  };

  React.useEffect(() => {
    if (initialUploadedFile && initialUploadedFile.content) {
      handleImportFileAndPopulateTabs(initialUploadedFile.content, initialUploadedFile.fileName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUploadedFile?.trigger]);

  const readFileFromBrowser = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || "");
      handleImportFileAndPopulateTabs(content, file.name);
    };
    reader.readAsText(file, "utf-8");
  };

  const handleUploadTxtFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readFileFromBrowser(file);
    e.target.value = "";
  };

  const handleDropFile = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      readFileFromBrowser(file);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-[#0f172a] via-[#1e3a6e] to-[#0f172a] text-white rounded-md p-5 border border-slate-700 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded bg-emerald-400 text-slate-950 text-[10px] font-normal uppercase tracking-wider">
                EMISSOR NF-e 4.01 SEBRAE • SIMPLES NACIONAL (CRT=1 / CSOSN 900)
              </span>
              <span className="px-2.5 py-0.5 rounded bg-white/10 text-amber-300 text-[10px] font-mono font-normal border border-amber-400/30">
                Layout SEFAZ 4.00 + Motor SetaIT/app-nfe-importacao
              </span>
            </div>
            <h3 className="text-base font-semibold tracking-tight">
              Emissão de NF-e de Entrada de Importação Direta (CFOP 3.102 / 3.551 / 3.101)
            </h3>
            <p className="text-xs text-slate-300">
              Cálculo automático de Conversão PTAX, Valor Aduaneiro (CIF), II, IPI, PIS-Importação (2,10%), COFINS-Importação (9,65%), Rateio SISCOMEX/AFRMM e <span>Base de Cálculo do ICMS &ldquo;Por Dentro&rdquo; (Art. 13, V da LC 87/96)</span>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                handleDownloadFile(
                  computedMeta.sebraeTxtContent || '',
                  `NFE_IMP_${nNF}_SEBRAE_401.txt`,
                  'text/plain;charset=utf-8'
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-white/10 hover:bg-white/20 text-white text-xs font-normal border border-white/20 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-300" /> Baixar TXT Sebrae 4.01
            </button>
            <button
              type="button"
              onClick={() =>
                handleDownloadFile(
                  computedMeta.sefazXmlContent || '',
                  `NFE_IMP_${nNF}_SEFAZ_400.xml`,
                  'application/xml;charset=utf-8'
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-white/10 hover:bg-white/20 text-white text-xs font-normal border border-white/20 cursor-pointer"
            >
              <FileCode2 className="w-3.5 h-3.5 text-amber-300" /> Baixar XML 4.00
            </button>
            <button
              type="button"
              disabled={emitting}
              onClick={handleEmitImportNfe}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-normal shadow-md cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {emitting ? 'Emitindo NF-e...' : `Emitir & Escriturar NF-e Importação #${nNF}`}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 mt-4 pt-4 border-t border-white/15 text-xs">
          <div className="bg-white/10 rounded p-2.5 border border-white/10">
            <span className="text-[10px] uppercase font-normal text-slate-300 block">
              Valor Produtos (FOB R$)
            </span>
            <span className="text-sm font-normal text-white">
              {formatBRL(computedMeta.totals.vProd)}
            </span>
            <span className="text-[10px] text-emerald-300 block">
              PTAX: R$ {di.exchangeRatePtax.toFixed(4)}/{di.currency}
            </span>
          </div>
          <div className="bg-white/10 rounded p-2.5 border border-white/10">
            <span className="text-[10px] uppercase font-normal text-slate-300 block">
              Valor Aduaneiro (CIF)
            </span>
            <span className="text-sm font-normal text-white">
              {formatBRL(computedMeta.totals.vAduaneiro)}
            </span>
            <span className="text-[10px] text-slate-300 block">
              Frete+Seg: {formatBRL(computedMeta.totals.vFrete + computedMeta.totals.vSeg)}
            </span>
          </div>
          <div className="bg-white/10 rounded p-2.5 border border-white/10">
            <span className="text-[10px] uppercase font-normal text-slate-300 block">
              II + IPI Importação
            </span>
            <span className="text-sm font-normal text-amber-300">
              {formatBRL(computedMeta.totals.vII + computedMeta.totals.vIPI)}
            </span>
            <span className="text-[10px] text-slate-300 block">
              II: {formatBRL(computedMeta.totals.vII)} | IPI: {formatBRL(computedMeta.totals.vIPI)}
            </span>
          </div>
          <div className="bg-white/10 rounded p-2.5 border border-white/10">
            <span className="text-[10px] uppercase font-normal text-slate-300 block">
              PIS (2,1%) + COFINS (9,65%)
            </span>
            <span className="text-sm font-normal text-cyan-300">
              {formatBRL(computedMeta.totals.vPIS + computedMeta.totals.vCOFINS)}
            </span>
            <span className="text-[10px] text-slate-300 block">
              SISCOMEX+Desp: {formatBRL(computedMeta.totals.vSiscomex + computedMeta.totals.vDespAduaneiras + computedMeta.totals.vAFRMM)}
            </span>
          </div>
          <div className="bg-emerald-500/20 rounded p-2.5 border border-emerald-400/40">
            <span className="text-[10px] uppercase font-normal text-emerald-200 block">
              BC ICMS &ldquo;Por Dentro&rdquo; (18%)
            </span>
            <span className="text-sm font-normal text-emerald-300">
              {formatBRL(computedMeta.totals.vBC_ICMS)}
            </span>
            <span className="text-[10px] text-emerald-200 block">
              ICMS Devido: {formatBRL(computedMeta.totals.vICMS)}
            </span>
          </div>
          <div className="bg-[#ff7a59]/25 rounded p-2.5 border border-[#ff7a59]/60">
            <span className="text-[10px] uppercase font-normal text-amber-200 block">
              Total da NF-e (vNF)
            </span>
            <span className="text-base font-normal text-white">
              {formatBRL(computedMeta.totals.vNF)}
            </span>
            <span className="text-[10px] text-amber-200 block">
              vOutro: {formatBRL(computedMeta.totals.vOutro)}
            </span>
          </div>
        </div>
      </div>

      {/* DROPZONE PRINCIPAL DE ALTO DESTAQUE: ARRASTE OU SELECIONE ARQUIVO .TXT (SEBRAE 4.01) OU .XML (NF-e 4.00 / DI) */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDropFile}
        className={`rounded-lg border-2 border-dashed p-6 transition shadow-sm space-y-4 ${
          isDraggingOver
            ? "border-[#ff7a59] bg-orange-50/80"
            : "border-emerald-600 bg-emerald-50/40 hover:bg-emerald-50/70"
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 rounded bg-emerald-700 text-white text-xs font-normal uppercase tracking-wide">
                PASSO 1 — ENVIAR ARQUIVO .TXT (SEBRAE 4.01) OU .XML (NF-e 4.00 / DI)
              </span>
              <span className="text-xs font-normal text-emerald-950">
                Arraste e solte seu arquivo aqui ou clique no botão ao lado para selecionar do computador!
              </span>
            </div>
            <p className="text-xs text-slate-700">
              Ao enviar seu <span>.TXT</span> ou <span>.XML</span>, o sistema preenche automaticamente todas as abas (Exportador Estrangeiro, DI/Adições, Produtos/NCM, CFOP 3.102/3.551, CSOSN 900 e ICMS &ldquo;Por Dentro&rdquo;) e libera a emissão imediata.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <label className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-sm font-normal shadow-md cursor-pointer transition">
              <Upload className="w-5 h-5" /> Selecionar Arquivo .TXT ou .XML do Computador
              <input
                type="file"
                accept=".txt,.xml,text/plain,text/xml,application/xml"
                hidden
                onChange={handleUploadTxtFile}
              />
            </label>
            <button
              type="button"
              onClick={() => setShowPasteBox((v) => !v)}
              className="px-3.5 py-3 rounded-lg bg-white hover:bg-slate-100 text-slate-900 text-xs font-normal border border-slate-300 cursor-pointer"
            >
              {showPasteBox ? "Ocultar Colagem" : "Colar Conteúdo TXT / XML"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-emerald-200/80 text-xs">
          <span className="font-normal text-slate-600">Ou teste agora com 1 clique:</span>
          <button
            type="button"
            onClick={() =>
              handleImportFileAndPopulateTabs(
                SEBRAE_REFERENCE_CASES.NE000007.txt,
                "NE000007_SEBRAE_401.txt"
              )
            }
            className="px-3 py-1.5 rounded bg-white hover:bg-slate-100 text-slate-800 text-xs font-normal border border-slate-300 cursor-pointer"
          >
            Carregar Exemplo TXT NE000007
          </button>
          <button
            type="button"
            onClick={() =>
              handleImportFileAndPopulateTabs(
                SEBRAE_REFERENCE_CASES.NE000012.txt,
                "NE000012_SEBRAE_401.txt"
              )
            }
            className="px-3 py-1.5 rounded bg-white hover:bg-slate-100 text-slate-800 text-xs font-normal border border-slate-300 cursor-pointer"
          >
            Carregar Exemplo TXT NE000012
          </button>
          <button
            type="button"
            onClick={() =>
              handleImportFileAndPopulateTabs(
                computedMeta.sefazXmlContent || "",
                `NFE_IMP_${nNF}_SEFAZ_400.xml`
              )
            }
            className="px-3 py-1.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-900 text-xs font-normal border border-indigo-200 cursor-pointer"
          >
            Carregar Exemplo XML 4.00
          </button>
        </div>

        {showPasteBox && (
          <div className="p-3.5 rounded-lg bg-white border border-slate-300 space-y-2 text-xs">
            <label className="block font-normal text-slate-800">
              Cole abaixo o conteúdo completo do seu arquivo .TXT (Sebrae 4.01) ou .XML (NF-e 4.00 / DI):
            </label>
            <textarea
              rows={6}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Cole aqui o conteúdo começando por NOTA FISCAL|1| ou <?xml version=..."
              className="w-full p-2.5 rounded border border-slate-300 font-mono text-[11px] bg-slate-950 text-emerald-300"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPasteBox(false)}
                className="px-3 py-1.5 rounded border border-slate-300 font-normal"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!pastedText.trim()) return;
                  const fname = pastedText.trim().startsWith("<")
                    ? "IMPORTACAO_COLADA.xml"
                    : "IMPORTACAO_COLADA_SEBRAE_401.txt";
                  handleImportFileAndPopulateTabs(pastedText, fname);
                  setShowPasteBox(false);
                }}
                className="px-4 py-1.5 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white font-normal cursor-pointer"
              >
                Processar Texto Colado &amp; Preencher Abas
              </button>
            </div>
          </div>
        )}

        {importedDraftBanner && (
          <div className="p-3.5 rounded bg-teal-950 text-white border border-teal-500 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-emerald-400 text-slate-950 text-[10px] font-normal uppercase">
                  ARQUIVO CARREGADO NAS ABAS ({importedDraftBanner.sourceFormat})
                </span>
                <span className="font-mono font-normal text-emerald-300">
                  {importedDraftBanner.filename} &rarr; NF-e #{importedDraftBanner.nNF} • DI {importedDraftBanner.di.nDI}
                </span>
              </div>
              <div className="text-slate-200 text-[11px]">
                {importedDraftBanner.summaryText}
              </div>
              {importedDraftBanner.findings.filter((f) => f.autoFix).length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {importedDraftBanner.findings
                    .filter((f) => f.autoFix)
                    .map((f, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded bg-amber-400/20 border border-amber-300/40 text-amber-200 text-[10px] font-normal"
                      >
                        Auto-Fix [{f.record}]: {f.message}
                      </span>
                    ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={emitting}
                onClick={handleEmitImportNfe}
                className="px-4 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-normal shadow-sm cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />
                {emitting ? "Emitindo..." : `Confirmar & Emitir NF-e #${nNF}`}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("ABA_6_TXT_XML_FIREWALL")}
                className="px-3 py-2 rounded bg-white/15 hover:bg-white/25 text-white text-xs font-normal cursor-pointer"
              >
                Ver Diagnóstico Firewall
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-md border border-slate-200 p-2 flex flex-wrap items-center gap-1.5">
        {[
          { id: 'ABA_1_NFE', label: '1. Dados da NF-e (Reg. B • Mod. 55)' },
          { id: 'ABA_2_EXPORTADOR', label: '2. Exportador Estrangeiro (Reg. E • UF EX)' },
          { id: 'ABA_3_DI_ADUANA', label: '3. DI / DUIMP, Câmbio & Aduana (Reg. I18/I25)' },
          { id: 'ABA_4_ITENS_IMPOSTOS', label: `4. Produtos & Impostos CSOSN 900 (${rawItems.length})` },
          { id: 'ABA_5_TOTAIS_INFCPL', label: '5. Totais W02 & Inf. Complementares (Reg. Z)' },
          { id: 'ABA_6_TXT_XML_FIREWALL', label: '6. Validador TXT Sebrae 4.01 & XML (Firewall Fiscal)' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id as SebraeStepTab)}
            className={`px-3 py-2 rounded text-xs font-normal transition cursor-pointer ${
              activeTab === t.id
                ? 'bg-[#1e3a6e] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'ABA_1_NFE' && (
        <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4 text-xs">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <span className="text-[10px] font-normal uppercase text-[#1e3a6e] block">
                Emissor Sebrae 4.01 • Aba 1 — Grupo B (&lt;ide&gt;) e Grupo C (&lt;emit&gt;)
              </span>
              <h4 className="text-sm font-semibold text-slate-900">
                Identificação da NF-e de Entrada de Importação (Simples Nacional CRT=1)
              </h4>
            </div>
            <span className="px-2.5 py-1 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[11px] font-normal">
              tpNF=0 (Entrada) • idDest=3 (Exterior) • indIntermed={indIntermed}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block font-normal text-slate-700 mb-1">Modelo / Série</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  disabled
                  value="55 (NF-e)"
                  className="w-24 px-2.5 py-2 rounded border bg-slate-100 font-mono font-normal text-slate-600"
                />
                <input
                  type="text"
                  value={serie}
                  onChange={(e) => setSerie(e.target.value)}
                  className="flex-1 px-3 py-2 rounded border border-slate-300 font-mono font-normal"
                  placeholder="Série (1)"
                />
              </div>
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">Número da NF-e (nNF)</label>
              <input
                type="text"
                value={nNF}
                onChange={(e) => setNNF(e.target.value)}
                className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-normal"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-normal text-slate-700 mb-1">
                Natureza da Operação (natOp) *
              </label>
              <input
                type="text"
                value={natOp}
                onChange={(e) => setNatOp(e.target.value)}
                className="w-full px-3 py-2 rounded border border-slate-300 font-normal"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                Código de Regime Tributário (CRT)
              </label>
              <select
                value={crt}
                onChange={(e) => setCrt(e.target.value as '1' | '2' | '3')}
                className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-normal text-emerald-900"
              >
                <option value="1">1 — Simples Nacional (CSOSN 900)</option>
                <option value="2">2 — Simples Nacional (Excesso Sublimite)</option>
                <option value="3">3 — Regime Normal (Lucro Presumido / Real)</option>
              </select>
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">Finalidade de Emissão (finNFe)</label>
              <select
                value={finNFe}
                onChange={(e) => setFinNFe(e.target.value as '1' | '2')}
                className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-normal"
              >
                <option value="1">1 — NF-e Normal (Desembaraço Inicial)</option>
                <option value="2">2 — NF-e Complementar (Variação Cambial / Imposto)</option>
              </select>
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">Consumidor Final (indFinal)</label>
              <select
                value={indFinal}
                onChange={(e) => setIndFinal(e.target.value as '0' | '1')}
                className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-normal"
              >
                <option value="0">0 — Normal (Comercialização / Locação)</option>
                <option value="1">1 — Consumidor Final (Ativo Imobilizado CFOP 3.551)</option>
              </select>
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                Indicador de Intermediador (indIntermed)
              </label>
              <select
                value={indIntermed}
                onChange={(e) => setIndIntermed(e.target.value as '0' | '1')}
                className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-normal"
              >
                <option value="0">0 — Operação sem intermediador (Padrão Sebrae 4.01)</option>
                <option value="1">1 — Operação em site/plataforma de terceiros</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'ABA_2_EXPORTADOR' && (
        <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4 text-xs">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <span className="text-[10px] font-normal uppercase text-[#1e3a6e] block">
                Emissor Sebrae 4.01 • Aba 2 — Grupo E (&lt;dest&gt; / &lt;idEstrangeiro&gt;)
              </span>
              <h4 className="text-sm font-semibold text-slate-900">
                Fornecedor / Exportador Estrangeiro (UF = EX • Município = 9999999 EXTERIOR)
              </h4>
            </div>
            <Globe className="w-5 h-5 text-[#1e3a6e]" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block font-normal text-slate-700 mb-1">
                Razão Social do Exportador no Exterior (xNome) *
              </label>
              <input
                type="text"
                value={di.exporterName}
                onChange={(e) => setDi({ ...di, exporterName: e.target.value })}
                className="w-full px-3 py-2 rounded border border-slate-300 font-normal"
              />
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                ID Estrangeiro (E03a / idEstrangeiro) *
              </label>
              <input
                type="text"
                value={di.exporterIdEstrangeiro}
                onChange={(e) => setDi({ ...di, exporterIdEstrangeiro: e.target.value })}
                className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-normal"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                País do Exportador (Tabela BACEN / SEFAZ)
              </label>
              <select
                value={di.exporterCountryCodeBacen}
                onChange={(e) => {
                  const found = BACEN_COUNTRIES.find((c) => c.code === e.target.value);
                  setDi({
                    ...di,
                    exporterCountryCodeBacen: e.target.value,
                    exporterCountryName: found?.name || 'EXTERIOR',
                  });
                }}
                className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-normal"
              >
                {BACEN_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                Código do Exportador na DI (cExportador)
              </label>
              <input
                type="text"
                value={di.cExportador}
                onChange={(e) => setDi({ ...di, cExportador: e.target.value })}
                className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
              />
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                UF &amp; Município Padrão SEFAZ Exterior
              </label>
              <input
                type="text"
                disabled
                value="UF: EX | cMun: 9999999 (EXTERIOR)"
                className="w-full px-3 py-2 rounded border bg-slate-100 font-mono text-slate-600"
              />
            </div>
          </div>

          <div>
            <label className="block font-normal text-slate-700 mb-1">
              Endereço Completo no Exterior (xLgr / xBairro)
            </label>
            <input
              type="text"
              value={di.exporterAddress}
              onChange={(e) => setDi({ ...di, exporterAddress: e.target.value })}
              className="w-full px-3 py-2 rounded border border-slate-300"
            />
          </div>
        </div>
      )}

      {activeTab === 'ABA_3_DI_ADUANA' && (
        <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div>
              <span className="text-[10px] font-normal uppercase text-[#1e3a6e] block">
                Emissor Sebrae 4.01 • Aba 3 — Registros I18 (&lt;DI&gt;) e I25 (&lt;adi&gt;)
              </span>
              <h4 className="text-sm font-semibold text-slate-900">
                Declaração de Importação (DI / DSI / DUIMP), Taxa PTAX e Despesas Aduaneiras
              </h4>
            </div>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-emerald-50 border border-emerald-300 text-emerald-950 font-normal cursor-pointer">
              <input
                type="checkbox"
                checked={di.somarTributosEmVOutroSimples}
                onChange={(e) =>
                  setDi({ ...di, somarTributosEmVOutroSimples: e.target.checked })
                }
              />
              <span>
                Regra Sebrae 4.01 Simples Nacional: Somar PIS + COFINS + ICMS em Outras Despesas (vOutro) p/ fechar vNF sem Rejeição 610
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                Nº da DI / DSI / DUIMP (nDI) *
              </label>
              <input
                type="text"
                value={di.nDI}
                onChange={(e) => setDi({ ...di, nDI: e.target.value })}
                className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-normal text-[#1e3a6e]"
              />
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                Data de Registro da DI (dDI)
              </label>
              <input
                type="date"
                value={di.dDI}
                onChange={(e) => setDi({ ...di, dDI: e.target.value })}
                className="w-full px-3 py-2 rounded border border-slate-300"
              />
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                Local do Desembaraço (xLocDesemb)
              </label>
              <input
                type="text"
                value={di.xLocDesemb}
                onChange={(e) => setDi({ ...di, xLocDesemb: e.target.value })}
                className="w-full px-3 py-2 rounded border border-slate-300 font-normal"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-normal text-slate-700 mb-1">UF Desemb.</label>
                <input
                  type="text"
                  maxLength={2}
                  value={di.UFDesemb}
                  onChange={(e) => setDi({ ...di, UFDesemb: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-normal text-center"
                />
              </div>
              <div>
                <label className="block font-normal text-slate-700 mb-1">Data Desemb.</label>
                <input
                  type="date"
                  value={di.dDesemb}
                  onChange={(e) => setDi({ ...di, dDesemb: e.target.value })}
                  className="w-full px-2 py-2 rounded border border-slate-300"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                Via de Transporte Internacional (tpViaTransp)
              </label>
              <select
                value={di.tpViaTransp}
                onChange={(e) =>
                  setDi({
                    ...di,
                    tpViaTransp: e.target.value as ErpImportDeclarationInfo['tpViaTransp'],
                  })
                }
                className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-normal"
              >
                <option value="1">1 — Marítima (Exige AFRMM)</option>
                <option value="4">4 — Aérea (Viracopos / GRU)</option>
                <option value="7">7 — Rodoviária</option>
                <option value="9">9 — Meios Próprios / Courier</option>
              </select>
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                Forma de Importação (tpIntermedio)
              </label>
              <select
                value={di.tpIntermedio}
                onChange={(e) =>
                  setDi({
                    ...di,
                    tpIntermedio: e.target.value as '1' | '2' | '3',
                  })
                }
                className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-normal"
              >
                <option value="1">1 — Importação por Conta Própria</option>
                <option value="2">2 — Importação por Conta e Ordem</option>
                <option value="3">3 — Importação por Encomenda</option>
              </select>
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">Moeda da DI</label>
              <select
                value={di.currency}
                onChange={(e) =>
                  setDi({ ...di, currency: e.target.value as 'USD' | 'EUR' | 'CNY' })
                }
                className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-normal"
              >
                <option value="USD">USD — Dólar Americano</option>
                <option value="EUR">EUR — Euro</option>
                <option value="CNY">CNY — Yuan Chinês (Renminbi)</option>
              </select>
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                Taxa de Câmbio PTAX da DI (R$) *
              </label>
              <input
                type="number"
                step="0.0001"
                min="0.01"
                value={di.exchangeRatePtax}
                onChange={(e) =>
                  setDi({ ...di, exchangeRatePtax: Math.max(0.01, Number(e.target.value) || 5.725) })
                }
                className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-normal text-emerald-800"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 p-3.5 rounded bg-slate-50 border border-slate-200">
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                Frete Internacional (R$)
              </label>
              <input
                type="number"
                step="0.01"
                value={di.freteInternacionalBrl}
                onChange={(e) =>
                  setDi({ ...di, freteInternacionalBrl: Math.max(0, Number(e.target.value) || 0) })
                }
                className="w-full px-2.5 py-1.5 rounded border bg-white font-normal"
              />
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                Seguro Internacional (R$)
              </label>
              <input
                type="number"
                step="0.01"
                value={di.seguroInternacionalBrl}
                onChange={(e) =>
                  setDi({ ...di, seguroInternacionalBrl: Math.max(0, Number(e.target.value) || 0) })
                }
                className="w-full px-2.5 py-1.5 rounded border bg-white font-normal"
              />
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                Taxa SISCOMEX (R$)
              </label>
              <input
                type="number"
                step="0.01"
                value={di.taxaSiscomexTotalBrl}
                onChange={(e) =>
                  setDi({ ...di, taxaSiscomexTotalBrl: Math.max(0, Number(e.target.value) || 0) })
                }
                className="w-full px-2.5 py-1.5 rounded border bg-white font-normal"
              />
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                AFRMM Marinha Mercante (R$)
              </label>
              <input
                type="number"
                step="0.01"
                value={di.vAFRMM}
                onChange={(e) =>
                  setDi({ ...di, vAFRMM: Math.max(0, Number(e.target.value) || 0) })
                }
                className="w-full px-2.5 py-1.5 rounded border bg-white font-normal"
              />
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">
                Outras Desp. Aduaneiras (R$)
              </label>
              <input
                type="number"
                step="0.01"
                value={di.outrasDespesasAduaneirasBrl}
                onChange={(e) =>
                  setDi({
                    ...di,
                    outrasDespesasAduaneirasBrl: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                className="w-full px-2.5 py-1.5 rounded border bg-white font-normal"
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'ABA_4_ITENS_IMPOSTOS' && (
        <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div>
              <span className="text-[10px] font-normal uppercase text-[#1e3a6e] block">
                Emissor Sebrae 4.01 • Aba 4 — Registros I (Produto), I18/I25 (DI/Adição), N10h (CSOSN 900), O (IPI), P (II), Q (PIS) e S (COFINS)
              </span>
              <h4 className="text-sm font-semibold text-slate-900">
                Itens Importados &amp; Cálculo Automático do ICMS &ldquo;Por Dentro&rdquo; no Simples Nacional
              </h4>
            </div>
            <button
              type="button"
              onClick={() =>
                setRawItems((prev) => [
                  ...prev,
                  {
                    id: `imp-item-${Date.now()}`,
                    cProd: `GC-EQ-00${prev.length + 105}`,
                    cEAN: 'SEM GTIN',
                    xProd: 'EQUIPAMENTO TELECOM IMPORTADO / APPLIANCE REDE',
                    ncm: '85176259',
                    cfop: '3.102',
                    uCom: 'UN',
                    qCom: 10,
                    fobUnitForeign: 120,
                    orig: '1',
                    csosn: '900',
                    cstIpi: '49',
                    cstPisCofins: '70',
                    iiRatePercent: 12.0,
                    ipiRatePercent: 5.0,
                    pisRatePercent: 2.1,
                    cofinsRatePercent: 9.65,
                    icmsRatePercent: 18.0,
                    icmsReductionPercent: 0,
                    nAdicao: String(prev.length + 1),
                    nSeqAdic: '1',
                    cFabricante: di.cExportador,
                  },
                ])
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-normal cursor-pointer"
            >
              <Plus className="w-4 h-4" /> + Adicionar Item da DI
            </button>
          </div>

          <div className="space-y-3">
            {rawItems.map((raw, idx) => {
              const calc = computedMeta.items[idx];
              return (
                <div
                  key={raw.id}
                  className="p-4 rounded-lg border border-slate-200 bg-slate-50/70 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-[#1e3a6e] text-white font-mono font-normal text-[11px]">
                        Item #{idx + 1} (Adição {raw.nAdicao})
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono font-normal text-[10px]">
                        Origem {raw.orig} (Importação Direta) • CSOSN {raw.csosn} (Simples Nacional)
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={rawItems.length <= 1}
                      onClick={() =>
                        setRawItems((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="text-rose-600 hover:text-rose-800 disabled:opacity-30 cursor-pointer"
                      title="Remover Item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-normal text-slate-600 block">SKU (cProd)</label>
                      <input
                        type="text"
                        value={raw.cProd}
                        onChange={(e) => {
                          const next = [...rawItems];
                          next[idx] = { ...next[idx], cProd: e.target.value };
                          setRawItems(next);
                        }}
                        className="w-full px-2.5 py-1.5 rounded border bg-white font-mono font-normal"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label className="text-[10px] font-normal text-slate-600 block">
                        Descrição da Mercadoria (xProd)
                      </label>
                      <input
                        type="text"
                        value={raw.xProd}
                        onChange={(e) => {
                          const next = [...rawItems];
                          next[idx] = { ...next[idx], xProd: e.target.value };
                          setRawItems(next);
                        }}
                        className="w-full px-2.5 py-1.5 rounded border bg-white font-normal"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-normal text-slate-600 block">NCM (8 díg.)</label>
                      <input
                        type="text"
                        maxLength={8}
                        value={raw.ncm}
                        onChange={(e) => {
                          const next = [...rawItems];
                          next[idx] = { ...next[idx], ncm: e.target.value };
                          setRawItems(next);
                        }}
                        className="w-full px-2.5 py-1.5 rounded border bg-white font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-normal text-slate-600 block">CFOP Entrada</label>
                      <select
                        value={raw.cfop}
                        onChange={(e) => {
                          const next = [...rawItems];
                          next[idx] = {
                            ...next[idx],
                            cfop: e.target.value as RawImportItemDraft['cfop'],
                          };
                          setRawItems(next);
                        }}
                        className="w-full px-2 py-1.5 rounded border bg-white font-mono font-normal"
                      >
                        <option value="3.102">3.102 (Comercialização)</option>
                        <option value="3.551">3.551 (Ativo Imobilizado)</option>
                        <option value="3.101">3.101 (Industrialização)</option>
                        <option value="3.949">3.949 (Outra Entrada Ext.)</option>
                      </select>
                    </div>
                    <div className="sm:col-span-1">
                      <label className="text-[10px] font-normal text-slate-600 block">Qtd</label>
                      <input
                        type="number"
                        min={1}
                        value={raw.qCom}
                        onChange={(e) => {
                          const next = [...rawItems];
                          next[idx] = { ...next[idx], qCom: Math.max(1, Number(e.target.value) || 1) };
                          setRawItems(next);
                        }}
                        className="w-full px-2 py-1.5 rounded border bg-white text-center font-normal"
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="text-[10px] font-normal text-slate-600 block">
                        Unit ({di.currency})
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={raw.fobUnitForeign}
                        onChange={(e) => {
                          const next = [...rawItems];
                          next[idx] = {
                            ...next[idx],
                            fobUnitForeign: Math.max(0, Number(e.target.value) || 0),
                          };
                          setRawItems(next);
                        }}
                        className="w-full px-2 py-1.5 rounded border bg-white text-right font-mono font-normal text-indigo-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 pt-2 border-t border-slate-200">
                    <div>
                      <label className="text-[10px] font-normal text-slate-500 block">
                        Alíq. II (%)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={raw.iiRatePercent}
                        onChange={(e) => {
                          const next = [...rawItems];
                          next[idx] = { ...next[idx], iiRatePercent: Number(e.target.value) || 0 };
                          setRawItems(next);
                        }}
                        className="w-full px-2 py-1 rounded border bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-normal text-slate-500 block">
                        Alíq. IPI (%) — CST {raw.cstIpi}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={raw.ipiRatePercent}
                        onChange={(e) => {
                          const next = [...rawItems];
                          next[idx] = { ...next[idx], ipiRatePercent: Number(e.target.value) || 0 };
                          setRawItems(next);
                        }}
                        className="w-full px-2 py-1 rounded border bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-normal text-slate-500 block">
                        PIS-Imp (%) — CST {raw.cstPisCofins}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={raw.pisRatePercent}
                        onChange={(e) => {
                          const next = [...rawItems];
                          next[idx] = { ...next[idx], pisRatePercent: Number(e.target.value) || 0 };
                          setRawItems(next);
                        }}
                        className="w-full px-2 py-1 rounded border bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-normal text-slate-500 block">
                        COFINS-Imp (%) — CST {raw.cstPisCofins}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={raw.cofinsRatePercent}
                        onChange={(e) => {
                          const next = [...rawItems];
                          next[idx] = { ...next[idx], cofinsRatePercent: Number(e.target.value) || 0 };
                          setRawItems(next);
                        }}
                        className="w-full px-2 py-1 rounded border bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-normal text-emerald-800 block">
                        ICMS Alíq. (%) — CSOSN 900
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={raw.icmsRatePercent}
                        onChange={(e) => {
                          const next = [...rawItems];
                          next[idx] = { ...next[idx], icmsRatePercent: Number(e.target.value) || 0 };
                          setRawItems(next);
                        }}
                        className="w-full px-2 py-1 rounded border bg-white font-mono font-normal text-emerald-900"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-normal text-slate-500 block">
                        Nº Adição DI (I25)
                      </label>
                      <input
                        type="text"
                        value={raw.nAdicao}
                        onChange={(e) => {
                          const next = [...rawItems];
                          next[idx] = { ...next[idx], nAdicao: e.target.value };
                          setRawItems(next);
                        }}
                        className="w-full px-2 py-1 rounded border bg-white font-mono text-center"
                      />
                    </div>
                  </div>

                  {calc && (
                    <div className="p-2.5 rounded bg-white border border-slate-200 grid grid-cols-2 sm:grid-cols-6 gap-2 text-[11px]">
                      <div>
                        <span className="text-slate-400 block">Vlr. Produto (vProd)</span>
                        <span>{formatBRL(calc.vProdBrl)}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Vlr. Aduaneiro (CIF)</span>
                        <span>{formatBRL(calc.valorAduaneiroBrl)}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">II + IPI</span>
                        <span>
                          {formatBRL(calc.iiAmountBrl)} + {formatBRL(calc.ipiAmountBrl)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">PIS + COFINS Imp.</span>
                        <span>
                          {formatBRL(calc.pisAmountBrl + calc.cofinsAmountBrl)}
                        </span>
                      </div>
                      <div className="bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                        <span className="text-emerald-700 text-[10px] font-normal block">
                          BC ICMS Por Dentro / vICMS
                        </span>
                        <span className="text-emerald-950">
                          {formatBRL(calc.icmsBaseCalculoPorDentroBrl)} &rarr; {formatBRL(calc.icmsAmountBrl)}
                        </span>
                      </div>
                      <div className="bg-amber-50 px-2 py-1 rounded border border-amber-200 text-right">
                        <span className="text-amber-800 text-[10px] font-normal block">
                          Total Item NF-e (vNF)
                        </span>
                        <span className="text-amber-950">{formatBRL(calc.totalItemNfeBrl)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'ABA_5_TOTAIS_INFCPL' && (
        <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4 text-xs">
          <div className="border-b pb-3">
            <span className="text-[10px] font-normal uppercase text-[#1e3a6e] block">
              Emissor Sebrae 4.01 • Aba 5 — Grupo W02 (&lt;ICMSTot&gt;) e Grupo Z (&lt;infCpl&gt;)
            </span>
            <h4 className="text-sm font-semibold text-slate-900">
              Fechamento dos Totais da NF-e de Importação &amp; Memorial do Cálculo &ldquo;Por Dentro&rdquo;
            </h4>
          </div>

          <div className="p-4 rounded bg-emerald-50/80 border border-emerald-300 space-y-2">
            <div className="font-normal text-emerald-950 uppercase text-[11px] flex items-center gap-1.5">
              <Calculator className="w-4 h-4 text-emerald-700" />
              Fórmula Legal da Base de Cálculo do ICMS na Importação (Art. 13, V da LC 87/1996)
            </div>
            <p className="font-mono text-[11px] text-emerald-900 bg-white p-2.5 rounded border border-emerald-200">
              BC_ICMS = (Vlr_Aduaneiro [{formatBRL(computedMeta.totals.vAduaneiro)}] + II [{formatBRL(computedMeta.totals.vII)}] + IPI [{formatBRL(computedMeta.totals.vIPI)}] + PIS_Imp [{formatBRL(computedMeta.totals.vPIS)}] + COFINS_Imp [{formatBRL(computedMeta.totals.vCOFINS)}] + SISCOMEX [{formatBRL(computedMeta.totals.vSiscomex)}] + AFRMM [{formatBRL(computedMeta.totals.vAFRMM)}] + Desp_Aduaneiras [{formatBRL(computedMeta.totals.vDespAduaneiras)}]) &divide; (1 &minus; 0,18) = <span>{formatBRL(computedMeta.totals.vBC_ICMS)}</span> &rarr; ICMS (18%) = <span>{formatBRL(computedMeta.totals.vICMS)}</span>
            </p>
          </div>

          <div>
            <label className="block font-normal text-slate-700 mb-1">
              Texto Automático de Informações Complementares (&lt;infCpl&gt; / Registro Z)
            </label>
            <textarea
              rows={4}
              readOnly
              value={computedMeta.infCpl}
              className="w-full p-3 rounded border border-slate-300 bg-slate-50 font-mono text-[11px] text-slate-800"
            />
          </div>
        </div>
      )}

      {activeTab === 'ABA_6_TXT_XML_FIREWALL' && (
        <div className="space-y-4">
          <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
              <div>
                <span className="text-[10px] font-normal uppercase text-[#1e3a6e] block">
                  Motor Integrado do Repositório GitHub SetaIT/app-nfe-importacao
                </span>
                <h4 className="text-sm font-semibold text-slate-900">
                  Firewall Fiscal &amp; Corretor Conservador de TXT para o Emissor Sebrae 4.01 (Casos NE000007 e NE000012)
                </h4>
                <p className="text-slate-500">
                  Corrige automaticamente estrutura, delimitadores, unidade &ldquo;UN.&rdquo; &rarr; &ldquo;UN&rdquo; e realinhamento do CFOP 3102 sem jamais alterar silenciosamente CRT, CFOP, CST, CSOSN, NCM, bases ou valores fiscais.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTxtAnalyzerInput(SEBRAE_REFERENCE_CASES.NE000007.txt);
                    setTxtAnalyzerFilename('NE000007.txt');
                    handleRunTxtAnalyzer(SEBRAE_REFERENCE_CASES.NE000007.txt, 'NE000007.txt');
                  }}
                  className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 font-normal cursor-pointer"
                >
                  Carregar Caso NE000007
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTxtAnalyzerInput(SEBRAE_REFERENCE_CASES.NE000012.txt);
                    setTxtAnalyzerFilename('NE000012.txt');
                    handleRunTxtAnalyzer(SEBRAE_REFERENCE_CASES.NE000012.txt, 'NE000012.txt');
                  }}
                  className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 font-normal cursor-pointer"
                >
                  Carregar Caso NE000012
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const generated = computedMeta.sebraeTxtContent || '';
                    setTxtAnalyzerInput(generated);
                    setTxtAnalyzerFilename(`NFE_IMP_${nNF}_SEBRAE_401.txt`);
                    handleRunTxtAnalyzer(generated, `NFE_IMP_${nNF}_SEBRAE_401.txt`);
                  }}
                  className="px-3 py-1.5 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-normal cursor-pointer"
                >
                  Validar TXT da NF-e Atual (#{nNF})
                </button>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#1e3a6e] text-white font-normal cursor-pointer">
                  <Upload className="w-3.5 h-3.5" /> Upload .TXT
                  <input type="file" accept=".txt,text/plain" hidden onChange={handleUploadTxtFile} />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-normal text-slate-700">
                    Conteúdo TXT de Entrada ({txtAnalyzerFilename})
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleRunTxtAnalyzer()}
                      className="px-3 py-1 rounded bg-slate-800 text-white font-normal cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3 inline mr-1" /> Diagnosticar TXT
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleImportFileAndPopulateTabs(txtAnalyzerInput, txtAnalyzerFilename)
                      }
                      className="px-3 py-1 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white font-normal cursor-pointer"
                    >
                      Carregar nas Abas p/ Emitir NF-e
                    </button>
                  </div>
                </div>
                <textarea
                  rows={10}
                  value={txtAnalyzerInput}
                  onChange={(e) => setTxtAnalyzerInput(e.target.value)}
                  className="w-full p-3 rounded border border-slate-300 font-mono text-[11px] bg-slate-950 text-emerald-300"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-normal text-slate-700">
                    Diagnóstico do Firewall Fiscal ({txtAnalysisResult.findings.length} ocorrências | NF-e: {txtAnalysisResult.noteNumber || '-'} | CRT: {txtAnalysisResult.crt || '-'} | Itens: {txtAnalysisResult.itemsCount})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadFile(
                        txtAnalysisResult.correctedTxt,
                        `${txtAnalyzerFilename.replace(/\.txt$/i, '')}_CORRIGIDO_SEBRAE_401_V1.txt`,
                        'text/plain;charset=utf-8'
                      )
                    }
                    className="px-3 py-1 rounded bg-emerald-600 text-white font-normal cursor-pointer"
                  >
                    <Download className="w-3 h-3 inline mr-1" /> Baixar TXT Corrigido
                  </button>
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {txtAnalysisResult.findings.map((f, idx) => (
                    <div
                      key={idx}
                      className={`p-2.5 rounded border-l-4 ${
                        f.severity === 'error'
                          ? 'bg-rose-50 border-rose-600 text-rose-950'
                          : f.severity === 'warning'
                            ? 'bg-amber-50 border-amber-500 text-amber-950'
                            : 'bg-blue-50 border-blue-600 text-blue-950'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] font-normal uppercase">
                        <span className="px-1.5 py-0.5 rounded bg-white border">{f.category}</span>
                        <span className="px-1.5 py-0.5 rounded bg-white border font-mono">
                          Reg. {f.record}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded ${
                            f.autoFix
                              ? 'bg-emerald-200 text-emerald-900'
                              : 'bg-amber-200 text-amber-900'
                          }`}
                        >
                          {f.autoFix ? 'Correção Estrutural Automática' : 'Protegido pelo Firewall Fiscal'}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px]">{f.message}</div>
                    </div>
                  ))}
                </div>

                <div>
                  <span className="text-[10px] font-normal uppercase text-slate-500 block mb-1">
                    Saída TXT Corrigida (Pronta para Importar no Emissor Sebrae 4.01)
                  </span>
                  <pre className="p-2.5 rounded bg-slate-900 text-slate-100 font-mono text-[10px] max-h-28 overflow-auto">
                    {txtAnalysisResult.correctedTxt}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-md border border-slate-200 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">
              NF-e de Entrada de Importação Emitidas ({importInvoices.length})
            </h4>
            <p className="text-xs text-slate-500">
              Cada NF-e de Importação emitida gera automaticamente o espelho DANFE, o TXT Sebrae 4.01, o XML SEFAZ 4.00 e o registro em Notas de Compras.
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          {importInvoices.map((inv) => {
            const meta = inv.importMetadata;
            return (
              <div
                key={inv.id}
                className="p-4 rounded border border-slate-200 hover:border-slate-300 bg-slate-50/50 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded bg-slate-900 text-white font-mono font-normal">
                      {inv.documentNumber}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 font-normal text-[11px]">
                      NF-e IMPORTAÇÃO SIMPLES NACIONAL (SEBRAE 4.01 • CSOSN 900)
                    </span>
                    <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-mono font-normal text-[11px]">
                      DI: {meta?.di?.nDI || '26/1849201-4'}
                    </span>
                  </div>
                  <div className="font-normal text-slate-900 text-sm">
                    {inv.companyName}
                  </div>
                  <div className="text-slate-500">
                    CFOP: <span className="font-mono text-slate-700">{inv.cfop}</span> • Desembaraço: <span>{inv.issueDate}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-right bg-white px-3 py-1.5 rounded border border-slate-200">
                    <span className="text-[10px] text-slate-500 block">
                      BC ICMS Por Dentro: {formatBRL(meta?.totals?.vBC_ICMS || inv.grossAmount)} | ICMS: {formatBRL(inv.taxBreakdown.icmsAmount)}
                    </span>
                    <span className="text-sm text-emerald-800">
                      Total NF-e (vNF): {formatBRL(inv.grossAmount)}
                    </span>
                  </div>

                  {meta?.sebraeTxtContent && (
                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadFile(
                          meta.sebraeTxtContent!,
                          `${inv.documentNumber}_SEBRAE_401.txt`,
                          'text/plain;charset=utf-8'
                        )
                      }
                      className="px-2.5 py-2 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-normal cursor-pointer"
                    >
                      TXT Sebrae
                    </button>
                  )}
                  {meta?.sefazXmlContent && (
                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadFile(
                          meta.sefazXmlContent!,
                          `${inv.documentNumber}_SEFAZ_400.xml`,
                          'application/xml;charset=utf-8'
                        )
                      }
                      className="px-2.5 py-2 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white font-normal cursor-pointer"
                    >
                      XML 4.00
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onPrintInvoice(inv)}
                    className="px-3 py-2 rounded bg-slate-900 text-white font-normal cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5 inline mr-1" /> DANFE Importação
                  </button>
                  <button
                    type="button"
                    onClick={() => onEditInvoice(inv)}
                    className="px-2.5 py-2 rounded bg-amber-500 text-white font-normal cursor-pointer"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteInvoice(inv)}
                    className="p-2 rounded bg-rose-50 text-rose-700 border border-rose-200 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

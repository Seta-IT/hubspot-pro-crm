// ============================================================================
// Upload do TXT/XML da NF-e de Importação: o seletor de arquivo precisa abrir sempre.
// O <input type="file"> fica sempre montado, escondido só visualmente (sr-only), ligado por
// <label htmlFor>, e o teclado chama inputRef.current.click() de forma síncrona.
// (Verificação em navegador: Chrome e Firefox headless abriram o filechooser nos 3 botões.)
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Remove comentários de linha e de bloco para checar só o código.
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Upload de arquivo da NF-e de Importação (seletor do sistema)', () => {
  it('ImportFilePicker: input sempre montado com sr-only (sem hidden/display:none), label htmlFor e click síncrono', () => {
    const src = code(read('src/app/components/ImportFilePicker.tsx'));
    assert.match(src, /type="file"/);
    assert.match(src, /className="sr-only"/);
    assert.match(src, /htmlFor=\{inputId\}/);
    assert.match(src, /id=\{inputId\}/);
    assert.doesNotMatch(src, /\bhidden\b\s*(\n|\/>|=)/);
    assert.doesNotMatch(src, /display:\s*['"]?none/);
    // click síncrono: nenhuma espera antes de inputRef.current.click()
    const opener = src.slice(src.indexOf('const openChooserSync'), src.indexOf('return ('));
    assert.match(opener, /inputRef\.current\?\.click\(\)/);
    assert.doesNotMatch(opener, /await|setTimeout|requestAnimationFrame|set[A-Z]\w*\(/);
  });

  it('os botões do cabeçalho do Fiscal, de Compras e do PASSO 1 usam o ImportFilePicker (nenhum input file com hidden)', () => {
    const tab = read('src/app/components/ErpGestaoClickTab.tsx');
    const ws = read('src/app/components/SebraeImportNfeWorkspace.tsx');
    for (const id of ['upload-nfe-importacao-fiscal', 'upload-nfe-importacao-compras']) {
      assert.ok(tab.includes(`testId="${id}"`), id);
    }
    for (const id of ['upload-nfe-importacao-passo1', 'upload-nfe-importacao-analisador']) {
      assert.ok(ws.includes(`testId="${id}"`), id);
    }
    const hiddenFileInput = /<input[^>]*type="file"[^>]*\bhidden\b/s;
    assert.doesNotMatch(tab, hiddenFileInput);
    assert.doesNotMatch(ws, hiddenFileInput);
  });
});

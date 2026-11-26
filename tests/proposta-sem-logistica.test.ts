import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function walkSrcFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkSrcFiles(p, acc);
    else if (/\.(ts|tsx|js|html)$/.test(name)) acc.push(p);
  }
  return acc;
}

describe('Folha, PDF e e-mail do cliente sem a seção de logística inventada', () => {
  it('remove Logística, Remessa & Instalação (e o título de venda equivalente) de todos os modelos, e mantém o Frete no resumo', () => {
    const page = src('src/app/proposta/[id]/page.tsx');
    assert.equal(page.includes('Logística, Remessa & Instalação'), false);
    assert.equal(page.includes('Logística, Transporte & Entrega'), false);
    assert.equal(page.includes('Frota Própria Seta Telecom'), false);
    assert.equal(page.includes('BLOCO 8 E 9: TRANSPORTE/ENTREGA'), false);
    assert.ok(page.includes('FRETE R$:'));
    assert.ok(page.includes('showFreightInTotals'));
    assert.match(page, />\s*Frete\s*</);
  });

  it('o título da seção não reaparece em visualização, PDF ou e-mail, em nenhum modelo', () => {
    const hits = walkSrcFiles(join(process.cwd(), 'src')).filter((f) => {
      const t = readFileSync(f, 'utf8');
      return t.includes('Logística, Remessa & Instalação') || t.includes('Logística, Transporte & Entrega');
    });
    assert.deepEqual(hits, [], hits.join('\n'));
  });
});

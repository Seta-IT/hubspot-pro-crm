import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Regressao: useState depois de `if (!erpData) return` quebra o ERP no primeiro
 * clique (dominio novo / bootstrap frio) com o erro padrao do Next.js
 * "Application error: a client-side exception has occurred".
 */
describe('ErpGestaoClickTab — ordem dos hooks vs early return !erpData', () => {
  const tab = readFileSync(join(process.cwd(), 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');

  it('rowBillingPreviewContract useState fica ANTES do early return !erpData', () => {
    const hook = tab.indexOf(
      'const [rowBillingPreviewContract, setRowBillingPreviewContract] = useState<ErpRentalContract | null>(null)'
    );
    const early = tab.indexOf('if (!erpData)');
    assert.ok(hook > 0, 'useState rowBillingPreviewContract deve existir');
    assert.ok(early > 0, 'early return !erpData deve existir');
    assert.ok(
      hook < early,
      'useState rowBillingPreviewContract deve vir antes de if (!erpData) (Rules of Hooks)'
    );
  });

  it('nao ha outros useState/useEffect/useMemo de nivel de componente depois do early return !erpData', () => {
    const early = tab.indexOf('if (!erpData)');
    assert.ok(early > 0);
    // Do early return ate o fim do arquivo: qualquer useX( no indent de 2 espacos
    // (nivel do corpo da funcao) e uma violacao. Hooks dentro de nested functions
    // tem indent maior.
    const after = tab.slice(early);
    const bad = after.match(/^\s{2}const \[[^\]]+\] = use(?:State|Effect|Memo|Callback|Ref|LayoutEffect)\b/m);
    assert.equal(bad, null, `hook apos early return: ${bad && bad[0]}`);
  });
});

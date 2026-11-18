import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  excludeTakenRecipientSuggestions,
  nextRecipientSuggestionsOpen,
} from '../src/app/components/email/recipient-suggest';

const SRC = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('lista de sugestões de destinatários', () => {
  it('abre só ao digitar e fecha ao escolher, Esc, clique fora ou perder o foco', () => {
    assert.equal(nextRecipientSuggestionsOpen(false, 'type'), true);
    assert.equal(nextRecipientSuggestionsOpen(true, 'type'), true);
    assert.equal(nextRecipientSuggestionsOpen(true, 'select'), false);
    assert.equal(nextRecipientSuggestionsOpen(true, 'escape'), false);
    assert.equal(nextRecipientSuggestionsOpen(true, 'outside'), false);
    assert.equal(nextRecipientSuggestionsOpen(true, 'blur'), false);
    assert.equal(nextRecipientSuggestionsOpen(false, 'focus'), false);
    assert.equal(nextRecipientSuggestionsOpen(true, 'focus'), true);
  });

  it('não sugere e-mails que já estão no Para, mesmo com caixa diferente', () => {
    const rows = [
      { email: 'ana@totvs.com', name: 'Ana' },
      { email: 'bruno@totvs.com', name: 'Bruno' },
      { email: 'ANA@totvs.com', name: 'Ana duplicada' },
      { email: '', name: 'vazio' },
    ];
    assert.deepEqual(
      excludeTakenRecipientSuggestions(rows, ['ana@totvs.com']),
      [{ email: 'bruno@totvs.com', name: 'Bruno' }]
    );
  });

  it('o campo compartilhado e o compositor do CRM usam a mesma política', () => {
    const field = SRC('src/app/components/email/EmailRecipientField.tsx');
    const crm = SRC('src/app/components/email/CrmEmailComposerModal.tsx');
    const erp = SRC('src/app/components/ClientEmailComposerModal.tsx');

    for (const src of [field, crm]) {
      assert.match(src, /from '\.\/recipient-suggest'/);
      assert.match(src, /nextRecipientSuggestionsOpen\([^,]+, 'select'\)/);
      assert.match(src, /nextRecipientSuggestionsOpen\([^,]+, 'escape'\)/);
      assert.match(src, /nextRecipientSuggestionsOpen\([^,]+, 'outside'\)/);
      assert.match(src, /nextRecipientSuggestionsOpen\([^,]+, 'blur'\)/);
      assert.match(src, /nextRecipientSuggestionsOpen\([^,]+, 'type'\)/);
      assert.match(src, /excludeTakenRecipientSuggestions/);
    }

    assert.match(field, /nextRecipientSuggestionsOpen\([^,]+, 'focus'\)/);
    assert.doesNotMatch(field, /onFocus=\{\(\) => setOpen\(true\)\}/);
    assert.match(crm, /suggestOpen && visibleToSuggestions\.length > 0/);
    assert.doesNotMatch(crm, /contactHits\.length > 0 \|\| suggestions\.length > 0/);
    assert.match(erp, /EmailRecipientField/);
    assert.match(erp, /excludeEmails=\{\[\.\.\.toChips/);
  });
});

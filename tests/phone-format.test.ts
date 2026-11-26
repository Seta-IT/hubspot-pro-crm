// ============================================================================
// STI-hub — Telefone no padrao HubSpot (26/11/2026): componente unico PhoneInput,
// mascara nacional, ramal so em fixo, validacao de tamanho, gravacao em E.164 e leitura
// de valores antigos em texto livre sem perder dados.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEFAULT_PHONE_COUNTRY,
  formatNationalAsYouType,
  formatPhoneForDisplay,
  isMobileNumber,
  maxNationalDigits,
  parseStoredPhone,
  phoneCountryOptions,
  splitExtension,
  toStoredPhone,
  validateNational,
} from '../src/app/lib/phone-format';
import PhoneInput from '../src/app/components/PhoneInput';
import { normalizeAndValidatePhone, storedPhoneFromValidation } from '../src/modules/data-health/validators';
import { proposalTelUrl, proposalWhatsAppUrl } from '../src/app/lib/proposal-share';

const ROOT = join(__dirname, '..', '..');
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('phone-format: mascara e validacao', () => {
  it('Brasil +55 e o padrao e vem primeiro na lista de paises', () => {
    assert.equal(DEFAULT_PHONE_COUNTRY, 'BR');
    const opts = phoneCountryOptions();
    assert.equal(opts[0].code, 'BR');
    assert.ok(opts.length > 200);
  });
  it('mascara BR de celular e fixo enquanto digita', () => {
    assert.equal(formatNationalAsYouType('BR', '11985842279'), '(11) 98584-2279');
    assert.equal(formatNationalAsYouType('BR', '1133334444'), '(11) 3333-4444');
    assert.equal(formatNationalAsYouType('BR', '1198'), '(11) 98');
  });
  it('tamanho: BR aceita no maximo 11 digitos; curto/longo/ok', () => {
    assert.equal(maxNationalDigits('BR'), 11);
    assert.equal(validateNational('BR', ''), 'EMPTY');
    assert.equal(validateNational('BR', '1198584'), 'TOO_SHORT');
    assert.equal(validateNational('BR', '11985842279'), 'OK');
    assert.equal(validateNational('BR', '1133334444'), 'OK');
    assert.equal(validateNational('BR', '119858422799'), 'TOO_LONG');
  });
  it('celular x fixo (ramal so para fixo)', () => {
    assert.equal(isMobileNumber('BR', '11985842279'), true);
    assert.equal(isMobileNumber('BR', '1133334444'), false);
  });
});

describe('phone-format: gravacao E.164 e exibicao', () => {
  it('grava E.164 e ramal em ;ext=', () => {
    assert.equal(toStoredPhone('BR', '(11) 98584-2279'), '+5511985842279');
    assert.equal(toStoredPhone('BR', '1133334444', '123'), '+551133334444;ext=123');
    assert.equal(toStoredPhone('US', '4155552671'), '+14155552671');
  });
  it('exibe BR em formato nacional e exterior em internacional', () => {
    assert.equal(formatPhoneForDisplay('+5511985842279'), '(11) 98584-2279');
    assert.equal(formatPhoneForDisplay('+551133334444;ext=123'), '(11) 3333-4444 ramal 123');
    assert.equal(formatPhoneForDisplay('+14155552671'), '+1 415 555 2671');
  });
  it('le valores antigos em texto livre sem perder dados', () => {
    assert.equal(parseStoredPhone('+55 (11) 98765-4321').e164, '+5511987654321');
    assert.equal(parseStoredPhone('(11) 3958-4929').e164, '+551139584929');
    assert.equal(parseStoredPhone('11 9999-0000').e164, '+551199990000');
    assert.equal(parseStoredPhone('5511985842279').e164, '+5511985842279');
    assert.equal(parseStoredPhone('0014155552671').e164, '+14155552671');
    const r = parseStoredPhone('(11) 3333-4444 ramal 21');
    assert.equal(r.e164, '+551133334444');
    assert.equal(r.ext, '21');
    // Nao interpretavel: mantem como esta.
    for (const raw of ['ligar para a recepção', '1234', 'falar c/ Ana 11 3333']) {
      const p = parseStoredPhone(raw);
      assert.equal(p.ok, false, raw);
      assert.equal(p.raw, raw);
      assert.equal(formatPhoneForDisplay(raw), raw);
    }
  });
  it('splitExtension reconhece ramal/ext/x/#', () => {
    assert.deepEqual(splitExtension('(11) 3333-4444 r. 12'), { number: '(11) 3333-4444', ext: '12' });
    assert.deepEqual(splitExtension('+551133334444;ext=7'), { number: '+551133334444', ext: '7' });
    assert.deepEqual(splitExtension('1133334444 x55'), { number: '1133334444', ext: '55' });
    assert.equal(splitExtension('1133334444').ext, '');
  });
});

describe('servidor: normalizacao so ao salvar', () => {
  it('validador separa o ramal e gera o valor E.164 a gravar', () => {
    const v = normalizeAndValidatePhone('+551133334444;ext=12');
    assert.equal(v.isValid, true);
    assert.equal(v.e164, '+551133334444');
    assert.equal(v.extension, '12');
    assert.equal(storedPhoneFromValidation(v), '+551133334444;ext=12');
    assert.equal(storedPhoneFromValidation(normalizeAndValidatePhone('(11) 98584-2279')), '+5511985842279');
    assert.equal(storedPhoneFromValidation(normalizeAndValidatePhone('abc')), null);
  });
  it('repositorio e Minha Conta gravam E.164 (texto invalido fica como veio)', () => {
    const repo = src('src/db/repository.ts');
    assert.match(repo, /phone: storedPhoneFromValidation\(phoneVal\) \?\? input\.phone \?\? null/);
    assert.match(repo, /storedPhoneFromValidation\(phoneVal\) \?\? patch\.phone/);
    assert.match(src('src/api/self-profile.ts'), /storedPhoneFromValidation\(r\)/);
  });
  it('links tel:/wa.me ignoram o ramal', () => {
    assert.equal(proposalTelUrl('+551133334444;ext=12'), 'tel:+551133334444');
    assert.equal(proposalWhatsAppUrl('+5511985842279'), 'https://wa.me/5511985842279');
  });
});

describe('PhoneInput: componente unico em todos os formularios', () => {
  it('renderiza bandeira + DDI, mascara e ramal so em fixo', () => {
    const fixo = renderToStaticMarkup(
      React.createElement(PhoneInput, { value: '+551133334444;ext=12', onChange: () => {}, kind: 'phone' })
    );
    assert.match(fixo, /\+55/);
    assert.match(fixo, /🇧🇷/);
    assert.match(fixo, /\(11\) 3333-4444/);
    assert.match(fixo, /value="12"/);
    const cel = renderToStaticMarkup(
      React.createElement(PhoneInput, { value: '+5511985842279', onChange: () => {}, kind: 'mobile' })
    );
    assert.match(cel, /\(11\) 98584-2279/);
    assert.doesNotMatch(cel, /[Rr]amal/);
    const legado = renderToStaticMarkup(
      React.createElement(PhoneInput, { value: 'falar com a recepção', onChange: () => {} })
    );
    assert.match(legado, /falar com a recepção/);
  });
  it('todos os campos de telefone/celular usam o PhoneInput', () => {
    const files = [
      'src/app/components/AssociationSidePanel.tsx',
      'src/app/components/ContactDetailDrawer.tsx',
      'src/app/components/ContactsCompaniesTab.tsx',
      'src/app/components/UserAccountModal.tsx',
      'src/app/components/StiHubAdminRbacPanel.tsx',
      'src/app/components/GestaoClickCompanyModal.tsx',
      'src/app/components/GestaoClickEnrichedModals.tsx',
      'src/app/components/ErpEditModals.tsx',
      'src/app/portal/page.tsx',
    ];
    for (const f of files) assert.match(src(f), /<PhoneInput/, f);
    assert.match(src('src/app/components/AssociationSidePanel.tsx'), /fd\.key === 'mobile' \? 'mobile' : 'phone'/);
  });
});

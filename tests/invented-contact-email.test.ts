import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import {
  displayContactEmail,
  isInventedContactEmail,
  contactEmailForRead,
} from '../src/modules/data-health/invented-contact-email';
import { validateEmail } from '../src/modules/data-health/validators';
import { collectEmailRecipients, parseEmailList } from '../src/modules/erp/send-email-guards';
import { isContactEligibleForFollowup } from '../src/modules/deals/proposal-followup-service';

const INVENTED = 'decisor.deticompras.zavd@contato.setatelecom.com.br';

describe('E-mails inventados pelo cadastro de contato', () => {
  it('reconhece o padrão exato do gerador antigo e rejeita e-mails reais', () => {
    assert.equal(isInventedContactEmail(INVENTED), true);
    assert.equal(isInventedContactEmail('Decisor.DeTiCompras.ZAVD@Contato.SetaTelecom.com.br'), true);
    assert.equal(isInventedContactEmail('contato.ab12@contato.setatelecom.com.br'), true);
    assert.equal(isInventedContactEmail('joao.silva.a9z0@contato.setatelecom.com.br'), true);
    assert.equal(isInventedContactEmail('joao.silva@empresa.com.br'), false);
    assert.equal(isInventedContactEmail('vendas@setatelecom.com.br'), false);
    assert.equal(isInventedContactEmail('alguem@contato.setatelecom.com.br'), false);
    assert.equal(isInventedContactEmail('decisor.deticompras.zavdx@contato.setatelecom.com.br'), false);
    assert.equal(contactEmailForRead(INVENTED), '');
    assert.equal(displayContactEmail(INVENTED), '--');
    assert.equal(displayContactEmail(''), '--');
    assert.equal(displayContactEmail('  '), '--');
    assert.equal(displayContactEmail('ana@microfast.com.br'), 'ana@microfast.com.br');
  });

  it('validateEmail trata o padrão inventado como inválido e vazio como EMPTY_EMAIL', () => {
    const invented = validateEmail(INVENTED);
    assert.equal(invented.isValid, false);
    assert.equal(invented.reason, 'INVENTED_EMAIL');
    assert.equal(invented.normalizedEmail, '');
    const empty = validateEmail('');
    assert.equal(empty.isValid, false);
    assert.equal(empty.reason, 'EMPTY_EMAIL');
    const real = validateEmail('compras@microfast.com.br');
    assert.equal(real.isValid, true);
  });

  it('createContact não inventa e-mail: campo vazio, isValidEmail false, leitura "--"', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const res = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'POST',
      path: '/api/contacts',
      body: {
        firstName: 'Decisor de TI / Compras',
        lastName: '',
        companyName: 'MICROFAST ELETRONICA LTDA',
        phone: '(11)3227-8026',
      },
    });
    assert.equal(res.status, 201);
    const created = (res.body as { data: { id: string; email: string; isValidEmail: boolean } }).data;
    assert.equal(created.email, '');
    assert.equal(created.isValidEmail, false);
    assert.equal(displayContactEmail(created.email), '--');
    const stored = repo.getState().contacts.find((c) => c.id === created.id);
    assert.ok(stored);
    assert.equal(stored!.email, '');
    assert.ok(!String(stored!.email).includes('@contato.setatelecom.com.br'));

    const second = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'POST',
      path: '/api/contacts',
      body: { firstName: 'Outro', lastName: 'Sem Email', phone: '(11)3000-0000' },
    });
    assert.equal(second.status, 201);
    const c2 = (second.body as { data: { id: string; email: string } }).data;
    assert.equal(c2.email, '');
    assert.notEqual(c2.id, created.id);
  });

  it('na leitura, mascara e-mails já persistidos no padrão e não apaga o valor no estado', () => {
    const repo = createInMemoryRepository();
    const created = repo.createContact({
      firstName: 'Decisor de TI / Compras',
      companyName: 'MICROFAST ELETRONICA LTDA',
    });
    const raw = repo.getState().contacts.find((c) => c.id === created.id);
    assert.ok(raw);
    raw!.email = INVENTED;
    raw!.isValidEmail = true;

    const read = repo.getContactById(created.id);
    assert.equal(read?.email, '');
    assert.equal(read?.isValidEmail, false);
    assert.equal(displayContactEmail(read?.email), '--');
    assert.equal(repo.getState().contacts.find((c) => c.id === created.id)?.email, INVENTED);

    const listed = repo.listContacts().find((c) => c.id === created.id);
    assert.equal(listed?.email, '');
    assert.equal(repo.listContacts({ search: 'contato.setatelecom' }).some((c) => c.id === created.id), false);
  });

  it('bloqueia follow-up, cobrança e proposta para o endereço inventado', () => {
    const repo = createInMemoryRepository();
    const created = repo.createContact({
      firstName: 'Decisor de TI / Compras',
      companyName: 'MICROFAST ELETRONICA LTDA',
    });
    const raw = repo.getState().contacts.find((c) => c.id === created.id);
    assert.ok(raw);
    raw!.email = INVENTED;
    raw!.isValidEmail = true;

    const followup = isContactEligibleForFollowup(repo, raw!);
    assert.equal(followup.ok, false);
    assert.equal(followup.reason, 'NO_VALID_EMAIL');

    const marketing = repo.canSendMarketingEmailToContact(created.id);
    assert.equal(marketing.allowed, false);

    const parsed = parseEmailList(INVENTED);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, /inventado/i);
    }

    const recipients = collectEmailRecipients({ to: INVENTED });
    assert.equal(recipients.ok, false);
    if (!recipients.ok) {
      assert.match(recipients.error, /inventado|inválido/i);
    }

    const real = collectEmailRecipients({ to: 'compras@microfast.com.br' });
    assert.equal(real.ok, true);
  });
});

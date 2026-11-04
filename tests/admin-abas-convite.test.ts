import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
const expect = (v: string) => ({ toContain: (x: string) => assert.ok(v.includes(x), x), not: { toContain: (x: string) => assert.ok(!v.includes(x), x) } });
import { readFileSync } from 'fs';
const src = readFileSync('src/app/components/StiHubAdminRbacPanel.tsx', 'utf8');
describe('Configurações: abas limpas e reenviar convite', () => {
  it('abas sem contagens nem detalhes técnicos', () => {
    for (const l of ["'Usuários'", "'E-mail e Modelos'", "'Campos Customizáveis'", "'Homologação da Migração'", "'Sincronização Diária'", "'Segurança'"]) expect(src).toContain(`label: ${l}`);
    expect(src).not.toContain('(#4369067)');
    expect(src).not.toContain('(11 Módulos)');
    expect(src).not.toContain('Rotas & Subdomínio');
  });
  it('selo de aprovados cinza', () => {
    const i = src.indexOf('data-testid="migracao-aprovados"');
    expect(src.slice(i, i + 200)).toContain('bg-slate-100');
    expect(src.slice(i, i + 200)).not.toContain('emerald');
  });
  it('botão Reenviar convite só para admin e com retorno de falha', () => {
    expect(src).toContain('Reenviar convite');
    expect(src).toContain("canManageInvites && (!u.lastLoginAt || u.inviteStatus === 'PENDING_INVITE')");
    expect(src).toContain('Falha ao reenviar o convite');
  });
});

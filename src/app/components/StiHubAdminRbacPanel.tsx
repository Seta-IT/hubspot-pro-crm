'use client';

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Users,
  KeyRound,
  Mail,
  Globe,
  Database,
  CheckCircle2,
  Plus,
  Send,
  Lock,
  Sparkles,
  ExternalLink,
  RefreshCw,
  Edit3,
  UserCheck,
} from 'lucide-react';
import {
  CrmEmailTemplate,
  CrmEmailTemplateCategory,
  StiHubActionGuards,
  StiHubModuleAccessLevel,
  StiHubRbacState,
  StiHubRoleDefinition,
  StiHubRoleId,
  StiHubUserRecord,
  StiHubVisibilityScope,
} from '../../db/types';
import { STI_HUB_MODULES_LIST } from '../../modules/erp/rbac-seed';
import {
  DEFAULT_CERTIFICATE_SERIES_SETTINGS,
  DEFAULT_COMPANY_EMITTER_SETTINGS,
  DEFAULT_GENERAL_PARAMETERS,
  ErpSyncRunLog,
  INITIAL_MIGRATION_CHECKLIST_11_MODULES,
  INITIAL_SYNC_LOGS,
  MigrationChecklistModuleItem,
  StiHubCertificateAndSeriesSettings,
  StiHubCompanyEmitterSettings,
  StiHubGeneralSystemParameters,
} from '../../modules/erp/daily-sync-service';

export type AdminSubView =
  | 'USERS_RBAC'
  | 'COMPANY_EMITTER'
  | 'CERTIFICATE_SERIES'
  | 'EMAIL_TEMPLATES'
  | 'CUSTOM_PROPERTIES'
  | 'DAILY_SYNC_LOGS'
  | 'MIGRATION_CHECKLIST'
  | 'SUBDOMAIN_SECURITY';

interface StiHubAdminRbacPanelProps {
  rbacState: StiHubRbacState | null;
  emailTemplates?: CrmEmailTemplate[];
  initialSubView?: AdminSubView;
  activeUser?: StiHubUserRecord | null;
  onSelectActiveUser?: (user: StiHubUserRecord) => void;
  onRefresh: () => Promise<void>;
  onShowToast: (msg: string) => void;
}

const ACTION_GUARD_LABELS: Array<{ key: keyof StiHubActionGuards; label: string; desc: string }> = [
  {
    key: 'canViewFinancialBalances',
    label: 'Ver Saldos Bancários & DRE',
    desc: 'Permite visualizar saldos das 9 contas (Inter/Itaú) e DRE Gerencial',
  },
  {
    key: 'canIssueFiscalDocuments',
    label: 'Emitir Fatura SV 31 / NFS-e / NF-e',
    desc: 'Permite emitir documentos fiscais oficiais e NFC-e no PDV',
  },
  {
    key: 'canApproveProposals',
    label: 'Aprovar Propostas -> Contratos',
    desc: 'Permite converter Orçamento #4695 em Contrato de Locação ativo',
  },
  {
    key: 'canMergeRecords',
    label: 'Unificar Duplicados (Data Health)',
    desc: 'Permite executar Merge e Auto-Clean (respeitando Trava de CNPJ)',
  },
  {
    key: 'canDeleteRecords',
    label: 'Excluir Registros (CRM & ERP)',
    desc: 'Permite remover propostas, negócios, contatos ou lançamentos',
  },
  {
    key: 'canExportData',
    label: 'Exportar Relatórios & CSV',
    desc: 'Permite exportar bases de contatos, submissões e relatórios BI',
  },
  {
    key: 'canManageUsersRbac',
    label: 'Gerenciar Usuários & RBAC',
    desc: 'Permite criar usuários, alterar perfis RBAC e parâmetros MFA',
  },
];

export default function StiHubAdminRbacPanel({
  rbacState,
  emailTemplates = [],
  initialSubView = 'USERS_RBAC',
  activeUser,
  onSelectActiveUser,
  onRefresh,
  onShowToast,
}: StiHubAdminRbacPanelProps) {
  const [subView, setSubView] = useState<AdminSubView>(initialSubView);
  const [selectedRoleId, setSelectedRoleId] = useState<StiHubRoleId>('SUPER_ADMIN');
  const [userFilter, setUserFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [searchUser, setSearchUser] = useState('');
  const [savingRole, setSavingRole] = useState(false);

  // New user modal state
  const [showNewUserModal, setShowNewUserModal] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('(11) 3958-4929');
  const [newUserDept, setNewUserDept] = useState('Comercial B2B & Locação');
  const [newUserTitle, setNewUserTitle] = useState('Executivo de Contas');
  const [newUserRole, setNewUserRole] = useState<StiHubRoleId>('VENDEDOR_SALES');
  const [newUserScope, setNewUserScope] = useState<StiHubVisibilityScope>('PROPRIOS');

  // Email template creator & test dispatch state
  const [testRecipient, setTestRecipient] = useState('marcelo.mira@setatelecom.com.br');
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [lastTestProtocol, setLastTestProtocol] = useState<string | null>(null);
  const [tplName, setTplName] = useState('');
  const [tplCategory, setTplCategory] = useState<CrmEmailTemplateCategory>('PROPOSTA');
  const [tplSubject, setTplSubject] = useState(
    '[Seta Telecom] Proposta Comercial {{deal.title}} — {{company.name}}'
  );
  const [tplBody, setTplBody] = useState(
    'Olá {{contact.firstName}},\n\nSegue o link oficial da Proposta Comercial em PDF A4 da Seta Telecom para {{company.name}} (isenta de ISS conforme Súmula Vinculante 31 STF):\n{{proposta.link_pdf}}\n\nAtenciosamente,\n{{sender.name}}'
  );
  const [savingTpl, setSavingTpl] = useState(false);

  // User Edit Modal State
  const [editingUser, setEditingUser] = useState<StiHubUserRecord | null>(null);

  // Unified Admin Settings States (Company Emitter, Certificate A1, General Params, Checklist, Daily Sync)
  const [companyEmitter, setCompanyEmitter] = useState<StiHubCompanyEmitterSettings>(
    DEFAULT_COMPANY_EMITTER_SETTINGS
  );
  const [certificateSettings, setCertificateSettings] = useState<StiHubCertificateAndSeriesSettings>(
    DEFAULT_CERTIFICATE_SERIES_SETTINGS
  );
  const [generalParameters, setGeneralParameters] = useState<StiHubGeneralSystemParameters>(
    DEFAULT_GENERAL_PARAMETERS
  );
  const [migrationChecklist, setMigrationChecklist] = useState<MigrationChecklistModuleItem[]>(
    INITIAL_MIGRATION_CHECKLIST_11_MODULES
  );
  const [syncLogs, setSyncLogs] = useState<ErpSyncRunLog[]>(INITIAL_SYNC_LOGS);
  const [runningSyncNow, setRunningSyncNow] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [lookingUpEmitterCnpj, setLookingUpEmitterCnpj] = useState(false);

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const d = json?.data;
        if (!d) return;
        if (d.companyEmitter) setCompanyEmitter(d.companyEmitter);
        if (d.certificateSettings) setCertificateSettings(d.certificateSettings);
        if (d.generalParameters) setGeneralParameters(d.generalParameters);
        if (Array.isArray(d.migrationChecklist) && d.migrationChecklist.length > 0) {
          setMigrationChecklist(d.migrationChecklist);
        }
        if (Array.isArray(d.syncLogs) && d.syncLogs.length > 0) {
          setSyncLogs(d.syncLogs);
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveAdminSettings = async (patch: Record<string, unknown>, successMsg: string) => {
    setSavingSettings(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.data?.companyEmitter) setCompanyEmitter(json.data.companyEmitter);
        if (json?.data?.certificateSettings) setCertificateSettings(json.data.certificateSettings);
        if (json?.data?.generalParameters) setGeneralParameters(json.data.generalParameters);
        onShowToast(successMsg);
        await onRefresh();
      }
    } finally {
      setSavingSettings(false);
    }
  };

  const handleLookupEmitterCnpj = async () => {
    setLookingUpEmitterCnpj(true);
    try {
      const res = await fetch(`/api/cnpj/lookup?cnpj=${encodeURIComponent(companyEmitter.cnpj)}`);
      if (res.ok) {
        const json = await res.json();
        const d = json?.data;
        if (d) {
          setCompanyEmitter((prev) => ({
            ...prev,
            legalName: d.razaoSocial || prev.legalName,
            tradeName: d.nomeFantasia || prev.tradeName,
            stateRegistration: d.inscricaoEstadual || prev.stateRegistration,
            municipalRegistration: d.inscricaoMunicipal || prev.municipalRegistration,
            cnaeMain: d.cnaePrincipal ? `${d.cnaePrincipal} — ${d.cnaeDescricao}` : prev.cnaeMain,
            cep: d.cep || prev.cep,
            addressStreet: d.logradouro || prev.addressStreet,
            addressNumber: d.numero || prev.addressNumber,
            addressComplement: d.complemento || prev.addressComplement,
            neighborhood: d.bairro || prev.neighborhood,
            city: d.cidade || prev.city,
            state: d.uf || prev.state,
            ibgeCode: d.codigoIbge || prev.ibgeCode,
            phone: d.telefone || prev.phone,
            financialEmail: d.emailFinanceiroNfe || prev.financialEmail,
          }));
          onShowToast(`CNPJ ${d.cnpj} validado na Receita Federal (${d.razaoSocial})!`);
        }
      }
    } finally {
      setLookingUpEmitterCnpj(false);
    }
  };

  const handleRunDailySyncNow = async () => {
    setRunningSyncNow(true);
    try {
      const res = await fetch('/api/erp/daily-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'DAILY_INCREMENTAL_SYNC', incrementalCount: 9 }),
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.data?.logs)) {
          setSyncLogs(json.data.logs);
        }
        onShowToast(
          `Sincronização diária incremental executada (${json?.data?.latestRun?.runId || 'OK'})!`
        );
        await onRefresh();
      }
    } finally {
      setRunningSyncNow(false);
    }
  };

  const handleUpdateChecklistItem = async (
    moduleNumber: number,
    validationStatus: 'PASSOU' | 'FALHOU' | 'EM_CONFERENCIA',
    auditorNotes?: string
  ) => {
    const res = await fetch('/api/admin/migration-checklist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moduleNumber, validationStatus, auditorNotes }),
    });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json?.data)) {
        setMigrationChecklist(json.data);
      }
      onShowToast(`Módulo #${moduleNumber} marcado como ${validationStatus} no Checklist de Homologação!`);
    }
  };

  useEffect(() => {
    setSubView(initialSubView);
  }, [initialSubView]);

  const roles = rbacState?.roles || [];
  const users = rbacState?.users || [];
  const securityConfig = rbacState?.securityConfig;

  const selectedRole: StiHubRoleDefinition | undefined =
    roles.find((r) => r.id === selectedRoleId) || roles[0];

  const filteredUsers = users.filter((u) => {
    if (userFilter === 'ACTIVE' && !u.active) return false;
    if (userFilter === 'INACTIVE' && u.active) return false;
    if (searchUser.trim()) {
      const q = searchUser.toLowerCase();
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q) ||
        u.roleId.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleChangeRolePermission = async (
    moduleKey: string,
    nextLevel: StiHubModuleAccessLevel
  ) => {
    if (!selectedRole) return;
    setSavingRole(true);
    try {
      const updatedMap = {
        ...selectedRole.modulePermissions,
        [moduleKey]: nextLevel,
      };
      const res = await fetch(`/api/admin/roles/${encodeURIComponent(selectedRole.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modulePermissions: updatedMap }),
      });
      if (res.ok) {
        onShowToast(`Permissão do módulo ${moduleKey} atualizada no perfil ${selectedRole.name}!`);
        await onRefresh();
      }
    } finally {
      setSavingRole(false);
    }
  };

  const handleToggleRoleActionGuard = async (guardKey: keyof StiHubActionGuards) => {
    if (!selectedRole) return;
    setSavingRole(true);
    try {
      const updatedGuards = {
        ...selectedRole.actionGuards,
        [guardKey]: !selectedRole.actionGuards[guardKey],
      };
      const res = await fetch(`/api/admin/roles/${encodeURIComponent(selectedRole.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionGuards: updatedGuards }),
      });
      if (res.ok) {
        onShowToast(`Trava de segurança "${guardKey}" atualizada para ${selectedRole.name}!`);
        await onRefresh();
      }
    } finally {
      setSavingRole(false);
    }
  };

  const handleUpdateUserInline = async (
    user: StiHubUserRecord,
    patch: Partial<StiHubUserRecord>
  ) => {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      onShowToast(`Usuário ${user.name} atualizado na matriz RBAC!`);
      await onRefresh();
    }
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newUserName.trim(),
        email: newUserEmail.trim(),
        phone: newUserPhone.trim(),
        department: newUserDept.trim(),
        jobTitle: newUserTitle.trim(),
        roleId: newUserRole,
        scope: newUserScope,
        active: true,
        mfaEnabled: true,
      }),
    });
    if (res.ok) {
      setShowNewUserModal(false);
      setNewUserName('');
      setNewUserEmail('');
      onShowToast(`Colaborador ${newUserName} adicionado ao RBAC da Seta Telecom!`);
      await onRefresh();
    }
  };

  const handleSendTestEmail = async () => {
    if (!testRecipient.trim()) return;
    setSendingTestEmail(true);
    try {
      const res = await fetch('/api/communications/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType: 'PROPOSAL',
          to: testRecipient.trim(),
          cc: 'comercial@setatelecom.com.br',
          subject: '[STI-hub Mailer • Teste Validado] Proposta Comercial #4695 & Link PDF A4',
          body: `Olá,\n\nEste é um disparo de validação oficial do STI-hub Mailer (Seta Telecom LTDA • CNPJ 14.806.925/0001-32).\n\n• Link Público PDF A4: https://sti-hub.vercel.app/proposta/prop-seta-001\n• Enquadramento Fiscal: 0% ISS (LC 116/03 + Súmula Vinculante 31 STF).\n\nAtenciosamente,\nMarcelo Lopes Mira • STI-hub`,
          companyName: 'Seta Telecom Homologação',
          documentCode: '4695',
          amountBrl: 14800,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const proto = json.data?.protocol || 'STI-MAIL-OK';
        setLastTestProtocol(proto);
        onShowToast(`E-mail de teste disparado para ${testRecipient} (Protocolo ${proto})!`);
        await onRefresh();
      }
    } finally {
      setSendingTestEmail(false);
    }
  };

  const handleCreateEmailTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tplName.trim() || !tplSubject.trim() || !tplBody.trim()) return;
    setSavingTpl(true);
    try {
      const res = await fetch('/api/email-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tplName.trim(),
          category: tplCategory,
          subject: tplSubject.trim(),
          body: tplBody,
          createdBy: activeUser?.name || 'Marcelo Lopes Mira',
        }),
      });
      if (res.ok) {
        setTplName('');
        onShowToast(`Modelo dinâmico "${tplName}" salvo na biblioteca STI-hub!`);
        await onRefresh();
      }
    } finally {
      setSavingTpl(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Banner */}
      <div className="bg-[#0d2b4e] text-white rounded-xl p-5 shadow-sm border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 rounded bg-[#ff7a59] text-white text-[10px] font-black uppercase tracking-wider">
              GOVERNANÇA CORPORATIVA STI-HUB • SEÇÕES 4 &amp; 5 DO ROADMAP
            </span>
            <span className="px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-bold">
              9 Perfis RBAC • {users.length} Usuários ({users.filter((u) => u.active).length} Ativos) • MFA 2FA Ativo
            </span>
          </div>
          <h2 className="text-base sm:text-lg font-extrabold">
            Central Unificada de Administração &amp; Configurações (CRM + SETA ERP)
          </h2>
          <p className="text-xs text-slate-300">
            Controle granular de acesso por perfil e colaborador (GestãoClick Loja #118887 + HubSpot Portal #4369067), escopo de visibilidade (Todos / Equipe / Próprios), disparo validado de e-mails e subdomínios oficiais.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <a
            href="/login"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white text-[#0d2b4e] hover:bg-slate-100 text-xs font-extrabold shadow-xs"
          >
            <Lock className="w-3.5 h-3.5 text-[#ff7a59]" /> Abrir Tela de Login + MFA (/login)
          </a>
          <button
            type="button"
            onClick={() => setShowNewUserModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> + Novo Usuário Seta Telecom
          </button>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-2xs">
        {[
          {
            id: 'USERS_RBAC' as const,
            label: `Usuários (${users.length}) & Matriz RBAC (9 Perfis)`,
            icon: Users,
          },
          {
            id: 'COMPANY_EMITTER' as const,
            label: 'Dados da Empresa & Fiscal',
            icon: ShieldCheck,
          },
          {
            id: 'CERTIFICATE_SERIES' as const,
            label: 'Certificado A1, Séries NF & Parâmetros',
            icon: KeyRound,
          },
          {
            id: 'EMAIL_TEMPLATES' as const,
            label: `E-mail Validado & Modelos (${emailTemplates.length})`,
            icon: Mail,
          },
          {
            id: 'CUSTOM_PROPERTIES' as const,
            label: 'Campos Customizáveis (#4369067)',
            icon: Database,
          },
          {
            id: 'MIGRATION_CHECKLIST' as const,
            label: 'Homologação da Migração (11 Módulos)',
            icon: CheckCircle2,
          },
          {
            id: 'DAILY_SYNC_LOGS' as const,
            label: `Sincronização Diária ERP & Logs (${syncLogs.length})`,
            icon: RefreshCw,
          },
          {
            id: 'SUBDOMAIN_SECURITY' as const,
            label: 'Segurança MFA 2FA, Rotas & Subdomínio',
            icon: Globe,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = subView === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubView(tab.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                active
                  ? 'bg-[#0d2b4e] text-white shadow-xs'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ====================================================================
          SUB-VIEW 1: USERS & GRANULAR RBAC MATRIX (9 ROLES + 22 USERS)
      ==================================================================== */}
      {subView === 'USERS_RBAC' && (
        <div className="space-y-5">
          {/* 9 Roles Interactive Matrix */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                  MATRIZ DE PERMISSÕES POR PERFIL (ERP GESTÃOCLICK + CRM HUBSPOT)
                </span>
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
                  Selecione um dos 9 Perfis RBAC para inspecionar ou customizar permissões em tempo real
                </h3>
              </div>
              {savingRole && (
                <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Salvando matriz...
                </span>
              )}
            </div>

            {/* Role Selector Pills */}
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {roles.map((r) => {
                const isSel = selectedRole?.id === r.id;
                const countUsers = users.filter((u) => u.roleId === r.id).length;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedRoleId(r.id)}
                    className={`text-left p-3 rounded-xl border transition cursor-pointer ${
                      isSel
                        ? 'bg-[#0d2b4e] text-white border-[#0d2b4e] shadow-sm'
                        : 'bg-slate-50 hover:bg-blue-50/50 text-slate-800 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-black uppercase tracking-wider opacity-80">
                        {r.id}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold ${
                          isSel ? 'bg-[#ff7a59] text-white' : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {countUsers} usu. • {r.defaultScope}
                      </span>
                    </div>
                    <div className="text-xs font-extrabold mt-1 line-clamp-1">{r.name}</div>
                  </button>
                );
              })}
            </div>

            {selectedRole && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2">
                {/* Left: Module Access Table */}
                <div className="lg:col-span-7 border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-900 text-white px-4 py-2.5 flex items-center justify-between text-xs">
                    <span className="font-extrabold">
                      Permissões por Módulo — {selectedRole.name}
                    </span>
                    <span className="text-[10px] text-emerald-300 font-bold">
                      Escopo Padrão: {selectedRole.defaultScope}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-200 max-h-96 overflow-y-auto text-xs">
                    {STI_HUB_MODULES_LIST.map((mod) => {
                      const currentLevel = selectedRole.modulePermissions[mod.key] || 'NONE';
                      return (
                        <div
                          key={mod.key}
                          className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 hover:bg-slate-50"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                                mod.group === 'CRM'
                                  ? 'bg-orange-100 text-orange-800'
                                  : 'bg-blue-100 text-blue-900'
                              }`}
                            >
                              {mod.group}
                            </span>
                            <span className="font-bold text-slate-800">{mod.label}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {(['FULL', 'EDIT', 'VIEW', 'NONE'] as StiHubModuleAccessLevel[]).map(
                              (lvl) => {
                                const active = currentLevel === lvl;
                                const tone =
                                  lvl === 'FULL'
                                    ? 'bg-emerald-600 text-white'
                                    : lvl === 'EDIT'
                                      ? 'bg-blue-600 text-white'
                                      : lvl === 'VIEW'
                                        ? 'bg-amber-500 text-white'
                                        : 'bg-rose-600 text-white';
                                return (
                                  <button
                                    key={lvl}
                                    type="button"
                                    onClick={() => handleChangeRolePermission(mod.key, lvl)}
                                    className={`px-2 py-0.5 rounded text-[10px] font-extrabold cursor-pointer transition ${
                                      active
                                        ? tone
                                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                    }`}
                                  >
                                    {lvl === 'FULL'
                                      ? 'Total'
                                      : lvl === 'EDIT'
                                        ? 'Editar'
                                        : lvl === 'VIEW'
                                          ? 'Ver'
                                          : 'Bloq.'}
                                  </button>
                                );
                              }
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right: Action Guards Checklist */}
                <div className="lg:col-span-5 border border-slate-200 rounded-xl overflow-hidden flex flex-col justify-between">
                  <div>
                    <div className="bg-[#1e3a6e] text-white px-4 py-2.5 text-xs font-extrabold">
                      Travas Granulares de Ação Crítica (Action Guards)
                    </div>
                    <div className="p-3.5 space-y-2.5 text-xs">
                      <p className="text-[11px] text-slate-500">{selectedRole.description}</p>
                      {ACTION_GUARD_LABELS.map((g) => {
                        const enabled = Boolean(selectedRole.actionGuards[g.key]);
                        return (
                          <div
                            key={g.key}
                            onClick={() => handleToggleRoleActionGuard(g.key)}
                            className={`p-2.5 rounded-lg border flex items-center justify-between gap-3 cursor-pointer transition ${
                              enabled
                                ? 'bg-emerald-50/70 border-emerald-200'
                                : 'bg-slate-50 border-slate-200 opacity-75'
                            }`}
                          >
                            <div>
                              <div className="font-extrabold text-slate-900">{g.label}</div>
                              <div className="text-[10px] text-slate-500">{g.desc}</div>
                            </div>
                            <span
                              className={`px-2.5 py-1 rounded text-[10px] font-black shrink-0 ${
                                enabled
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-300 text-slate-700'
                              }`}
                            >
                              {enabled ? 'PERMITIDO' : 'BLOQUEADO'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 22 Seta Telecom Users Table */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                  QUADRO DE COLABORADORES SINCRONIZADO • GESTÃOCLICK #118887 + HUBSPOT #4369067
                </span>
                <h3 className="text-base font-extrabold text-slate-900">
                  Usuários Cadastrados ({filteredUsers.length} de {users.length})
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={searchUser}
                  onChange={(e) => setSearchUser(e.target.value)}
                  placeholder="Buscar por nome, e-mail, setor ou perfil..."
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs w-64"
                />
                {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setUserFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                      userFilter === f
                        ? 'bg-[#0d2b4e] text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {f === 'ALL'
                      ? `Todos (${users.length})`
                      : f === 'ACTIVE'
                        ? `Ativos (${users.filter((u) => u.active).length})`
                        : `Inativos/Histórico (${users.filter((u) => !u.active).length})`}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-white uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Colaborador / E-mail</th>
                    <th className="py-2.5 px-3">Departamento / Cargo</th>
                    <th className="py-2.5 px-3">Perfil RBAC (ERP + CRM)</th>
                    <th className="py-2.5 px-3">Escopo de Visão</th>
                    <th className="py-2.5 px-3">MFA 2FA</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Ações / Simular</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredUsers.map((u) => {
                    const isCurrentActive = activeUser?.id === u.id;
                    return (
                      <tr
                        key={u.id}
                        className={`hover:bg-slate-50 ${
                          isCurrentActive ? 'bg-blue-50/60' : !u.active ? 'opacity-60 bg-slate-50/40' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3">
                          <div className="font-extrabold text-slate-900 flex items-center gap-1.5">
                            <span>{u.name}</span>
                            {isCurrentActive && (
                              <span className="px-1.5 py-0.5 rounded bg-[#ff7a59] text-white text-[9px] font-black">
                                SESSÃO ATUAL
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">{u.email}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-800">{u.jobTitle}</div>
                          <div className="text-[10px] text-slate-500">
                            {u.department} • GC #{u.gestaoClickId || '—'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <select
                            aria-label={`Perfil RBAC de ${u.name}`}
                            value={u.roleId}
                            onChange={(e) =>
                              handleUpdateUserInline(u, { roleId: e.target.value as StiHubRoleId })
                            }
                            className="px-2 py-1 rounded border border-slate-300 bg-white font-bold text-[#0d2b4e] text-xs"
                          >
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.id} — {r.name.slice(0, 28)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-3">
                          <select
                            aria-label={`Escopo de ${u.name}`}
                            value={u.scope}
                            onChange={(e) =>
                              handleUpdateUserInline(u, {
                                scope: e.target.value as StiHubVisibilityScope,
                              })
                            }
                            className="px-2 py-1 rounded border border-slate-300 bg-white font-bold text-xs"
                          >
                            <option value="TODOS">TODOS (Empresa)</option>
                            <option value="EQUIPE">EQUIPE (Setor/Fila)</option>
                            <option value="PROPRIOS">PRÓPRIOS (Carteira)</option>
                          </select>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                            {u.mfaEnabled ? `2FA (${u.mfaMethod === 'TOTP_AUTHENTICATOR' ? 'TOTP' : 'E-mail'})` : 'Desativado'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={() => handleUpdateUserInline(u, { active: !u.active })}
                            className={`px-2 py-0.5 rounded text-[10px] font-extrabold cursor-pointer ${
                              u.active
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-300 text-slate-700'
                            }`}
                          >
                            {u.active ? 'ATIVO' : 'INATIVO'}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingUser(u)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-[11px] font-bold cursor-pointer"
                            >
                              <Edit3 className="w-3 h-3 text-[#ff7a59]" /> Editar
                            </button>
                            {u.active && onSelectActiveUser && (
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectActiveUser(u);
                                  onShowToast(
                                    `Sessão RBAC alternada para ${u.name} (${u.roleId} • Escopo: ${u.scope})!`
                                  );
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#1e3a6e] hover:bg-[#0d2b4e] text-white text-[11px] font-bold cursor-pointer"
                              >
                                <UserCheck className="w-3 h-3" /> Assumir Perfil
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          SUB-VIEW 2: VALIDATED EMAIL DISPATCHER & DYNAMIC TEMPLATES LIBRARY
      ==================================================================== */}
      {subView === 'EMAIL_TEMPLATES' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Mailer Config & Validated Test Dispatch */}
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-700 block">
                STI-HUB MAILER • INFRAESTRUTURA DE ENVIO VALIDADO
              </span>
              <h3 className="text-base font-extrabold text-slate-900">
                Configuração SMTP / Resend Relay &amp; Disparo de Teste
              </h3>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Provedor Ativo:</span>
                <strong className="text-slate-900">
                  {securityConfig?.smtpProvider || 'RESEND_HTTP_API'} + Audit Log
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Servidor SMTP Corporativo:</span>
                <code className="font-mono font-bold text-[#0d2b4e]">
                  {securityConfig?.smtpHost || 'smtp.setatelecom.com.br'}:
                  {securityConfig?.smtpPort || 587}
                </code>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Remetente Oficial:</span>
                <strong className="text-slate-900">
                  {securityConfig?.fromEmail || 'comercial@setatelecom.com.br'}
                </strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Autenticação DKIM / SPF / DMARC:</span>
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
                  VERIFICADO (setatelecom.com.br)
                </span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200 space-y-3 text-xs">
              <div className="font-extrabold text-[#0d2b4e]">
                Testar Disparo de E-mail Transacional Agora
              </div>
              <p className="text-[11px] text-slate-600">
                Envia um e-mail de validação com o link público de Proposta PDF A4 (`https://sti-hub.vercel.app/proposta/prop-seta-001`) e registra protocolo na Timeline.
              </p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={testRecipient}
                  onChange={(e) => setTestRecipient(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold"
                />
                <button
                  type="button"
                  onClick={handleSendTestEmail}
                  disabled={sendingTestEmail}
                  className="px-4 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer shrink-0"
                >
                  {sendingTestEmail ? 'Enviando...' : 'Disparar Teste'}
                </button>
              </div>
              {lastTestProtocol && (
                <div className="p-2.5 rounded bg-emerald-100 text-emerald-900 font-mono text-[11px] font-bold">
                  ✓ E-mail validado com sucesso! Protocolo: {lastTestProtocol}
                </div>
              )}
            </div>

            <form onSubmit={handleCreateEmailTemplate} className="space-y-3 pt-2 border-t border-slate-200 text-xs">
              <div className="font-extrabold text-slate-900">
                + Criar Novo Modelo Dinâmico de E-mail
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  placeholder="Nome do Modelo (ex: Cobrança Locação)"
                  className="px-3 py-2 rounded-lg border border-slate-300"
                />
                <select
                  value={tplCategory}
                  onChange={(e) => setTplCategory(e.target.value as CrmEmailTemplateCategory)}
                  className="px-3 py-2 rounded-lg border border-slate-300 bg-white font-bold"
                >
                  <option value="PROPOSTA">PROPOSTA COMERCIAL</option>
                  <option value="FOLLOW_UP">FOLLOW-UP</option>
                  <option value="PROSPECCAO">PROSPECÇÃO ABM</option>
                  <option value="DIAGNOSTICO">DIAGNÓSTICO TÉCNICO</option>
                  <option value="RENOVACAO">RENOVAÇÃO CONTRATUAL</option>
                </select>
              </div>
              <input
                type="text"
                required
                value={tplSubject}
                onChange={(e) => setTplSubject(e.target.value)}
                placeholder="Assunto com variáveis {{company.name}}"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-semibold"
              />
              <textarea
                rows={4}
                required
                value={tplBody}
                onChange={(e) => setTplBody(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-[11px]"
              />
              <button
                type="submit"
                disabled={savingTpl}
                className="w-full py-2.5 rounded-lg bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white font-extrabold cursor-pointer"
              >
                {savingTpl ? 'Salvando...' : 'Salvar Modelo na Biblioteca'}
              </button>
            </form>
          </div>

          {/* Right: Dynamic Email Templates Library */}
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                  CONFIGURAÇÕES &gt; MODELOS DE E-MAILS (CFG_EMAILS)
                </span>
                <h3 className="text-base font-extrabold text-slate-900">
                  Biblioteca de Modelos Dinâmicos CRM &amp; ERP ({emailTemplates.length})
                </h3>
              </div>
              <span className="text-[11px] text-slate-500">
                Variáveis: <code>{'{{contact.firstName}}'}</code>, <code>{'{{company.name}}'}</code>,{' '}
                <code>{'{{proposta.link_pdf}}'}</code>
              </span>
            </div>

            <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
              {emailTemplates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-[#0d2b4e] text-white text-[10px] font-extrabold">
                        {tpl.category}
                      </span>
                      <strong className="text-sm text-slate-900">{tpl.name}</strong>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      Usos: <strong>{tpl.usageCount}</strong> • Autor: {tpl.createdBy}
                    </span>
                  </div>
                  <div className="font-bold text-[#1e3a6e]">Assunto: {tpl.subject}</div>
                  <pre className="p-3 rounded-lg bg-white border border-slate-200 text-[11px] text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                    {tpl.body}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          SUB-VIEW 3: HUBSPOT PORTAL 4369067 CUSTOM PROPERTIES
      ==================================================================== */}
      {subView === 'CUSTOM_PROPERTIES' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-[#ff7a59] block">
                SEÇÃO 3 DO ROADMAP • CUSTOM PROPERTIES HUBSPOT PORTAL #4369067
              </span>
              <h3 className="text-base font-extrabold text-slate-900">
                Dicionário de Propriedades Customizadas Sincronizadas (Contatos, Empresas, Deals &amp; Tickets)
              </h3>
            </div>
            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-extrabold">
              100% Sincronizado com HubSpot v3 + GestãoClick #118887
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {(securityConfig?.customProperties || []).map((prop) => (
              <div
                key={prop.id}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2 py-0.5 rounded bg-[#0d2b4e] text-white text-[10px] font-black">
                    {prop.objectType}
                  </span>
                  <code className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-mono text-[11px] font-bold">
                    {prop.internalName}
                  </code>
                </div>
                <div className="text-sm font-extrabold text-slate-900">{prop.label}</div>
                <p className="text-slate-600 text-[11px]">{prop.description}</p>
                {prop.options && prop.options.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {prop.options.map((opt) => (
                      <span
                        key={opt}
                        className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-semibold text-slate-700"
                      >
                        {opt}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ====================================================================
          SUB-VIEW 4: CORPORATE SECURITY MFA, ROUTE PROTECTION & SUBDOMAIN
      ==================================================================== */}
      {subView === 'SUBDOMAIN_SECURITY' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 text-xs">
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                SEÇÃO 5.4 DO ROADMAP • DOMÍNIO &amp; SUBDOMÍNIOS CORPORATIVOS SETA TELECOM
              </span>
              <h3 className="text-base font-extrabold text-slate-900">
                Subdomínios Oficiais Configurados &amp; Apontamento DNS CNAME
              </h3>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-white uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Subdomínio / Host</th>
                    <th className="py-2.5 px-3">Tipo</th>
                    <th className="py-2.5 px-3">Destino DNS (CNAME)</th>
                    <th className="py-2.5 px-3">Certificado SSL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(securityConfig?.subdomains || []).map((sd) => (
                    <tr key={sd.domain} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono font-black text-[#0d2b4e]">
                        https://{sd.domain}
                        {sd.isDefaultPublicProposalDomain && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-sans text-[9px] font-bold">
                            PADRÃO PDF
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-semibold">{sd.type}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{sd.cnameTarget}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-extrabold">
                          {sd.sslStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="font-extrabold text-slate-900">
                Instrução DNS para Zona <code className="font-mono">setatelecom.com.br</code>:
              </div>
              <p className="text-slate-600">
                • Tipo: <strong>CNAME</strong> | Nome: <code>stihub</code> (ou <code>erp</code>) | Valor:{' '}
                <code className="font-mono font-bold">cname.vercel-dns.com</code> | TTL: Automático.
              </p>
              <p className="text-slate-600">
                • Todos os links públicos de propostas comerciais (<code>/proposta/[id]</code>) utilizam automaticamente o domínio ativo da sessão ou <code>https://sti-hub.vercel.app</code>.
              </p>
            </div>
          </div>

          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-700 block">
                SEÇÕES 5.1 &amp; 5.2 DO ROADMAP • AUTH GUARD &amp; MFA 2FA
              </span>
              <h3 className="text-base font-extrabold text-slate-900">
                Política de Proteção de Rotas (`src/middleware.ts`)
              </h3>
            </div>

            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                <div className="font-extrabold text-emerald-950">
                  ✓ Etapa Obrigatória MFA 2FA (TOTP 6 Dígitos)
                </div>
                <p className="text-[11px] text-emerald-800 mt-0.5">
                  Sessão emitida em cookie <code>HttpOnly</code> (<code>stihub_session</code>, TTL{' '}
                  {securityConfig?.sessionTtlHours || 24}h) somente após validação do segundo fator.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <div className="font-extrabold text-slate-900">Rotas Públicas Liberadas (Whitelisted):</div>
                <ul className="text-[11px] text-slate-600 space-y-1 font-mono">
                  <li>• /login (Autenticação + Desafio MFA 2FA)</li>
                  <li>• /proposta/[id] (Link Público PDF A4 p/ Cliente)</li>
                  <li>• /portal &amp; /api/portal/* (Portal Externo NOC SLA)</li>
                  <li>• /api/health (Monitoramento de Infraestrutura)</li>
                </ul>
              </div>
            </div>

            <a
              href="/login"
              className="w-full py-2.5 rounded-xl bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white font-extrabold flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4 text-[#ff7a59]" /> Testar Fluxo de Login + MFA 2FA Agora
            </a>
          </div>
        </div>
      )}

      {/* ====================================================================
          SUB-VIEW: DADOS DA EMPRESA EMITENTE & FISCAL (CFG_EMPRESA)
      ==================================================================== */}
      {subView === 'COMPANY_EMITTER' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                CONFIGURAÇÕES &gt; DADOS DA EMPRESA EMITENTE (CFG_EMPRESA / LOJA MATRIZ #118887)
              </span>
              <h3 className="text-base font-extrabold text-slate-900">
                Ficha Fiscal e Bancária da Seta Telecom LTDA
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleLookupEmitterCnpj}
                disabled={lookingUpEmitterCnpj}
                className="px-3.5 py-2 rounded-lg bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white font-extrabold cursor-pointer"
              >
                {lookingUpEmitterCnpj ? 'Consultando RFB...' : 'Consultar CNPJ na Receita Federal'}
              </button>
              <button
                type="button"
                disabled={savingSettings}
                onClick={() =>
                  handleSaveAdminSettings(
                    { companyEmitter },
                    'Dados fiscais e bancários da Seta Telecom salvos com sucesso!'
                  )
                }
                className="px-4 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer"
              >
                {savingSettings ? 'Salvando...' : 'Salvar Dados da Empresa'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Razão Social Emitente</label>
              <input
                type="text"
                value={companyEmitter.legalName}
                onChange={(e) => setCompanyEmitter({ ...companyEmitter, legalName: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-semibold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Nome Fantasia / Unidade</label>
              <input
                type="text"
                value={companyEmitter.tradeName}
                onChange={(e) => setCompanyEmitter({ ...companyEmitter, tradeName: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">CNPJ Matriz</label>
              <input
                type="text"
                value={companyEmitter.cnpj}
                onChange={(e) => setCompanyEmitter({ ...companyEmitter, cnpj: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Inscrição Estadual (IE)</label>
              <input
                type="text"
                value={companyEmitter.stateRegistration}
                onChange={(e) =>
                  setCompanyEmitter({ ...companyEmitter, stateRegistration: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Inscrição Municipal (IM)</label>
              <input
                type="text"
                value={companyEmitter.municipalRegistration}
                onChange={(e) =>
                  setCompanyEmitter({ ...companyEmitter, municipalRegistration: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Regime Tributário</label>
              <select
                value={companyEmitter.taxRegime}
                onChange={(e) =>
                  setCompanyEmitter({
                    ...companyEmitter,
                    taxRegime: e.target.value as StiHubCompanyEmitterSettings['taxRegime'],
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-bold"
              >
                <option value="LUCRO_PRESUMIDO">Lucro Presumido (PIS 0,65% / COFINS 3%)</option>
                <option value="LUCRO_REAL">Lucro Real (PIS 1,65% / COFINS 7,6%)</option>
                <option value="SIMPLES_NACIONAL">Simples Nacional</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">CNAE Principal Fiscal</label>
              <input
                type="text"
                value={companyEmitter.cnaeMain}
                onChange={(e) => setCompanyEmitter({ ...companyEmitter, cnaeMain: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Código IBGE Município</label>
              <input
                type="text"
                value={companyEmitter.ibgeCode}
                onChange={(e) => setCompanyEmitter({ ...companyEmitter, ibgeCode: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">CEP</label>
              <input
                type="text"
                value={companyEmitter.cep}
                onChange={(e) => setCompanyEmitter({ ...companyEmitter, cep: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">Logradouro &amp; Número</label>
              <div className="grid grid-cols-4 gap-2">
                <input
                  type="text"
                  value={companyEmitter.addressStreet}
                  onChange={(e) =>
                    setCompanyEmitter({ ...companyEmitter, addressStreet: e.target.value })
                  }
                  className="col-span-3 px-3 py-2 rounded-lg border border-slate-300"
                />
                <input
                  type="text"
                  value={companyEmitter.addressNumber}
                  onChange={(e) =>
                    setCompanyEmitter({ ...companyEmitter, addressNumber: e.target.value })
                  }
                  className="col-span-1 px-3 py-2 rounded-lg border border-slate-300"
                />
              </div>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Cidade / UF</label>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={companyEmitter.city}
                  onChange={(e) => setCompanyEmitter({ ...companyEmitter, city: e.target.value })}
                  className="col-span-2 px-3 py-2 rounded-lg border border-slate-300"
                />
                <input
                  type="text"
                  value={companyEmitter.state}
                  onChange={(e) => setCompanyEmitter({ ...companyEmitter, state: e.target.value })}
                  className="col-span-1 px-3 py-2 rounded-lg border border-slate-300 font-bold"
                />
              </div>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Conta Principal Banco Inter</label>
              <input
                type="text"
                value={companyEmitter.defaultBankInterAccount}
                onChange={(e) =>
                  setCompanyEmitter({ ...companyEmitter, defaultBankInterAccount: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Conta Principal Banco Itaú</label>
              <input
                type="text"
                value={companyEmitter.defaultBankItauAccount}
                onChange={(e) =>
                  setCompanyEmitter({ ...companyEmitter, defaultBankItauAccount: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          SUB-VIEW: CERTIFICADO DIGITAL A1, SÉRIES NF & PARÂMETROS GERAIS
      ==================================================================== */}
      {subView === 'CERTIFICATE_SERIES' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 text-xs">
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                  CONFIGURAÇÕES &gt; CERTIFICADO DIGITAL A1 &amp; NUMERAÇÃO FISCAL (CFG_CERTIFICADO)
                </span>
                <h3 className="text-base font-extrabold text-slate-900">
                  Certificado ICP-Brasil (.pfx) e Séries NF-e / NFS-e / NFCom / Locação SV 31
                </h3>
              </div>
              <button
                type="button"
                disabled={savingSettings}
                onClick={() =>
                  handleSaveAdminSettings(
                    { certificateSettings, generalParameters },
                    'Certificado Digital A1, séries fiscais e parâmetros gerais salvos!'
                  )
                }
                className="px-4 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer"
              >
                {savingSettings ? 'Salvando...' : 'Salvar Parâmetros Fiscais'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Arquivo Certificado A1 (.pfx)</label>
                <input
                  type="text"
                  value={certificateSettings.certificateFileName}
                  onChange={(e) =>
                    setCertificateSettings({
                      ...certificateSettings,
                      certificateFileName: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Ambiente SEFAZ / Prefeitura</label>
                <select
                  value={certificateSettings.sefazEnvironment}
                  onChange={(e) =>
                    setCertificateSettings({
                      ...certificateSettings,
                      sefazEnvironment: e.target.value as 'PRODUCAO' | 'HOMOLOGACAO',
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-bold"
                >
                  <option value="PRODUCAO">PRODUÇÃO (Validade Jurídica Ativa)</option>
                  <option value="HOMOLOGACAO">HOMOLOGAÇÃO (Testes SEFAZ)</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Série &amp; Próxima NF-e Produto (Mod. 55)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={certificateSettings.nfeProductSeries}
                    onChange={(e) =>
                      setCertificateSettings({
                        ...certificateSettings,
                        nfeProductSeries: e.target.value,
                      })
                    }
                    className="px-3 py-2 rounded-lg border border-slate-300 font-mono"
                  />
                  <input
                    type="number"
                    value={certificateSettings.nfeProductNextNumber}
                    onChange={(e) =>
                      setCertificateSettings({
                        ...certificateSettings,
                        nfeProductNextNumber: Number(e.target.value) || 1,
                      })
                    }
                    className="px-3 py-2 rounded-lg border border-slate-300 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Série &amp; Próxima NFS-e Serviço (LC 116)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={certificateSettings.nfseServiceSeries}
                    onChange={(e) =>
                      setCertificateSettings({
                        ...certificateSettings,
                        nfseServiceSeries: e.target.value,
                      })
                    }
                    className="px-3 py-2 rounded-lg border border-slate-300 font-mono"
                  />
                  <input
                    type="number"
                    value={certificateSettings.nfseServiceNextNumber}
                    onChange={(e) =>
                      setCertificateSettings({
                        ...certificateSettings,
                        nfseServiceNextNumber: Number(e.target.value) || 1,
                      })
                    }
                    className="px-3 py-2 rounded-lg border border-slate-300 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Série &amp; Próxima NFCom Telecom (Mod. 62)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={certificateSettings.nfcomTelecomSeries}
                    onChange={(e) =>
                      setCertificateSettings({
                        ...certificateSettings,
                        nfcomTelecomSeries: e.target.value,
                      })
                    }
                    className="px-3 py-2 rounded-lg border border-slate-300 font-mono"
                  />
                  <input
                    type="number"
                    value={certificateSettings.nfcomTelecomNextNumber}
                    onChange={(e) =>
                      setCertificateSettings({
                        ...certificateSettings,
                        nfcomTelecomNextNumber: Number(e.target.value) || 1,
                      })
                    }
                    className="px-3 py-2 rounded-lg border border-slate-300 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Prefixo &amp; Próxima Fatura Locação (0% ISS SV 31)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={certificateSettings.rentalInvoicePrefix}
                    onChange={(e) =>
                      setCertificateSettings({
                        ...certificateSettings,
                        rentalInvoicePrefix: e.target.value,
                      })
                    }
                    className="px-3 py-2 rounded-lg border border-slate-300 font-mono"
                  />
                  <input
                    type="number"
                    value={certificateSettings.rentalInvoiceNextNumber}
                    onChange={(e) =>
                      setCertificateSettings({
                        ...certificateSettings,
                        rentalInvoiceNextNumber: Number(e.target.value) || 1,
                      })
                    }
                    className="px-3 py-2 rounded-lg border border-slate-300 font-mono"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="border-b border-slate-200 pb-3">
              <span className="text-[10px] font-extrabold uppercase text-emerald-700 block">
                CONFIGURAÇÕES GERAIS DO SISTEMA (CFG_GERAIS)
              </span>
              <h3 className="text-base font-extrabold text-slate-900">
                Regras Comerciais, Financeiras e Travas Globais
              </h3>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Alçada Desconto Padrão (%)</label>
                  <input
                    type="number"
                    value={generalParameters.defaultSalesDiscountLimitPercent}
                    onChange={(e) =>
                      setGeneralParameters({
                        ...generalParameters,
                        defaultSalesDiscountLimitPercent: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Índice Reajuste Contratos</label>
                  <select
                    value={generalParameters.defaultContractReadjustmentIndex}
                    onChange={(e) =>
                      setGeneralParameters({
                        ...generalParameters,
                        defaultContractReadjustmentIndex: e.target
                          .value as StiHubGeneralSystemParameters['defaultContractReadjustmentIndex'],
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-bold"
                  >
                    <option value="IPCA">IPCA (IBGE)</option>
                    <option value="IGP-M">IGP-M (FGV)</option>
                    <option value="IST_ANATEL">IST Anatel</option>
                    <option value="FIXO">Fixo</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Multa Atraso Boleto (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={generalParameters.boletoLateFeePercent}
                    onChange={(e) =>
                      setGeneralParameters({
                        ...generalParameters,
                        boletoLateFeePercent: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Juros Mensal Boleto (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={generalParameters.boletoMonthlyInterestPercent}
                    onChange={(e) =>
                      setGeneralParameters({
                        ...generalParameters,
                        boletoMonthlyInterestPercent: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 space-y-1">
                <div className="font-extrabold text-emerald-950">
                  Trava Fiscal de CNPJ (Anti-Merge Matriz/Filial): ATIVA
                </div>
                <p className="text-[11px] text-emerald-800">
                  Bloqueia automaticamente qualquer tentativa de unificar empresas com CNPJs diferentes no CRM e no ERP.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          SUB-VIEW: CHECKLIST INTERATIVO DE HOMOLOGAÇÃO DOS 11 MÓDULOS (CFG_CHECKLIST)
      ==================================================================== */}
      {subView === 'MIGRATION_CHECKLIST' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-[#ff7a59] block">
                HOMOLOGAÇÃO OFICIAL DA MIGRAÇÃO GESTÃOCLICK (#118887) &rarr; STI-HUB
              </span>
              <h3 className="text-base font-extrabold text-slate-900">
                Checklist Verificável dos 11 Módulos Importados (6.414 Registros Reais)
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-extrabold">
                Aprovados: {migrationChecklist.filter((m) => m.validationStatus === 'PASSOU').length} /{' '}
                {migrationChecklist.length} Módulos
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {migrationChecklist.map((item) => (
              <div
                key={item.moduleKey}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded bg-[#0d2b4e] text-white font-extrabold">
                        {item.moduleName}
                      </span>
                      <span className="px-2.5 py-0.5 rounded bg-blue-100 text-[#1e3a6e] font-black">
                        {item.totalCount.toLocaleString('pt-BR')} registros
                      </span>
                      <span className="text-[11px] text-slate-500 font-semibold">
                        Destino: {item.targetDestination}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(['PASSOU', 'EM_CONFERENCIA', 'FALHOU'] as const).map((st) => {
                      const active = item.validationStatus === st;
                      const cls =
                        st === 'PASSOU'
                          ? active
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white text-emerald-700 border border-emerald-300'
                          : st === 'FALHOU'
                            ? active
                              ? 'bg-rose-600 text-white'
                              : 'bg-white text-rose-700 border border-rose-300'
                            : active
                              ? 'bg-amber-500 text-white'
                              : 'bg-white text-amber-800 border border-amber-300';
                      return (
                        <button
                          key={st}
                          type="button"
                          onClick={() => handleUpdateChecklistItem(item.moduleNumber, st, item.auditorNotes)}
                          className={`px-2.5 py-1 rounded font-extrabold text-[11px] cursor-pointer transition ${cls}`}
                        >
                          {st === 'PASSOU' ? '[x] PASSOU' : st === 'FALHOU' ? '[ ] FALHOU' : 'EM CONFERÊNCIA'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                    <strong className="text-slate-800 block mb-1">Amostragem Real para Conferência:</strong>
                    <ul className="list-disc list-inside text-slate-600 space-y-0.5">
                      {item.sampleRecords.map((sr, i) => (
                        <li key={i}>{sr}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 space-y-1">
                    <div>
                      <strong className="text-slate-800">Campos Verificados:</strong>{' '}
                      <span className="text-slate-600">{item.requiredFieldsVerified.join(' • ')}</span>
                    </div>
                    <div>
                      <strong className="text-slate-800">Trava Fiscal / CNPJ:</strong>{' '}
                      <span className="text-emerald-700 font-semibold">{item.cnpjFiscalLockCheck}</span>
                    </div>
                    <div>
                      <strong className="text-slate-800">Vínculos entre Cadastros:</strong>{' '}
                      <span className="text-slate-600">{item.relationalIntegrityCheck}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-700 shrink-0">Observações da Conferência:</span>
                  <input
                    type="text"
                    value={item.auditorNotes}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMigrationChecklist((prev) =>
                        prev.map((m) =>
                          m.moduleNumber === item.moduleNumber ? { ...m, auditorNotes: val } : m
                        )
                      );
                    }}
                    onBlur={(e) =>
                      handleUpdateChecklistItem(
                        item.moduleNumber,
                        item.validationStatus,
                        e.target.value
                      )
                    }
                    className="flex-1 px-2.5 py-1 rounded border border-slate-300 bg-white text-[11px]"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ====================================================================
          SUB-VIEW: SINCRONIZAÇÃO DIÁRIA INCREMENTAL ERP & LOGS (CFG_LOGS)
      ==================================================================== */}
      {subView === 'DAILY_SYNC_LOGS' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-700 block">
                SINCRONIZAÇÃO AUTOMÁTICA DIÁRIA • GESTÃOCLICK (#118887) &rarr; STI-HUB (/api/erp/daily-sync)
              </span>
              <h3 className="text-base font-extrabold text-slate-900">
                Motor Incremental Diário (07h00 EDT) &amp; Histórico de Execuções
              </h3>
            </div>
            <button
              type="button"
              onClick={handleRunDailySyncNow}
              disabled={runningSyncNow}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${runningSyncNow ? 'animate-spin' : ''}`} />
              {runningSyncNow
                ? 'Executando Sincronização Incremental...'
                : 'Executar Sincronização Incremental Agora'}
            </button>
          </div>

          <div className="space-y-3">
            {syncLogs.map((log) => (
              <div
                key={log.runId}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-[#0d2b4e] text-white font-mono font-bold">
                      {log.runId}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-extrabold text-[10px]">
                      {log.mode === 'INITIAL_WIPE_AND_FULL_IMPORT'
                        ? 'LIMPEZA + CARGA TOTAL INICIAL'
                        : 'SINCRONIZAÇÃO DIÁRIA INCREMENTAL'}
                    </span>
                    <span className="text-slate-500">
                      {new Date(log.timestamp).toLocaleString('pt-BR')} ({log.durationMs}ms)
                    </span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded bg-emerald-600 text-white font-extrabold text-[10px]">
                    {log.status} • {log.incrementalNewOrUpdated} reg. sincronizados
                  </span>
                </div>
                <p className="text-slate-700 font-medium">{log.summary}</p>
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 pt-1 text-[11px]">
                  <div className="p-2 rounded bg-white border border-slate-200">
                    Clientes: <strong>{log.importedCounts.clientes}</strong>
                  </div>
                  <div className="p-2 rounded bg-white border border-slate-200">
                    Fornecedores: <strong>{log.importedCounts.fornecedores}</strong>
                  </div>
                  <div className="p-2 rounded bg-white border border-slate-200">
                    Produtos/Serv.: <strong>{log.importedCounts.produtos + log.importedCounts.servicos}</strong>
                  </div>
                  <div className="p-2 rounded bg-white border border-slate-200">
                    Orçamentos: <strong>{log.importedCounts.orcamentos}</strong>
                  </div>
                  <div className="p-2 rounded bg-white border border-slate-200">
                    Contratos: <strong>{log.importedCounts.contratos}</strong>
                  </div>
                  <div className="p-2 rounded bg-white border border-slate-200">
                    O.S. / Chamados: <strong>{log.importedCounts.ordensServico}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal: Edit Existing User */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4 text-xs">
            <h3 className="text-base font-extrabold text-slate-900">
              Editar Colaborador RBAC — {editingUser.name}
            </h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await handleUpdateUserInline(editingUser, editingUser);
                setEditingUser(null);
              }}
              className="space-y-3"
            >
              <div>
                <label className="block font-bold text-slate-700 mb-1">Nome Completo *</label>
                <input
                  type="text"
                  required
                  value={editingUser.name}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">E-mail Corporativo *</label>
                <input
                  type="email"
                  required
                  value={editingUser.email}
                  onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Departamento</label>
                  <input
                    type="text"
                    value={editingUser.department}
                    onChange={(e) => setEditingUser({ ...editingUser, department: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Cargo</label>
                  <input
                    type="text"
                    value={editingUser.jobTitle}
                    onChange={(e) => setEditingUser({ ...editingUser, jobTitle: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Perfil RBAC</label>
                  <select
                    value={editingUser.roleId}
                    onChange={(e) =>
                      setEditingUser({ ...editingUser, roleId: e.target.value as StiHubRoleId })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-bold"
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Escopo de Carteira</label>
                  <select
                    value={editingUser.scope}
                    onChange={(e) =>
                      setEditingUser({
                        ...editingUser,
                        scope: e.target.value as StiHubVisibilityScope,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-bold"
                  >
                    <option value="TODOS">TODOS</option>
                    <option value="EQUIPE">EQUIPE</option>
                    <option value="PROPRIOS">PRÓPRIOS</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingUser.mfaEnabled}
                    onChange={(e) =>
                      setEditingUser({ ...editingUser, mfaEnabled: e.target.checked })
                    }
                  />
                  <span>MFA 2FA Obrigatório Ativo</span>
                </label>
                <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingUser.active}
                    onChange={(e) => setEditingUser({ ...editingUser, active: e.target.checked })}
                  />
                  <span>Usuário Ativo</span>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#ff7a59] text-white font-extrabold cursor-pointer"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create New User */}
      {showNewUserModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4 text-xs">
            <h3 className="text-base font-extrabold text-slate-900">
              + Cadastrar Novo Usuário na Matriz RBAC (Seta Telecom)
            </h3>
            <form onSubmit={handleCreateUserSubmit} className="space-y-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Nome Completo *</label>
                <input
                  type="text"
                  required
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="Ex: Rodrigo Santana"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">E-mail Corporativo *</label>
                <input
                  type="email"
                  required
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="rodrigo@setatelecom.com.br"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Departamento</label>
                  <input
                    type="text"
                    value={newUserDept}
                    onChange={(e) => setNewUserDept(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Cargo</label>
                  <input
                    type="text"
                    value={newUserTitle}
                    onChange={(e) => setNewUserTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Perfil RBAC</label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as StiHubRoleId)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-bold"
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Escopo</label>
                  <select
                    value={newUserScope}
                    onChange={(e) => setNewUserScope(e.target.value as StiHubVisibilityScope)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-bold"
                  >
                    <option value="TODOS">TODOS</option>
                    <option value="EQUIPE">EQUIPE</option>
                    <option value="PROPRIOS">PRÓPRIOS</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowNewUserModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#ff7a59] text-white font-extrabold cursor-pointer"
                >
                  Salvar Usuário RBAC
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

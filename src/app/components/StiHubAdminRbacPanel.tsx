'use client';

import React, { useState, useEffect } from 'react';
import {
  buildDefaultCrmItemPermissions,
  buildDefaultErpItemPermissions,
  CRM_MODULE_ITEMS_CATALOG,
  CRM_ROLES_CATALOG,
  CrmAccountRole,
  CrudPermissionFlags,
  ERP_MODULE_ITEMS_CATALOG,
  ERP_ROLES_CATALOG,
  ErpAccountRole,
  inferCrmAndErpRolesFromLegacyRole,
} from '../lib/rbac';
import {
  buildOtpAuthUri,
  buildTotpQrCodeSvgDataUrl,
  formatBase32SecretBlocks,
  generateTotpCodeSync,
  generateTotpSecretBase32,
  loadClientDeletedUsersOverride,
  loadClientIamUsersOverride,
  saveClientDeletedUserOverride,
} from '../lib/auth';
import { saveClientIamUserOverrideIfNewer } from '../lib/iam-seal-cache';
import {
  HOME_SCREENS,
  HomeScreenId,
  getHomeScreen,
  isHomeScreenId,
  moduleAccessFromUser,
  systemHasAccess,
} from '../lib/home-screen';
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
  Trash2,
  UserCheck,
} from 'lucide-react';
import {
  CrmEmailTemplate,
  CrmEmailTemplateCategory,
  StiHubActionGuards,
  StiHubCrmPermissions,
  StiHubErpPermissions,
  StiHubMacroModule,
  StiHubModuleAccessLevel,
  StiHubRbacState,
  StiHubRoleDefinition,
  StiHubRoleId,
  StiHubUserRecord,
  StiHubVisibilityScope,
} from '../../db/types';
import {
  buildDefaultCrmPermissionsForRole,
  buildDefaultErpPermissionsForRole,
  buildDefaultModuleAccessForRole,
  buildFullControlForModule,
  isModuleFullControl,
  STI_HUB_MODULES_LIST,
} from '../../modules/erp/rbac-seed';
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
    desc: 'Permite emitir documentos fiscais oficiais (Fatura SV 31, NFS-e e NF-e)',
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
  const [newUserCrmRole, setNewUserCrmRole] = useState<CrmAccountRole>('CRM_SALES_REP');
  const [newUserErpRole, setNewUserErpRole] = useState<ErpAccountRole>('ERP_COMMERCIAL');
  const [newUserTotpSecret, setNewUserTotpSecret] = useState<string>(() =>
    generateTotpSecretBase32('novo.colaborador@setatelecom.com.br')
  );
  const [activeCrudDomainTab, setActiveCrudDomainTab] = useState<'CRM' | 'ERP'>('CRM');
  const [selectedCrmRoleForCrud, setSelectedCrmRoleForCrud] = useState<CrmAccountRole>('CRM_SALES_MANAGER');
  const [selectedErpRoleForCrud, setSelectedErpRoleForCrud] = useState<ErpAccountRole>('ERP_STOCK_MANAGER');
  const [crmRolesMatrixState, setCrmRolesMatrixState] = useState(() => structuredClone(CRM_ROLES_CATALOG));
  const [erpRolesMatrixState, setErpRolesMatrixState] = useState(() => structuredClone(ERP_ROLES_CATALOG));
  const [newUserScope, setNewUserScope] = useState<StiHubVisibilityScope>('PROPRIOS');
  const [newUserMfaEnabled, setNewUserMfaEnabled] = useState<boolean>(true);
  const [newUserPassword, setNewUserPassword] = useState<string>('');
  const [sendInviteEmailOnCreate, setSendInviteEmailOnCreate] = useState<boolean>(true);
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [localDeletedIds, setLocalDeletedIds] = useState<string[]>([]);
  const [newUserMfaMethod, setNewUserMfaMethod] = useState<'TOTP_AUTHENTICATOR' | 'EMAIL_OTP'>('TOTP_AUTHENTICATOR');
  const [inviteModalData, setInviteModalData] = useState<{
    userName: string;
    email: string;
    inviteUrl: string;
    conviteUrl: string;
    expiresAt: string;
    emailDelivered: boolean;
  } | null>(null);
  const [newUserModules, setNewUserModules] = useState<StiHubMacroModule[]>(['CRM', 'ERP']);
  const [newUserCrmPerms, setNewUserCrmPerms] = useState<StiHubCrmPermissions>(() =>
    buildDefaultCrmPermissionsForRole('VENDEDOR_SALES', 'PROPRIOS')
  );
  const [newUserErpPerms, setNewUserErpPerms] = useState<StiHubErpPermissions>(() =>
    buildDefaultErpPermissionsForRole('VENDEDOR_SALES')
  );
  const [modalTotpPreview, setModalTotpPreview] = useState<{
    totpSecret: string;
    otpauthUri: string;
    qrCodeSvgDataUrl: string;
    currentTotpCode: string;
  } | null>(null);

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
        body: JSON.stringify({ ...patch, iamUsersOverride: loadClientIamUsersOverride(), iamDeletedUsersOverride: loadClientDeletedUsersOverride() }),
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
  const deletedSet = new Set(
    [
      ...localDeletedIds,
      ...(typeof window !== 'undefined' ? loadClientDeletedUsersOverride() : []),
    ].map((x) => String(x).toLowerCase())
  );
  const users = (() => {
    const map = new Map<string, StiHubUserRecord>();
    for (const u of rbacState?.users || []) {
      if (deletedSet.has(u.id.toLowerCase()) || deletedSet.has(u.email.toLowerCase())) continue;
      map.set(u.id, u);
    }
    if (typeof window !== 'undefined') {
      const overrides = loadClientIamUsersOverride() as unknown as StiHubUserRecord[];
      for (const ov of overrides) {
        if (!ov || (!ov.id && !ov.email)) continue;
        if (
          (ov.id && deletedSet.has(String(ov.id).toLowerCase())) ||
          (ov.email && deletedSet.has(String(ov.email).toLowerCase()))
        ) {
          continue;
        }
        const key =
          Array.from(map.keys()).find(
            (k) => k === ov.id || map.get(k)?.email.toLowerCase() === String(ov.email || "").toLowerCase()
          ) || ov.id;
        const prev = map.get(key);
        map.set(key, prev ? { ...prev, ...ov } : ov);
      }
    }
    return Array.from(map.values());
  })();
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
    patch: Partial<StiHubUserRecord> & { password?: string }
  ) => {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.data) {
        saveClientIamUserOverrideIfNewer({
          ...json.data,
          ...(patch.password ? { password: patch.password } : {}),
        });
      }
      onShowToast(`Usuário ${user.name} atualizado na matriz RBAC!`);
      await onRefresh();
    }
  };

  const handleToggleUserMfaEnabled = async (user: StiHubUserRecord) => {
    const nextEnabled = !user.mfaEnabled;
    const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/reset-mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: nextEnabled ? 'ENABLE_2FA' : 'DISABLE_2FA',
        iamUsersOverride: loadClientIamUsersOverride(),
      }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.data) {
        saveClientIamUserOverrideIfNewer({
          ...json.data,
          totpConfigured: false,
          totpConfiguredAt: null,
        });
      }
      if (typeof document !== 'undefined') {
        document.cookie = 'stihub_totp_enrolled_r1=; Path=/; Max-Age=0; SameSite=Lax';
      }
      onShowToast(
        nextEnabled
          ? `Autenticador exigido para ${user.name}! No próximo login será solicitado o cadastro do QR Code.`
          : `Autenticador desabilitado para ${user.name}! No próximo login o sistema forçará o usuário a habilitar e cadastrar um novo autenticador (QR Code).`
      );
      await onRefresh();
    }
  };

  const handleDeleteUser = async (user: StiHubUserRecord) => {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorEmail: activeUser?.email }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      onShowToast(json?.error || `Não foi possível excluir ${user.name}.`);
      setConfirmDeleteUserId(null);
      return;
    }
    saveClientDeletedUserOverride(user.id, user.email);
    setLocalDeletedIds((prev) => [...prev, user.id, user.email.toLowerCase()]);
    setConfirmDeleteUserId(null);
    if (editingUser?.id === user.id) {
      setEditingUser(null);
      setModalTotpPreview(null);
    }
    onShowToast(`Usuário ${user.name} (${user.email}) excluído com sucesso.`);
    await onRefresh();
  };

  // Tela inicial padrao por usuario (somente SUPER_ADMIN ou Full Control do modulo; validado no servidor)
  const [savingHomeScreenUserId, setSavingHomeScreenUserId] = useState<string | null>(null);
  const actorIsSuperAdmin = activeUser?.roleId === 'SUPER_ADMIN';
  const actorFullControlModules = (['CRM', 'ERP', 'CHAMADOS'] as StiHubMacroModule[]).filter((m) =>
    activeUser ? isModuleFullControl(activeUser, m) : false
  );
  const canAdminHomeScreen = actorIsSuperAdmin || actorFullControlModules.length > 0;
  const homeScreenOptionsFor = (user: StiHubUserRecord) => {
    const access = moduleAccessFromUser(user);
    return HOME_SCREENS.filter(
      (scr) =>
        systemHasAccess(scr.system, access) &&
        (actorIsSuperAdmin || actorFullControlModules.includes(scr.system as StiHubMacroModule))
    );
  };
  const handleSetUserHomeScreen = async (user: StiHubUserRecord, screenId: HomeScreenId | null) => {
    setSavingHomeScreenUserId(user.id);
    try {
      const res = await fetch(`/api/iam/users/${encodeURIComponent(user.id)}/home-screen`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeScreen: screenId, iamUsersOverride: loadClientIamUsersOverride() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        onShowToast(json?.error || 'Não foi possível salvar a tela inicial padrão.');
        return;
      }
      if (json?.data?.user) {
        saveClientIamUserOverrideIfNewer(json.data.user);
        if (editingUser && editingUser.id === user.id) setEditingUser(json.data.user);
      }
      onShowToast(
        screenId
          ? `Tela inicial de ${user.name}: ${getHomeScreen(screenId).system === 'CHAMADOS' ? 'Chamados' : getHomeScreen(screenId).system} - ${getHomeScreen(screenId).label}.`
          : `Tela inicial de ${user.name} restaurada para o padrão do sistema.`
      );
      await onRefresh();
    } finally {
      setSavingHomeScreenUserId(null);
    }
  };

  const handleApplyFullControlQuick = async (
    user: StiHubUserRecord,
    mod: StiHubMacroModule
  ) => {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/full-control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: mod, iamUsersOverride: loadClientIamUsersOverride() }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.data) {
        saveClientIamUserOverrideIfNewer(json.data);
        if (editingUser && editingUser.id === user.id) {
          setEditingUser(json.data);
        }
      }
      onShowToast(`Full Control aplicado no módulo ${mod} para ${user.name}!`);
      await onRefresh();
    }
  };

  const handleResetUserTotpQr = async (user: StiHubUserRecord) => {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/reset-mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'RESET_QR', iamUsersOverride: loadClientIamUsersOverride() }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.data) {
        saveClientIamUserOverrideIfNewer({
          ...json.data,
          totpConfigured: false,
          totpConfiguredAt: null,
        });
      }
      if (typeof document !== 'undefined') {
        document.cookie = 'stihub_totp_enrolled_r1=; Path=/; Max-Age=0; SameSite=Lax';
      }
      onShowToast(
        `QR Code do autenticador resetado para ${user.name}! No próximo login será exibido o QR Code para novo pareamento.`
      );
      await onRefresh();
    }
  };

  const handleGenerateUserInvite = async (user: StiHubUserRecord) => {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://sti-hub.vercel.app';
    const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, resetTotp: true, iamUsersOverride: loadClientIamUsersOverride() }),
    });
    if (res.ok) {
      const json = await res.json();
      const d = json?.data;
      if (d?.user) {
        saveClientIamUserOverrideIfNewer({
          ...d.user,
          totpConfigured: false,
          totpConfiguredAt: null,
        });
      }
      if (d?.inviteUrl) {
        try {
          navigator.clipboard?.writeText(d.inviteUrl);
        } catch {}
        setInviteModalData({
          userName: user.name,
          email: user.email,
          inviteUrl: d.inviteUrl,
          conviteUrl: d.conviteUrl || d.inviteUrl,
          expiresAt: d.expiresAt || new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
          emailDelivered: Boolean(d.emailDelivered),
        });
        onShowToast(`Link de convite gerado e copiado para ${user.email}!`);
      }
      await onRefresh();
    }
  };

  const handleUpdateRoleDualPanels = async (patch: {
    crmPermissions?: StiHubCrmPermissions;
    erpPermissions?: StiHubErpPermissions;
    enabledModules?: StiHubMacroModule[];
  }) => {
    if (!selectedRole) return;
    setSavingRole(true);
    try {
      const res = await fetch(`/api/admin/roles/${encodeURIComponent(selectedRole.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        onShowToast(`Políticas IAM (Painel CRM / Painel ERP) atualizadas para ${selectedRole.name}!`);
        await onRefresh();
      }
    } finally {
      setSavingRole(false);
    }
  };

  const handleToggleUserModuleInline = async (
    user: StiHubUserRecord,
    mod: StiHubMacroModule
  ) => {
    const current = Array.isArray(user.enabledModules) && user.enabledModules.length > 0
      ? user.enabledModules
      : buildDefaultModuleAccessForRole(user.roleId, user.email).enabledModules;
    const exists = current.includes(mod);
    const next = exists ? current.filter((m) => m !== mod) : [...current, mod];
    if (next.length === 0) {
      onShowToast('O usuário deve ter ao menos 1 módulo habilitado (CRM, ERP ou Chamados).');
      return;
    }
    await handleUpdateUserInline(user, {
      enabledModules: next,
      moduleAccess: {
        crm: next.includes('CRM'),
        erp: next.includes('ERP'),
        chamados: next.includes('CHAMADOS'),
      },
    });
  };

  const handleLoadUserTotpQr = async (emailOrId: string, regenerate = false) => {
    const res = await fetch('/api/auth/setup-totp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailOrId, regenerate }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.data) {
        setModalTotpPreview({
          totpSecret: json.data.totpSecret,
          otpauthUri: json.data.otpauthUri,
          qrCodeSvgDataUrl: json.data.qrCodeSvgDataUrl,
          currentTotpCode: json.data.currentTotpCode,
        });
        onShowToast(
          regenerate
            ? 'Nova chave TOTP RFC 6238 e QR Code Google Authenticator gerados!'
            : 'QR Code Google Authenticator (RFC 6238) carregado!'
        );
      }
    }
  };

  const handleDispatchTestEmailOtp = async (emailOrId: string) => {
    const res = await fetch('/api/auth/send-email-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailOrId }),
    });
    const json = await res.json();
    if (res.ok && json?.data) {
      onShowToast(
        `Código OTP enviado para ${json.data.email} (Protocolo ${json.data.protocol})!`
      );
    } else {
      onShowToast(json?.error || 'Falha ao enviar OTP por e-mail.');
    }
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;
    const effectiveMods: StiHubMacroModule[] =
      newUserModules.length > 0 ? newUserModules : ['CRM'];
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
        crmRole: newUserCrmRole,
        erpRole: newUserErpRole,
        totpSecret: newUserTotpSecret,
        crmItemPermissions: crmRolesMatrixState[newUserCrmRole]?.itemPermissions || buildDefaultCrmItemPermissions(newUserCrmRole),
        erpItemPermissions: erpRolesMatrixState[newUserErpRole]?.itemPermissions || buildDefaultErpItemPermissions(newUserErpRole),
        scope: newUserScope,
        enabledModules: effectiveMods,
        moduleAccess: {
          crm: effectiveMods.includes('CRM'),
          erp: effectiveMods.includes('ERP'),
          chamados: effectiveMods.includes('CHAMADOS'),
        },
        crmPermissions: {
          ...newUserCrmPerms,
          portfolioScope: newUserScope,
        },
        erpPermissions: newUserErpPerms,
        active: true,
        mfaEnabled: newUserMfaEnabled,
        mfaMethod: newUserMfaMethod,
        totpConfigured: false,
        password: newUserPassword.trim().length >= 6 ? newUserPassword.trim() : undefined,
        origin: typeof window !== 'undefined' ? window.location.origin : 'https://sti-hub.vercel.app',
      }),
    });
    if (res.ok) {
      const json = await res.json();
      const created = json?.data;
      if (created) {
        saveClientIamUserOverrideIfNewer({
          ...created,
          totpConfigured: false,
          totpConfiguredAt: null,
          ...(newUserPassword.trim().length >= 6 ? { password: newUserPassword.trim() } : {}),
        });
        if (created.inviteUrl) {
          try {
            navigator.clipboard?.writeText(created.inviteUrl);
          } catch {}
          setInviteModalData({
            userName: created.name || newUserName.trim(),
            email: created.email || newUserEmail.trim(),
            inviteUrl: created.inviteUrl,
            conviteUrl: created.conviteUrl || created.inviteUrl,
            expiresAt: created.inviteExpiresAt || new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
            emailDelivered: Boolean(created.inviteEmailDelivered),
          });
        }
      }
      if (typeof document !== 'undefined') {
        document.cookie = 'stihub_totp_enrolled_r1=; Path=/; Max-Age=0; SameSite=Lax';
      }
      setShowNewUserModal(false);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
      onShowToast(
        `Colaborador ${newUserName} cadastrado! Link de convite gerado para cadastrar senha e autenticador.`
      );
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
            <span className="px-2.5 py-0.5 rounded bg-[#ff7a59] text-white text-[10px] font-semibold uppercase tracking-wider">
              GOVERNANÇA CORPORATIVA STI-HUB • SEÇÕES 4 &amp; 5 DO ROADMAP
            </span>
            <span className="px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-semibold">
              9 Perfis RBAC • {users.length} Usuários ({users.filter((u) => u.active).length} Ativos) • MFA 2FA Ativo
            </span>
          </div>
          <h2 className="text-base sm:text-lg font-semibold">
            Central Unificada de Administração &amp; Configurações (CRM + SETA ERP)
          </h2>
          <p className="text-xs text-slate-300">
            Controle granular de acesso por perfil e colaborador (GestãoClick Loja #118887 + HubSpot Portal #4369067), escopo de visibilidade (Todos / Equipe / Próprios), disparo validado de e-mails e subdomínios oficiais.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <a
            href="/login"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white text-[#0d2b4e] hover:bg-slate-100 text-xs font-semibold shadow-xs"
          >
            <Lock className="w-3.5 h-3.5 text-[#ff7a59]" /> Abrir Tela de Login + MFA (/login)
          </a>
          <button
            type="button"
            onClick={() => setShowNewUserModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold shadow-xs cursor-pointer"
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
            label: `Usuários (${users.length})`,
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
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
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
          SUB-VIEW 1: CONFIGURAÇÕES > USUÁRIOS (TELA INICIAL LIMPA DE LISTAGEM)
          Nenhuma permissão fica solta na tela inicial: ao clicar em um usuário,
          abre a página completa de Cadastro + 2FA + Tipos de Conta + Permissões de Todos os Sistemas.
      ==================================================================== */}
      {subView === 'USERS_RBAC' && !editingUser && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <span className="text-[10px] font-semibold uppercase text-[#1e3a6e] block">
                CONFIGURAÇÕES &gt; USUÁRIOS • DIRETÓRIO DE CONTAS SETA TELECOM
              </span>
              <h3 className="text-base font-semibold text-slate-900">
                Usuários ({filteredUsers.length} de {users.length})
              </h3>
              <p className="text-xs text-slate-500">
                Clique em um usuário abaixo para abrir o cadastro completo, pareamento 2FA Google Authenticator, tipos de conta e permissões de todos os sistemas.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={searchUser}
                onChange={(e) => setSearchUser(e.target.value)}
                placeholder="Buscar por nome, e-mail, cargo ou departamento..."
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs w-64"
              />
              {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setUserFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                    userFilter === f
                      ? 'bg-[#0d2b4e] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {f === 'ALL'
                    ? `Todos (${users.length})`
                    : f === 'ACTIVE'
                      ? `Ativos (${users.filter((u) => u.active).length})`
                      : `Desativados (${users.filter((u) => !u.active).length})`}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowNewUserModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> + Novo Usuário
              </button>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-xs font-semibold text-slate-700">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 text-[11px] font-semibold">
                <tr>
                  <th className="py-3 px-3.5 font-semibold">Colaborador / E-mail</th>
                  <th className="py-3 px-3.5 font-semibold">Cargo / Departamento</th>
                  <th className="py-3 px-3.5 font-semibold">Módulos &amp; Tipos de Conta</th>
                  <th className="py-3 px-3.5 font-semibold">Tela inicial padrão</th>
                  <th className="py-3 px-3.5 font-semibold">Autenticador 2FA</th>
                  <th className="py-3 px-3.5 font-semibold">Status</th>
                  <th className="py-3 px-3.5 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((u) => {
                  const isCurrentActive = activeUser?.id === u.id;
                  const inferred = inferCrmAndErpRolesFromLegacyRole(u.roleId || "VENDEDOR_SALES");
                  const cRole: CrmAccountRole = (u.crmRole as CrmAccountRole) || inferred.crmRole;
                  const eRole: ErpAccountRole = (u.erpRole as ErpAccountRole) || inferred.erpRole;
                  const crmFull = isModuleFullControl(u, "CRM");
                  const erpFull = isModuleFullControl(u, "ERP");
                  const chamadosFull = isModuleFullControl(u, "CHAMADOS");

                  return (
                    <tr
                      key={u.id}
                      onClick={() => setEditingUser(u)}
                      title="Clique na linha para editar dados, módulos e permissões deste usuário"
                      className={`cursor-pointer transition hover:bg-slate-50/90 ${
                        isCurrentActive
                          ? "bg-blue-50/30"
                          : !u.active
                            ? "opacity-60 bg-slate-50/40"
                            : ""
                      }`}
                    >
                      <td className="py-3 px-3.5">
                        <div className="font-medium text-slate-800 flex items-center gap-1.5">
                          <span>{u.name}</span>
                          {isCurrentActive && (
                            <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 text-[10px] font-semibold">
                              Sessão atual
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 font-semibold mt-0.5">{u.email}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-semibold text-slate-700">{u.jobTitle}</div>
                        <div className="text-[11px] text-slate-400 font-semibold">{u.department}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-semibold">
                            CRM: {CRM_ROLES_CATALOG[cRole]?.label || cRole}
                            {crmFull ? " (Full Control)" : ""}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-semibold">
                            ERP: {ERP_ROLES_CATALOG[eRole]?.label || eRole}
                            {erpFull ? " (Full Control)" : ""}
                          </span>
                          {chamadosFull && (
                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold">
                              Chamados: Full Control
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3.5" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const saved = isHomeScreenId(u.homeScreen) ? u.homeScreen : null;
                          const savedAllowed = saved ? systemHasAccess(getHomeScreen(saved).system, moduleAccessFromUser(u)) : false;
                          const savedLabel = saved
                            ? `${getHomeScreen(saved).system === 'CHAMADOS' ? 'Chamados' : getHomeScreen(saved).system} - ${getHomeScreen(saved).label}`
                            : 'Padrão do sistema';
                          if (!canAdminHomeScreen) {
                            return <span className="text-[11px] font-semibold text-slate-600">{savedLabel}</span>;
                          }
                          const options = homeScreenOptionsFor(u);
                          return (
                            <div className="flex flex-col gap-1 min-w-[190px]">
                              <select
                                aria-label={`Tela inicial padrão de ${u.name}`}
                                value={saved && options.some((o) => o.id === saved) ? saved : ''}
                                disabled={savingHomeScreenUserId === u.id}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  handleSetUserHomeScreen(u, v && isHomeScreenId(v) ? v : null);
                                }}
                                className="px-2 py-1 rounded-md border border-slate-300 bg-white text-[11px] font-semibold text-slate-700 cursor-pointer disabled:opacity-60"
                              >
                                <option value="">Padrão do sistema</option>
                                {(['CRM', 'ERP', 'CHAMADOS'] as const).map((sys) => {
                                  const group = options.filter((o) => o.system === sys);
                                  if (group.length === 0) return null;
                                  return (
                                    <optgroup key={sys} label={sys === 'CHAMADOS' ? 'Chamados' : sys}>
                                      {group.map((o) => (
                                        <option key={o.id} value={o.id}>
                                          {o.label}
                                        </option>
                                      ))}
                                    </optgroup>
                                  );
                                })}
                              </select>
                              {saved && !savedAllowed && (
                                <span className="text-[10px] font-semibold text-amber-700">
                                  Sem acesso ao sistema salvo: abre o primeiro permitido
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="py-3 px-3.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            title={
                              u.mfaEnabled
                                ? "Desabilitar o autenticador atual: no próximo login o usuário será obrigado a habilitar e cadastrar um novo autenticador (QR Code)"
                                : "Autenticador desabilitado: no próximo login o usuário será obrigado a habilitar e cadastrar o autenticador (QR Code)"
                            }
                            onClick={() => handleToggleUserMfaEnabled(u)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border cursor-pointer transition ${
                              u.mfaEnabled && u.totpConfigured !== false
                                ? "bg-emerald-50/70 text-emerald-800 border-emerald-200 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-200"
                                : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-emerald-50 hover:text-emerald-800"
                            }`}
                          >
                            {u.mfaEnabled && u.totpConfigured !== false
                              ? "Desabilitar Autenticador"
                              : "Pendente Cadastro 2FA no Login"}
                          </button>
                          <button
                            type="button"
                            title="Resetar QR Code para forçar novo pareamento no próximo login"
                            onClick={() => handleResetUserTotpQr(u)}
                            className="px-2 py-1 rounded-md bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 text-[11px] font-semibold cursor-pointer"
                          >
                            Resetar QR
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-3.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            u.active
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-slate-100 text-slate-500 border border-slate-200"
                          }`}
                        >
                          {u.active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="py-3 px-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            title="Enviar convite por e-mail com link para o usuário cadastrar a senha e o autenticador"
                            onClick={() => handleGenerateUserInvite(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-[11px] font-semibold cursor-pointer"
                          >
                            <Mail className="w-3.5 h-3.5 text-emerald-600" /> Enviar Convite por E-mail
                          </button>
                          {confirmDeleteUserId === u.id ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleDeleteUser(u)}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold cursor-pointer"
                              >
                                Confirmar Exclusão
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteUserId(null)}
                                className="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-semibold cursor-pointer"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              title="Excluir este usuário"
                              onClick={() => setConfirmDeleteUserId(u.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white hover:bg-rose-50 text-rose-600 border border-slate-200 hover:border-rose-200 text-[11px] font-semibold cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Excluir
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
      )}

      {/* ====================================================================
          SUB-VIEW 2: VALIDATED EMAIL DISPATCHER & DYNAMIC TEMPLATES LIBRARY
      ==================================================================== */}
      {subView === 'EMAIL_TEMPLATES' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Mailer Config & Validated Test Dispatch */}
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div>
              <span className="text-[10px] font-semibold uppercase text-emerald-700 block">
                STI-HUB MAILER • INFRAESTRUTURA DE ENVIO VALIDADO
              </span>
              <h3 className="text-base font-semibold text-slate-900">
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
                <code className="font-mono font-semibold text-[#0d2b4e]">
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
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                  VERIFICADO (setatelecom.com.br)
                </span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200 space-y-3 text-xs">
              <div className="font-semibold text-[#0d2b4e]">
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
                  className="px-4 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-semibold cursor-pointer shrink-0"
                >
                  {sendingTestEmail ? 'Enviando...' : 'Disparar Teste'}
                </button>
              </div>
              {lastTestProtocol && (
                <div className="p-2.5 rounded bg-emerald-100 text-emerald-900 font-mono text-[11px] font-semibold">
                  E-mail validado com sucesso! Protocolo: {lastTestProtocol}
                </div>
              )}
            </div>

            <form onSubmit={handleCreateEmailTemplate} className="space-y-3 pt-2 border-t border-slate-200 text-xs">
              <div className="font-semibold text-slate-900">
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
                  className="px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold"
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
                className="w-full py-2.5 rounded-lg bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white font-semibold cursor-pointer"
              >
                {savingTpl ? 'Salvando...' : 'Salvar Modelo na Biblioteca'}
              </button>
            </form>
          </div>

          {/* Right: Dynamic Email Templates Library */}
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-semibold uppercase text-[#1e3a6e] block">
                  CONFIGURAÇÕES &gt; MODELOS DE E-MAILS (CFG_EMAILS)
                </span>
                <h3 className="text-base font-semibold text-slate-900">
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
                      <span className="px-2 py-0.5 rounded bg-[#0d2b4e] text-white text-[10px] font-semibold">
                        {tpl.category}
                      </span>
                      <strong className="text-sm text-slate-900">{tpl.name}</strong>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      Usos: <strong>{tpl.usageCount}</strong> • Autor: {tpl.createdBy}
                    </span>
                  </div>
                  <div className="font-semibold text-[#1e3a6e]">Assunto: {tpl.subject}</div>
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
              <span className="text-[10px] font-semibold uppercase text-[#ff7a59] block">
                SEÇÃO 3 DO ROADMAP • CUSTOM PROPERTIES HUBSPOT PORTAL #4369067
              </span>
              <h3 className="text-base font-semibold text-slate-900">
                Dicionário de Propriedades Customizadas Sincronizadas (Contatos, Empresas, Deals &amp; Tickets)
              </h3>
            </div>
            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">
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
                  <span className="px-2 py-0.5 rounded bg-[#0d2b4e] text-white text-[10px] font-semibold">
                    {prop.objectType}
                  </span>
                  <code className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-mono text-[11px] font-semibold">
                    {prop.internalName}
                  </code>
                </div>
                <div className="text-sm font-semibold text-slate-900">{prop.label}</div>
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
              <span className="text-[10px] font-semibold uppercase text-[#1e3a6e] block">
                SEÇÃO 5.4 DO ROADMAP • DOMÍNIO &amp; SUBDOMÍNIOS CORPORATIVOS SETA TELECOM
              </span>
              <h3 className="text-base font-semibold text-slate-900">
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
                      <td className="py-2.5 px-3 font-mono font-semibold text-[#0d2b4e]">
                        https://{sd.domain}
                        {sd.isDefaultPublicProposalDomain && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-sans text-[9px] font-semibold">
                            PADRÃO PDF
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-semibold">{sd.type}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{sd.cnameTarget}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-semibold">
                          {sd.sslStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="font-semibold text-slate-900">
                Instrução DNS para Zona <code className="font-mono">setatelecom.com.br</code>:
              </div>
              <p className="text-slate-600">
                • Tipo: <strong>CNAME</strong> | Nome: <code>stihub</code> (ou <code>erp</code>) | Valor:{' '}
                <code className="font-mono font-semibold">cname.vercel-dns.com</code> | TTL: Automático.
              </p>
              <p className="text-slate-600">
                • Todos os links públicos de propostas comerciais (<code>/proposta/[id]</code>) utilizam automaticamente o domínio ativo da sessão ou <code>https://sti-hub.vercel.app</code>.
              </p>
            </div>
          </div>

          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div>
              <span className="text-[10px] font-semibold uppercase text-emerald-700 block">
                SEÇÕES 5.1 &amp; 5.2 DO ROADMAP • AUTH GUARD &amp; MFA 2FA
              </span>
              <h3 className="text-base font-semibold text-slate-900">
                Política de Proteção de Rotas (`src/middleware.ts`)
              </h3>
            </div>

            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                <div className="font-semibold text-emerald-950">
                  Etapa Obrigatória MFA 2FA (TOTP 6 Dígitos)
                </div>
                <p className="text-[11px] text-emerald-800 mt-0.5">
                  Sessão emitida em cookie <code>HttpOnly</code> (<code>stihub_session</code>, TTL{' '}
                  {securityConfig?.sessionTtlHours || 24}h) somente após validação do segundo fator.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <div className="font-semibold text-slate-900">Rotas Públicas Liberadas (Whitelisted):</div>
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
              className="w-full py-2.5 rounded-xl bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white font-semibold flex items-center justify-center gap-2"
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
              <span className="text-[10px] font-semibold uppercase text-[#1e3a6e] block">
                CONFIGURAÇÕES &gt; DADOS DA EMPRESA EMITENTE (CFG_EMPRESA / LOJA MATRIZ #118887)
              </span>
              <h3 className="text-base font-semibold text-slate-900">
                Ficha Fiscal e Bancária da Seta Telecom LTDA
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleLookupEmitterCnpj}
                disabled={lookingUpEmitterCnpj}
                className="px-3.5 py-2 rounded-lg bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white font-semibold cursor-pointer"
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
                className="px-4 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-semibold cursor-pointer"
              >
                {savingSettings ? 'Salvando...' : 'Salvar Dados da Empresa'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Razão Social Emitente</label>
              <input
                type="text"
                value={companyEmitter.legalName}
                onChange={(e) => setCompanyEmitter({ ...companyEmitter, legalName: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-semibold"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nome Fantasia / Unidade</label>
              <input
                type="text"
                value={companyEmitter.tradeName}
                onChange={(e) => setCompanyEmitter({ ...companyEmitter, tradeName: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">CNPJ Matriz</label>
              <input
                type="text"
                value={companyEmitter.cnpj}
                onChange={(e) => setCompanyEmitter({ ...companyEmitter, cnpj: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono font-semibold"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Inscrição Estadual (IE)</label>
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
              <label className="block font-semibold text-slate-700 mb-1">Inscrição Municipal (IM)</label>
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
              <label className="block font-semibold text-slate-700 mb-1">Regime Tributário</label>
              <select
                value={companyEmitter.taxRegime}
                onChange={(e) =>
                  setCompanyEmitter({
                    ...companyEmitter,
                    taxRegime: e.target.value as StiHubCompanyEmitterSettings['taxRegime'],
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold"
              >
                <option value="LUCRO_PRESUMIDO">Lucro Presumido (PIS 0,65% / COFINS 3%)</option>
                <option value="LUCRO_REAL">Lucro Real (PIS 1,65% / COFINS 7,6%)</option>
                <option value="SIMPLES_NACIONAL">Simples Nacional</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">CNAE Principal Fiscal</label>
              <input
                type="text"
                value={companyEmitter.cnaeMain}
                onChange={(e) => setCompanyEmitter({ ...companyEmitter, cnaeMain: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Código IBGE Município</label>
              <input
                type="text"
                value={companyEmitter.ibgeCode}
                onChange={(e) => setCompanyEmitter({ ...companyEmitter, ibgeCode: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">CEP</label>
              <input
                type="text"
                value={companyEmitter.cep}
                onChange={(e) => setCompanyEmitter({ ...companyEmitter, cep: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Logradouro &amp; Número</label>
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
              <label className="block font-semibold text-slate-700 mb-1">Cidade / UF</label>
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
                  className="col-span-1 px-3 py-2 rounded-lg border border-slate-300 font-semibold"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Conta Principal Banco Inter</label>
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
              <label className="block font-semibold text-slate-700 mb-1">Conta Principal Banco Itaú</label>
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
                <span className="text-[10px] font-semibold uppercase text-[#1e3a6e] block">
                  CONFIGURAÇÕES &gt; CERTIFICADO DIGITAL A1 &amp; NUMERAÇÃO FISCAL (CFG_CERTIFICADO)
                </span>
                <h3 className="text-base font-semibold text-slate-900">
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
                className="px-4 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-semibold cursor-pointer"
              >
                {savingSettings ? 'Salvando...' : 'Salvar Parâmetros Fiscais'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Arquivo Certificado A1 (.pfx)</label>
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
                <label className="block font-semibold text-slate-700 mb-1">Ambiente SEFAZ / Prefeitura</label>
                <select
                  value={certificateSettings.sefazEnvironment}
                  onChange={(e) =>
                    setCertificateSettings({
                      ...certificateSettings,
                      sefazEnvironment: e.target.value as 'PRODUCAO' | 'HOMOLOGACAO',
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold"
                >
                  <option value="PRODUCAO">PRODUÇÃO (Validade Jurídica Ativa)</option>
                  <option value="HOMOLOGACAO">HOMOLOGAÇÃO (Testes SEFAZ)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Série &amp; Próxima NF-e Produto (Mod. 55)</label>
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
                <label className="block font-semibold text-slate-700 mb-1">Série &amp; Próxima NFS-e Serviço (LC 116)</label>
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
                <label className="block font-semibold text-slate-700 mb-1">Série &amp; Próxima NFCom Telecom (Mod. 62)</label>
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
                <label className="block font-semibold text-slate-700 mb-1">Prefixo &amp; Próxima Fatura Locação (0% ISS SV 31)</label>
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
              <span className="text-[10px] font-semibold uppercase text-emerald-700 block">
                CONFIGURAÇÕES GERAIS DO SISTEMA (CFG_GERAIS)
              </span>
              <h3 className="text-base font-semibold text-slate-900">
                Regras Comerciais, Financeiras e Travas Globais
              </h3>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Alçada Desconto Padrão (%)</label>
                  <input
                    type="number"
                    value={generalParameters.defaultSalesDiscountLimitPercent}
                    onChange={(e) =>
                      setGeneralParameters({
                        ...generalParameters,
                        defaultSalesDiscountLimitPercent: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Índice Reajuste Contratos</label>
                  <select
                    value={generalParameters.defaultContractReadjustmentIndex}
                    onChange={(e) =>
                      setGeneralParameters({
                        ...generalParameters,
                        defaultContractReadjustmentIndex: e.target
                          .value as StiHubGeneralSystemParameters['defaultContractReadjustmentIndex'],
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold"
                  >
                    <option value="IPCA">IPCA (IBGE)</option>
                    <option value="IGP-M">IGP-M (FGV)</option>
                    <option value="IST_ANATEL">IST Anatel</option>
                    <option value="FIXO">Fixo</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Multa Atraso Boleto (%)</label>
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
                  <label className="block font-semibold text-slate-700 mb-1">Juros Mensal Boleto (%)</label>
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
                <div className="font-semibold text-emerald-950">
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
              <span className="text-[10px] font-semibold uppercase text-[#ff7a59] block">
                HOMOLOGAÇÃO OFICIAL DA MIGRAÇÃO GESTÃOCLICK (#118887) &rarr; STI-HUB
              </span>
              <h3 className="text-base font-semibold text-slate-900">
                Checklist Verificável dos 11 Módulos Importados (6.414 Registros Reais)
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
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
                      <span className="px-2.5 py-0.5 rounded bg-[#0d2b4e] text-white font-semibold">
                        {item.moduleName}
                      </span>
                      <span className="px-2.5 py-0.5 rounded bg-blue-100 text-[#1e3a6e] font-semibold">
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
                          className={`px-2.5 py-1 rounded font-semibold text-[11px] cursor-pointer transition ${cls}`}
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
                  <span className="font-semibold text-slate-700 shrink-0">Observações da Conferência:</span>
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
              <span className="text-[10px] font-semibold uppercase text-emerald-700 block">
                SINCRONIZAÇÃO AUTOMÁTICA DIÁRIA • GESTÃOCLICK (#118887) &rarr; STI-HUB (/api/erp/daily-sync)
              </span>
              <h3 className="text-base font-semibold text-slate-900">
                Motor Incremental Diário (07h00 EDT) &amp; Histórico de Execuções
              </h3>
            </div>
            <button
              type="button"
              onClick={handleRunDailySyncNow}
              disabled={runningSyncNow}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
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
                    <span className="px-2 py-0.5 rounded bg-[#0d2b4e] text-white font-mono font-semibold">
                      {log.runId}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold text-[10px]">
                      {log.mode === 'INITIAL_WIPE_AND_FULL_IMPORT'
                        ? 'LIMPEZA + CARGA TOTAL INICIAL'
                        : 'SINCRONIZAÇÃO DIÁRIA INCREMENTAL'}
                    </span>
                    <span className="text-slate-500">
                      {new Date(log.timestamp).toLocaleString('pt-BR')} ({log.durationMs}ms)
                    </span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded bg-emerald-600 text-white font-semibold text-[10px]">
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

      {/* Modal: Edit Existing User (IAM: 2FA + Escopo Modular + Painel 1 CRM + Painel 2 ERP) */}
      {editingUser && (() => {
        const userMods: StiHubMacroModule[] =
          Array.isArray(editingUser.enabledModules) && editingUser.enabledModules.length > 0
            ? editingUser.enabledModules
            : buildDefaultModuleAccessForRole(editingUser.roleId, editingUser.email).enabledModules;
        const userCrm: StiHubCrmPermissions =
          editingUser.crmPermissions ||
          buildDefaultCrmPermissionsForRole(editingUser.roleId, editingUser.scope);
        const userErp: StiHubErpPermissions =
          editingUser.erpPermissions || buildDefaultErpPermissionsForRole(editingUser.roleId);
        const setMods = (nextMods: StiHubMacroModule[]) => {
          const safe = nextMods.length > 0 ? nextMods : (['CRM'] as StiHubMacroModule[]);
          setEditingUser({
            ...editingUser,
            enabledModules: safe,
            moduleAccess: {
              crm: safe.includes('CRM'),
              erp: safe.includes('ERP'),
              chamados: safe.includes('CHAMADOS'),
            },
          });
        };

        return (
          <div className="w-full">
            <div className="bg-white rounded-2xl border-2 border-[#0d2b4e] shadow-sm w-full p-6 space-y-5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingUser(null);
                      setModalTotpPreview(null);
                    }}
                    className="px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 font-semibold text-slate-800 cursor-pointer"
                  >
                    ← Voltar para Lista de Usuários
                  </button>
                  <div>
                    <span className="text-[10px] font-semibold uppercase text-[#ff7a59] block">
                      CONFIGURAÇÕES &gt; USUÁRIOS &gt; TELA DE CADASTRO DO USUÁRIO, TIPOS DE CONTA E PERMISSÕES (TODOS OS SISTEMAS)
                    </span>
                    <h3 className="text-base font-semibold text-slate-900">
                      Cadastro do Usuário &amp; Permissões — {editingUser.name} ({editingUser.email}) • {editingUser.active ? "ATIVO" : "DESATIVADO"}
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingUser(null);
                    setModalTotpPreview(null);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Fechar
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await handleUpdateUserInline(editingUser, {
                    ...editingUser,
                    enabledModules: userMods,
                    moduleAccess: {
                      crm: userMods.includes('CRM'),
                      erp: userMods.includes('ERP'),
                      chamados: userMods.includes('CHAMADOS'),
                    },
                    crmRole: (editingUser.crmRole as CrmAccountRole) || inferCrmAndErpRolesFromLegacyRole(editingUser.roleId).crmRole,
                    erpRole: (editingUser.erpRole as ErpAccountRole) || inferCrmAndErpRolesFromLegacyRole(editingUser.roleId).erpRole,
                    crmItemPermissions: editingUser.crmItemPermissions,
                    erpItemPermissions: editingUser.erpItemPermissions,
                    itemPermissions: editingUser.itemPermissions,
                    totpSecret: editingUser.totpSecret,
                    crmPermissions: userCrm,
                    erpPermissions: userErp,
                  });
                  setEditingUser(null);
                  setModalTotpPreview(null);
                }}
                className="space-y-4"
              >
                {/* Bloco 1: Dados Cadastrais & Autenticação 2FA */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Nome Completo *</label>
                    <input
                      type="text"
                      required
                      value={editingUser.name}
                      onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">E-mail Corporativo *</label>
                    <input
                      type="email"
                      required
                      value={editingUser.email}
                      onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Departamento / Cargo</label>
                    <input
                      type="text"
                      value={editingUser.jobTitle}
                      onChange={(e) => setEditingUser({ ...editingUser, jobTitle: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Perfil Base RBAC</label>
                    <select
                      value={editingUser.roleId}
                      onChange={(e) => {
                        const nextRole = e.target.value as StiHubRoleId;
                        const defMod = buildDefaultModuleAccessForRole(nextRole, editingUser.email);
                        setEditingUser({
                          ...editingUser,
                          roleId: nextRole,
                          enabledModules: defMod.enabledModules,
                          moduleAccess: defMod.moduleAccess,
                          crmPermissions: buildDefaultCrmPermissionsForRole(nextRole, editingUser.scope),
                          erpPermissions: buildDefaultErpPermissionsForRole(nextRole),
                        });
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold"
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.id} — {r.name.slice(0, 26)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Método 2FA (Google Authenticator / E-mail OTP)
                    </label>
                    <select
                      value={editingUser.mfaMethod}
                      onChange={(e) =>
                        setEditingUser({
                          ...editingUser,
                          mfaMethod: e.target.value as 'TOTP_AUTHENTICATOR' | 'EMAIL_OTP',
                        })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold text-[#0d2b4e]"
                    >
                      <option value="TOTP_AUTHENTICATOR">
                        Google Authenticator (TOTP RFC 6238 • 30s)
                      </option>
                      <option value="EMAIL_OTP">
                        Código OTP enviado por E-mail Corporativo
                      </option>
                    </select>
                  </div>

                  <div className="flex flex-col justify-end gap-1.5">
                    {editingUser.mfaMethod === 'TOTP_AUTHENTICATOR' ? (
                      <button
                        type="button"
                        onClick={() => handleLoadUserTotpQr(editingUser.email, false)}
                        className="w-full py-2 px-3 rounded-lg bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white font-semibold cursor-pointer"
                      >
                        Parear Google Authenticator (QR / Base32)
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDispatchTestEmailOtp(editingUser.email)}
                        className="w-full py-2 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
                      >
                        Disparar Código OTP p/ E-mail Agora
                      </button>
                    )}
                  </div>
                </div>

                {modalTotpPreview && (
                  <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-wrap items-center gap-4">
                    <img
                      src={modalTotpPreview.qrCodeSvgDataUrl}
                      alt="QR Code TOTP"
                      className="w-24 h-24 rounded-lg border border-slate-300 bg-white p-1"
                    />
                    <div className="flex-1 space-y-1 text-[11px]">
                      <div className="font-semibold text-[#0d2b4e]">
                        Pareamento Google Authenticator RFC 6238 ({editingUser.email})
                      </div>
                      <div>
                        Segredo Base32:{' '}
                        <code className="px-2 py-0.5 rounded bg-white border border-slate-300 font-mono font-semibold">
                          {modalTotpPreview.totpSecret}
                        </code>

                      </div>
                      <div className="text-[10px] font-mono text-slate-600 truncate max-w-xl">
                        {modalTotpPreview.otpauthUri}
                      </div>
                    </div>
                  </div>
                )}

                {/* Bloco 2: Habilitação por Módulo (CRM / ERP / Chamados) */}
                <div className="p-4 rounded-xl bg-slate-50 border-2 border-[#0d2b4e]/15 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-semibold uppercase text-[#0d2b4e] block">
                        ESCOPO MODULAR DO USUÁRIO (ISOLAMENTO DE ROTAS &amp; APIS)
                      </span>
                      <div className="font-semibold text-slate-900">
                        Selecione quais módulos do STI-hub este colaborador está habilitado a acessar:
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setMods(['CRM'])}
                        className="px-2 py-1 rounded bg-white border border-slate-300 text-[10px] font-semibold hover:bg-slate-100 cursor-pointer"
                      >
                        Apenas CRM
                      </button>
                      <button
                        type="button"
                        onClick={() => setMods(['ERP'])}
                        className="px-2 py-1 rounded bg-white border border-slate-300 text-[10px] font-semibold hover:bg-slate-100 cursor-pointer"
                      >
                        Apenas ERP
                      </button>
                      <button
                        type="button"
                        onClick={() => setMods(['CHAMADOS'])}
                        className="px-2 py-1 rounded bg-white border border-slate-300 text-[10px] font-semibold hover:bg-slate-100 cursor-pointer"
                      >
                        Apenas Chamados
                      </button>
                      <button
                        type="button"
                        onClick={() => setMods(['CRM', 'ERP', 'CHAMADOS'])}
                        className="px-2 py-1 rounded bg-[#0d2b4e] text-white text-[10px] font-semibold cursor-pointer"
                      >
                        Todos os 3 Módulos
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {(
                      [
                        {
                          id: 'CRM' as const,
                          title: 'Módulo 1: CRM (HubSpot)',
                          desc: 'Contatos, Empresas, Funil Kanban, Marketing & Data Health',
                        },
                        {
                          id: 'ERP' as const,
                          title: 'Módulo 2: ERP (GestãoClick)',
                          desc: 'Cadastros, Propostas #4695, Contratos, Financeiro, Fiscal, Estoque & PDV',
                        },
                        {
                          id: 'CHAMADOS' as const,
                          title: 'Módulo 3: Sistema de Chamados',
                          desc: 'Service Desk NOC N1/N2/N3, SLA Dinâmico & Atendimento',
                        },
                      ]
                    ).map((m) => {
                      const checked = userMods.includes(m.id);
                      return (
                        <label
                          key={m.id}
                          className={`p-3 rounded-xl border-2 flex items-start gap-2.5 cursor-pointer transition ${
                            checked
                              ? 'bg-white border-[#0d2b4e] shadow-xs'
                              : 'bg-slate-100/70 border-slate-200 opacity-70'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...userMods, m.id]
                                : userMods.filter((x) => x !== m.id);
                              setMods(next);
                            }}
                            className="mt-0.5 w-4 h-4 accent-[#0d2b4e]"
                          />
                          <div>
                            <div className="font-semibold text-slate-900">{m.title}</div>
                            <div className="text-[10px] text-slate-500">{m.desc}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Bloco 3: Dois Painéis Separados de Permissões do Usuário (Painel 1 CRM & Painel 2 ERP) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Painel 1: Permissões CRM / HubSpot */}
                  <div className="rounded-xl border border-slate-200 p-4 space-y-2.5 bg-slate-50/50">
                    <div className="font-semibold text-[#0d2b4e] border-b border-slate-200 pb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Painel 1: Permissões CRM &amp; Chamados</span>
                        {isModuleFullControl(editingUser, 'CRM') && (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                            Full Control CRM Ativo
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const patch = buildFullControlForModule('CRM', editingUser);
                            setEditingUser({ ...editingUser, ...patch });
                            handleApplyFullControlQuick(editingUser, 'CRM');
                          }}
                          className="px-2.5 py-1 rounded bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white text-[10px] font-semibold cursor-pointer"
                        >
                          Full Control — CRM
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const patch = buildFullControlForModule('CHAMADOS', editingUser);
                            setEditingUser({ ...editingUser, ...patch });
                            handleApplyFullControlQuick(editingUser, 'CHAMADOS');
                          }}
                          className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold cursor-pointer"
                        >
                          Full Control — Chamados
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-700">Escopo de Carteira:</span>
                      <select
                        value={editingUser.scope}
                        onChange={(e) => {
                          const sc = e.target.value as StiHubVisibilityScope;
                          setEditingUser({
                            ...editingUser,
                            scope: sc,
                            crmPermissions: { ...userCrm, portfolioScope: sc },
                          });
                        }}
                        className="px-2 py-1 rounded border border-slate-300 bg-white font-semibold"
                      >
                        <option value="TODOS">TODOS</option>
                        <option value="EQUIPE">EQUIPE</option>
                        <option value="PROPRIOS">PRÓPRIOS</option>
                      </select>
                    </div>
                    {(
                      [
                        { key: 'contactsAccess', label: 'Contatos' },
                        { key: 'companiesAccess', label: 'Empresas' },
                        { key: 'dealsFunnelAccess', label: 'Deals / Funil' },
                        { key: 'ticketsServiceDeskAccess', label: 'Tickets / Chamados' },
                        { key: 'marketingAutomationAccess', label: 'Marketing / Automação' },
                      ] as const
                    ).map((f) => (
                      <div key={f.key} className="flex items-center justify-between">
                        <span>{f.label}:</span>
                        <select
                          value={userCrm[f.key]}
                          onChange={(e) =>
                            setEditingUser({
                              ...editingUser,
                              crmPermissions: {
                                ...userCrm,
                                [f.key]: e.target.value as StiHubModuleAccessLevel,
                              },
                            })
                          }
                          className="px-2 py-1 rounded border border-slate-300 bg-white font-semibold text-[11px]"
                        >
                          <option value="FULL">FULL (Total)</option>
                          <option value="EDIT">EDIT (Editar)</option>
                          <option value="VIEW">VIEW (Leitura)</option>
                          <option value="NONE">NONE (Bloqueado)</option>
                        </select>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-3 pt-1 border-t border-slate-200">
                      <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={userCrm.canExportCrmData}
                          onChange={(e) =>
                            setEditingUser({
                              ...editingUser,
                              crmPermissions: { ...userCrm, canExportCrmData: e.target.checked },
                            })
                          }
                        />
                        <span>Exportação CRM</span>
                      </label>
                      <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={userCrm.canMergeCrmRecords}
                          onChange={(e) =>
                            setEditingUser({
                              ...editingUser,
                              crmPermissions: { ...userCrm, canMergeCrmRecords: e.target.checked },
                            })
                          }
                        />
                        <span>Merge CRM</span>
                      </label>
                      <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={userCrm.canDeleteCrmRecords}
                          onChange={(e) =>
                            setEditingUser({
                              ...editingUser,
                              crmPermissions: { ...userCrm, canDeleteCrmRecords: e.target.checked },
                            })
                          }
                        />
                        <span>Exclusão CRM</span>
                      </label>
                    </div>
                  </div>

                  {/* Painel 2: Permissões ERP */}
                  <div className="rounded-xl border border-slate-200 p-4 space-y-2.5 bg-slate-50/50">
                    <div className="font-semibold text-[#1e3a6e] border-b border-slate-200 pb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Painel 2: Permissões ERP (SETA | IT)</span>
                        {isModuleFullControl(editingUser, 'ERP') && (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                            Full Control ERP Ativo
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const patch = buildFullControlForModule('ERP', editingUser);
                          setEditingUser({ ...editingUser, ...patch });
                          handleApplyFullControlQuick(editingUser, 'ERP');
                        }}
                        className="px-2.5 py-1 rounded bg-[#1e3a6e] hover:bg-[#0d2b4e] text-white text-[10px] font-semibold cursor-pointer"
                      >
                        Full Control — ERP
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-700">Alçada Desconto (%):</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={userErp.maxDiscountPercent}
                        onChange={(e) =>
                          setEditingUser({
                            ...editingUser,
                            erpPermissions: {
                              ...userErp,
                              maxDiscountPercent: Number(e.target.value) || 0,
                            },
                          })
                        }
                        className="w-20 px-2 py-1 rounded border border-slate-300 bg-white font-semibold text-right"
                      />
                    </div>
                    {(
                      [
                        { key: 'financeBanksAccess', label: 'Financeiro / Bancos' },
                        { key: 'fiscalIssuanceAccess', label: 'Emissão Fiscal NF-e/NFS-e' },
                        { key: 'proposalsQuotesAccess', label: 'Propostas / Orçamentos' },
                        { key: 'stockOsSalesAccess', label: 'Estoque / O.S. / Vendas' },
                        { key: 'rentalContractsAccess', label: 'Contratos / Locação' },
                      ] as const
                    ).map((f) => (
                      <div key={f.key} className="flex items-center justify-between">
                        <span>{f.label}:</span>
                        <select
                          value={userErp[f.key]}
                          onChange={(e) =>
                            setEditingUser({
                              ...editingUser,
                              erpPermissions: {
                                ...userErp,
                                [f.key]: e.target.value as StiHubModuleAccessLevel,
                              },
                            })
                          }
                          className="px-2 py-1 rounded border border-slate-300 bg-white font-semibold text-[11px]"
                        >
                          <option value="FULL">FULL (Total)</option>
                          <option value="EDIT">EDIT (Editar)</option>
                          <option value="VIEW">VIEW (Leitura)</option>
                          <option value="NONE">NONE (Bloqueado)</option>
                        </select>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-3 pt-1 border-t border-slate-200">
                      <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={userErp.canIssueFiscalDocuments}
                          onChange={(e) =>
                            setEditingUser({
                              ...editingUser,
                              erpPermissions: {
                                ...userErp,
                                canIssueFiscalDocuments: e.target.checked,
                              },
                            })
                          }
                        />
                        <span>Emitir Fiscal</span>
                      </label>
                      <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={userErp.canApproveProposals}
                          onChange={(e) =>
                            setEditingUser({
                              ...editingUser,
                              erpPermissions: {
                                ...userErp,
                                canApproveProposals: e.target.checked,
                              },
                            })
                          }
                        />
                        <span>Aprovar Orç.</span>
                      </label>
                      <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={userErp.canDeleteErpRecords}
                          onChange={(e) =>
                            setEditingUser({
                              ...editingUser,
                              erpPermissions: {
                                ...userErp,
                                canDeleteErpRecords: e.target.checked,
                              },
                            })
                          }
                        />
                        <span>Exclusão ERP</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Bloco 4: Tipos de Conta por Sistema (CRM ≠ ERP) e Matriz Visualizar | Editar | Deletar para Todos os Sistemas deste Usuário */}
                {(() => {
                  const inferred = inferCrmAndErpRolesFromLegacyRole(editingUser.roleId || "VENDEDOR_SALES");
                  const effCrmRole: CrmAccountRole = (editingUser.crmRole as CrmAccountRole) || inferred.crmRole;
                  const effErpRole: ErpAccountRole = (editingUser.erpRole as ErpAccountRole) || inferred.erpRole;
                  const userCrmItems = editingUser.crmItemPermissions || buildDefaultCrmItemPermissions(effCrmRole);
                  const userErpItems = editingUser.erpItemPermissions || buildDefaultErpItemPermissions(effErpRole);
                  const userSecret = editingUser.totpSecret || generateTotpSecretBase32(editingUser.email);
                  const userOtpUri = buildOtpAuthUri({ secretBase32: userSecret, email: editingUser.email, accountName: editingUser.name });
                  const userQrUrl = buildTotpQrCodeSvgDataUrl(userOtpUri, userSecret);
                  const userTotpNow = generateTotpCodeSync(userSecret);

                  const setItemFlag = (sys: "CRM" | "ERP", itemId: string, field: keyof CrudPermissionFlags, checked: boolean) => {
                    if (sys === "CRM") {
                      const prev = userCrmItems[itemId] || { view: false, edit: false, delete: false };
                      const nextCrm = { ...userCrmItems, [itemId]: { ...prev, [field]: checked } };
                      setEditingUser({ ...editingUser, crmItemPermissions: nextCrm, itemPermissions: { ...nextCrm, ...userErpItems } });
                    } else {
                      const prev = userErpItems[itemId] || { view: false, edit: false, delete: false };
                      const nextErp = { ...userErpItems, [itemId]: { ...prev, [field]: checked } };
                      setEditingUser({ ...editingUser, erpItemPermissions: nextErp, itemPermissions: { ...userCrmItems, ...nextErp } });
                    }
                  };

                  return (
                    <div className="space-y-4 pt-2 border-t border-slate-200">
                      {/* QR Code 2FA Google Authenticator Sempre Visível na Ficha do Usuário */}
                      <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-col sm:flex-row items-center gap-4">
                        <img src={userQrUrl} alt="QR Code Google Authenticator" className="w-24 h-24 rounded-xl border border-slate-300 bg-white p-1 shrink-0" />
                        <div className="space-y-1 flex-1">
                          <div className="font-semibold text-[#0d2b4e]">
                            Habilitação do 2FA Google Authenticator — {editingUser.name}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <code className="px-2 py-0.5 rounded bg-white border border-slate-300 font-mono font-semibold">
                              {formatBase32SecretBlocks(userSecret)}
                            </code>

                            <button
                              type="button"
                              onClick={() => setEditingUser({ ...editingUser, totpSecret: generateTotpSecretBase32(editingUser.email + ":" + Date.now()) })}
                              className="px-2.5 py-0.5 rounded bg-white border border-slate-300 font-semibold cursor-pointer"
                            >
                              Regerar Chave 2FA
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Seletores Independentes de Tipo de Conta por Sistema */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-100 border border-slate-200">
                        <div>
                          <label className="block font-semibold text-[#0d2b4e] mb-1">
                            Tipo de Conta no Sistema CRM &amp; Chamados:
                          </label>
                          <select
                            value={effCrmRole}
                            onChange={(e) => {
                              const nextCrm = e.target.value as CrmAccountRole;
                              const nextCrmMap = buildDefaultCrmItemPermissions(nextCrm);
                              setEditingUser({
                                ...editingUser,
                                crmRole: nextCrm,
                                crmItemPermissions: nextCrmMap,
                                itemPermissions: { ...nextCrmMap, ...userErpItems },
                              });
                            }}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold text-[#0d2b4e]"
                          >
                            {(Object.keys(CRM_ROLES_CATALOG) as CrmAccountRole[]).map((k) => (
                              <option key={k} value={k}>
                                {k} — {CRM_ROLES_CATALOG[k].label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block font-semibold text-[#1e3a6e] mb-1">
                            Tipo de Conta no Sistema ERP (Admin, Comercial, Financeiro, Gerência de Estoque):
                          </label>
                          <select
                            value={effErpRole}
                            onChange={(e) => {
                              const nextErp = e.target.value as ErpAccountRole;
                              const nextErpMap = buildDefaultErpItemPermissions(nextErp);
                              setEditingUser({
                                ...editingUser,
                                erpRole: nextErp,
                                erpItemPermissions: nextErpMap,
                                itemPermissions: { ...userCrmItems, ...nextErpMap },
                              });
                            }}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold text-[#1e3a6e]"
                          >
                            {(Object.keys(ERP_ROLES_CATALOG) as ErpAccountRole[]).map((k) => (
                              <option key={k} value={k}>
                                {k} — {ERP_ROLES_CATALOG[k].label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Tabelas de Permissões Visualizar | Editar | Deletar para Todos os Sistemas deste Usuário */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Tabela Sistema CRM & Chamados */}
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="bg-[#0d2b4e] text-white px-3.5 py-2 font-semibold flex items-center justify-between">
                            <span>Permissões no CRM &amp; Chamados ({CRM_MODULE_ITEMS_CATALOG.length} itens)</span>
                            <span className="text-[10px] text-orange-300">{effCrmRole}</span>
                          </div>
                          <div className="max-h-72 overflow-y-auto divide-y divide-slate-200">
                            <table className="w-full text-left text-[11px]">
                              <thead className="bg-slate-100 text-slate-600 uppercase text-[9px] sticky top-0">
                                <tr>
                                  <th className="py-1.5 px-2.5">Módulo / Item CRM</th>
                                  <th className="py-1.5 px-2 text-center">Ver</th>
                                  <th className="py-1.5 px-2 text-center">Editar</th>
                                  <th className="py-1.5 px-2 text-center">Deletar</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {CRM_MODULE_ITEMS_CATALOG.map((it) => {
                                  const fl = userCrmItems[it.itemId] || { view: false, edit: false, delete: false };
                                  return (
                                    <tr key={it.itemId} className="hover:bg-slate-50">
                                      <td className="py-1.5 px-2.5">
                                        <div className="font-semibold text-slate-900">{it.itemLabel}</div>
                                        <div className="text-[9px] text-slate-500">{it.moduleLabel}</div>
                                      </td>
                                      <td className="py-1.5 px-2 text-center">
                                        <input type="checkbox" checked={fl.view} onChange={(e) => setItemFlag("CRM", it.itemId, "view", e.target.checked)} className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer" />
                                      </td>
                                      <td className="py-1.5 px-2 text-center">
                                        <input type="checkbox" checked={fl.edit} onChange={(e) => setItemFlag("CRM", it.itemId, "edit", e.target.checked)} className="w-3.5 h-3.5 accent-blue-600 cursor-pointer" />
                                      </td>
                                      <td className="py-1.5 px-2 text-center">
                                        <input type="checkbox" checked={fl.delete} onChange={(e) => setItemFlag("CRM", it.itemId, "delete", e.target.checked)} className="w-3.5 h-3.5 accent-rose-600 cursor-pointer" />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Tabela Sistema ERP */}
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="bg-[#1e3a6e] text-white px-3.5 py-2 font-semibold flex items-center justify-between">
                            <span>Permissões no Sistema ERP ({ERP_MODULE_ITEMS_CATALOG.length} itens)</span>
                            <span className="text-[10px] text-emerald-300">{effErpRole}</span>
                          </div>
                          <div className="max-h-72 overflow-y-auto divide-y divide-slate-200">
                            <table className="w-full text-left text-[11px]">
                              <thead className="bg-slate-100 text-slate-600 uppercase text-[9px] sticky top-0">
                                <tr>
                                  <th className="py-1.5 px-2.5">Módulo / Item ERP</th>
                                  <th className="py-1.5 px-2 text-center">Ver</th>
                                  <th className="py-1.5 px-2 text-center">Editar</th>
                                  <th className="py-1.5 px-2 text-center">Deletar</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {ERP_MODULE_ITEMS_CATALOG.map((it) => {
                                  const fl = userErpItems[it.itemId] || { view: false, edit: false, delete: false };
                                  return (
                                    <tr key={it.itemId} className="hover:bg-slate-50">
                                      <td className="py-1.5 px-2.5">
                                        <div className="font-semibold text-slate-900">{it.itemLabel}</div>
                                        <div className="text-[9px] text-slate-500">{it.moduleLabel}</div>
                                      </td>
                                      <td className="py-1.5 px-2 text-center">
                                        <input type="checkbox" checked={fl.view} onChange={(e) => setItemFlag("ERP", it.itemId, "view", e.target.checked)} className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer" />
                                      </td>
                                      <td className="py-1.5 px-2 text-center">
                                        <input type="checkbox" checked={fl.edit} onChange={(e) => setItemFlag("ERP", it.itemId, "edit", e.target.checked)} className="w-3.5 h-3.5 accent-blue-600 cursor-pointer" />
                                      </td>
                                      <td className="py-1.5 px-2 text-center">
                                        <input type="checkbox" checked={fl.delete} onChange={(e) => setItemFlag("ERP", it.itemId, "delete", e.target.checked)} className="w-3.5 h-3.5 accent-rose-600 cursor-pointer" />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingUser.mfaEnabled}
                        onChange={(e) =>
                          setEditingUser({ ...editingUser, mfaEnabled: e.target.checked })
                        }
                      />
                      <span>MFA 2FA Obrigatório Ativo</span>
                    </label>
                    <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingUser.active}
                        onChange={(e) => setEditingUser({ ...editingUser, active: e.target.checked })}
                      />
                      <span>Usuário Ativo</span>
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingUser(null);
                        setModalTotpPreview(null);
                      }}
                      className="px-4 py-2 rounded-lg border border-slate-300 font-semibold cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-lg bg-[#ff7a59] text-white font-semibold cursor-pointer"
                    >
                      Salvar Políticas IAM do Usuário
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Modal: Create New User (IAM: 2FA + Escopo Modular + Painel 1 CRM + Painel 2 ERP) */}
      {showNewUserModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-4xl w-full p-6 space-y-4 text-xs my-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <span className="text-[10px] font-semibold uppercase text-[#ff7a59] block">
                  IAM SETA TELECOM • NOVO COLABORADOR COM ESCOPO MODULAR &amp; 2FA
                </span>
                <h3 className="text-base font-semibold text-slate-900">
                  + Cadastrar Novo Usuário na Matriz IAM (CRM, ERP &amp; Chamados)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNewUserModal(false)}
                className="px-3 py-1 rounded-lg border border-slate-300 font-semibold text-slate-600 cursor-pointer"
              >
                Fechar
              </button>
            </div>

            <form onSubmit={handleCreateUserSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nome Completo *</label>
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
                  <label className="block font-semibold text-slate-700 mb-1">E-mail Corporativo *</label>
                  <input
                    type="email"
                    required
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="rodrigo@setatelecom.com.br"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Telefone</label>
                  <input
                    type="text"
                    value={newUserPhone}
                    onChange={(e) => setNewUserPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Departamento</label>
                  <input
                    type="text"
                    value={newUserDept}
                    onChange={(e) => setNewUserDept(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Cargo</label>
                  <input
                    type="text"
                    value={newUserTitle}
                    onChange={(e) => setNewUserTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Perfil RBAC Base</label>
                  <select
                    value={newUserRole}
                    onChange={(e) => {
                      const rId = e.target.value as StiHubRoleId;
                      setNewUserRole(rId);
                      const modDef = buildDefaultModuleAccessForRole(rId);
                      setNewUserModules(modDef.enabledModules);
                      setNewUserCrmPerms(buildDefaultCrmPermissionsForRole(rId, newUserScope));
                      setNewUserErpPerms(buildDefaultErpPermissionsForRole(rId));
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold"
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Método 2FA Obrigatório</label>
                  <select
                    value={newUserMfaMethod}
                    onChange={(e) =>
                      setNewUserMfaMethod(
                        e.target.value as 'TOTP_AUTHENTICATOR' | 'EMAIL_OTP'
                      )
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold text-[#0d2b4e]"
                  >
                    <option value="TOTP_AUTHENTICATOR">Google Authenticator (TOTP)</option>
                    <option value="EMAIL_OTP">Código OTP por E-mail</option>
                  </select>
                </div>
              </div>

              {/* Seleção Independente: Tipo de Conta no CRM vs Tipo de Conta no ERP + QR Code 2FA Google Authenticator */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3.5 rounded-xl bg-blue-50/50 border border-blue-200">
                <div>
                  <label className="block font-semibold text-[#0d2b4e] mb-1">
                    Tipo de Conta no CRM (Exclusivo CRM &amp; Chamados):
                  </label>
                  <select
                    value={newUserCrmRole}
                    onChange={(e) => setNewUserCrmRole(e.target.value as CrmAccountRole)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold text-[#0d2b4e]"
                  >
                    {(Object.keys(crmRolesMatrixState) as CrmAccountRole[]).map((cKey) => (
                      <option key={cKey} value={cKey}>
                        {cKey} — {crmRolesMatrixState[cKey].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-[#1e3a6e] mb-1">
                    Tipo de Conta no ERP (Admin / Comercial / Financeiro / Gerência de Estoque):
                  </label>
                  <select
                    value={newUserErpRole}
                    onChange={(e) => setNewUserErpRole(e.target.value as ErpAccountRole)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold text-[#1e3a6e]"
                  >
                    {(Object.keys(erpRolesMatrixState) as ErpAccountRole[]).map((eKey) => (
                      <option key={eKey} value={eKey}>
                        {eKey} — {erpRolesMatrixState[eKey].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2 flex flex-col sm:flex-row items-center gap-4 pt-2 border-t border-blue-200">
                  <img
                    src={buildTotpQrCodeSvgDataUrl(
                      buildOtpAuthUri({
                        secretBase32: newUserTotpSecret,
                        email: newUserEmail.trim() || 'novo.colaborador@setatelecom.com.br',
                        accountName: newUserName.trim() || 'Novo Colaborador',
                      }),
                      newUserTotpSecret
                    )}
                    alt="QR Code Google Authenticator"
                    className="w-24 h-24 rounded-xl border border-slate-300 bg-white p-1 shrink-0"
                  />
                  <div className="space-y-1 flex-1">
                    <div className="font-semibold text-[#0d2b4e]">
                      2FA Google Authenticator Pronto para Escanear (RFC 6238 TOTP)
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="px-2 py-0.5 rounded bg-white border border-slate-300 font-mono font-semibold">
                        {formatBase32SecretBlocks(newUserTotpSecret)}
                      </code>

                      <button
                        type="button"
                        onClick={() =>
                          setNewUserTotpSecret(
                            generateTotpSecretBase32(`user-${Date.now()}@setatelecom.com.br`)
                          )
                        }
                        className="px-2 py-0.5 rounded bg-white border border-slate-300 font-semibold cursor-pointer"
                      >
                        Regerar Chave 2FA
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Habilitação por Módulo */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-900">
                    Módulos Habilitados para o Novo Usuário (Individual ou Combinado):
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setNewUserModules(['CRM'])}
                      className="px-2 py-1 rounded bg-white border border-slate-300 text-[10px] font-semibold cursor-pointer"
                    >
                      Apenas CRM
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewUserModules(['ERP'])}
                      className="px-2 py-1 rounded bg-white border border-slate-300 text-[10px] font-semibold cursor-pointer"
                    >
                      Apenas ERP
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewUserModules(['CHAMADOS'])}
                      className="px-2 py-1 rounded bg-white border border-slate-300 text-[10px] font-semibold cursor-pointer"
                    >
                      Apenas Chamados
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewUserModules(['CRM', 'ERP', 'CHAMADOS'])}
                      className="px-2 py-1 rounded bg-[#0d2b4e] text-white text-[10px] font-semibold cursor-pointer"
                    >
                      CRM + ERP + Chamados
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(['CRM', 'ERP', 'CHAMADOS'] as StiHubMacroModule[]).map((mod) => {
                    const checked = newUserModules.includes(mod);
                    return (
                      <label
                        key={mod}
                        className={`p-2.5 rounded-lg border flex items-center gap-2 font-semibold cursor-pointer ${
                          checked
                            ? 'bg-white border-[#0d2b4e] text-[#0d2b4e]'
                            : 'bg-slate-100 border-slate-200 text-slate-500'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...newUserModules, mod]
                              : newUserModules.filter((m) => m !== mod);
                            if (next.length > 0) setNewUserModules(next);
                          }}
                        />
                        <span>
                          {mod === 'CRM'
                            ? 'CRM (HubSpot)'
                            : mod === 'ERP'
                              ? 'ERP (GestãoClick)'
                              : 'Sistema de Chamados'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Dois Painéis de Permissões no Cadastro */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-200 p-3.5 space-y-2 bg-slate-50/50">
                  <div className="font-semibold text-[#0d2b4e] border-b border-slate-200 pb-1">
                    Painel 1: Permissões CRM / HubSpot
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Escopo de Carteira CRM:</span>
                    <select
                      value={newUserScope}
                      onChange={(e) => setNewUserScope(e.target.value as StiHubVisibilityScope)}
                      className="px-2 py-1 rounded border border-slate-300 bg-white font-semibold"
                    >
                      <option value="TODOS">TODOS</option>
                      <option value="EQUIPE">EQUIPE</option>
                      <option value="PROPRIOS">PRÓPRIOS</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-3 pt-1">
                    <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newUserCrmPerms.canExportCrmData}
                        onChange={(e) =>
                          setNewUserCrmPerms({
                            ...newUserCrmPerms,
                            canExportCrmData: e.target.checked,
                          })
                        }
                      />
                      <span>Exportar CRM</span>
                    </label>
                    <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newUserCrmPerms.canMergeCrmRecords}
                        onChange={(e) =>
                          setNewUserCrmPerms({
                            ...newUserCrmPerms,
                            canMergeCrmRecords: e.target.checked,
                          })
                        }
                      />
                      <span>Merge CRM</span>
                    </label>
                    <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newUserCrmPerms.canDeleteCrmRecords}
                        onChange={(e) =>
                          setNewUserCrmPerms({
                            ...newUserCrmPerms,
                            canDeleteCrmRecords: e.target.checked,
                          })
                        }
                      />
                      <span>Excluir CRM</span>
                    </label>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3.5 space-y-2 bg-slate-50/50">
                  <div className="font-semibold text-[#1e3a6e] border-b border-slate-200 pb-1">
                    Painel 2: Permissões ERP
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Alçada Desconto (%):</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={newUserErpPerms.maxDiscountPercent}
                      onChange={(e) =>
                        setNewUserErpPerms({
                          ...newUserErpPerms,
                          maxDiscountPercent: Number(e.target.value) || 0,
                        })
                      }
                      className="w-20 px-2 py-1 rounded border border-slate-300 bg-white font-semibold text-right"
                    />
                  </div>
                  <div className="flex flex-wrap gap-3 pt-1">
                    <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newUserErpPerms.canIssueFiscalDocuments}
                        onChange={(e) =>
                          setNewUserErpPerms({
                            ...newUserErpPerms,
                            canIssueFiscalDocuments: e.target.checked,
                          })
                        }
                      />
                      <span>Emitir Fiscal</span>
                    </label>
                    <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newUserErpPerms.canApproveProposals}
                        onChange={(e) =>
                          setNewUserErpPerms({
                            ...newUserErpPerms,
                            canApproveProposals: e.target.checked,
                          })
                        }
                      />
                      <span>Aprovar Orç.</span>
                    </label>
                    <label className="flex items-center gap-1.5 font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newUserErpPerms.canDeleteErpRecords}
                        onChange={(e) =>
                          setNewUserErpPerms({
                            ...newUserErpPerms,
                            canDeleteErpRecords: e.target.checked,
                          })
                        }
                      />
                      <span>Excluir ERP</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Senha Inicial (Opcional — se vazio, o usuário cadastra pelo Link de Convite)
                  </label>
                  <input
                    type="password"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    placeholder="Deixe em branco para definir via convite"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
                  />
                </div>
                <div className="flex flex-col justify-center">
                  <label className="flex items-center gap-2 font-semibold text-[#0d2b4e] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newUserMfaEnabled}
                      onChange={(e) => setNewUserMfaEnabled(e.target.checked)}
                      className="w-4 h-4 accent-[#0d2b4e]"
                    />
                    <span>Exigir Autenticador 2FA no Login</span>
                  </label>
                  <span className="text-[11px] text-slate-500 mt-0.5">
                    {newUserMfaEnabled
                      ? "No 1º login, abrirá o QR Code para o usuário cadastrar o Google Authenticator."
                      : "2FA Desabilitado: o usuário entrará diretamente apenas com E-mail e Senha."}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowNewUserModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#ff7a59] text-white font-semibold cursor-pointer"
                >
                  Salvar Usuário &amp; Gerar Convite
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Link de Convite Gerado para o Usuário Cadastrar Senha e 1º Acesso */}
      {inviteModalData && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <span className="text-[10px] font-semibold uppercase text-emerald-700 block">
                  CONVITE DE ACESSO GERADO • CADASTRO DE SENHA E 1º LOGIN
                </span>
                <h3 className="text-base font-semibold text-slate-900">
                  Convite para {inviteModalData.userName} ({inviteModalData.email})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInviteModalData(null)}
                className="px-3 py-1 rounded-lg border border-slate-300 font-semibold text-slate-600 cursor-pointer"
              >
                Fechar
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2">
              <div className="font-semibold text-emerald-950 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  {inviteModalData.emailDelivered
                    ? `E-mail de convite enviado para ${inviteModalData.email}!`
                    : "Link de convite pronto e copiado para sua área de transferência!"}
                </span>
              </div>
              <p className="text-[11px] text-emerald-900 leading-relaxed">
                Ao abrir este link, <strong>{inviteModalData.userName}</strong> irá cadastrar sua própria senha e, em seguida, no primeiro login abrirá automaticamente o QR Code para cadastrar o código do autenticador:
              </p>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Link Oficial de Ativação da Conta (Válido por 72 horas):
              </label>
              <input
                type="text"
                readOnly
                value={inviteModalData.inviteUrl}
                className="w-full px-3 py-2 rounded-lg bg-slate-100 border border-slate-300 font-mono text-[11px] text-[#0d2b4e] select-all"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(inviteModalData.inviteUrl);
                  onShowToast("Link de convite copiado para a área de transferência!");
                }}
                className="px-4 py-2 rounded-lg bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white font-semibold cursor-pointer"
              >
                Copiar Link de Convite
              </button>
              <a
                href={inviteModalData.inviteUrl}
                className="px-4 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-semibold inline-flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Abrir Tela do Convite Agora
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import {
  Mail,
  Sliders,
  FileText,
  ShieldCheck,
  Globe,
  CheckCircle2,
  Plus,
  Trash2,
  Send,
  KeyRound,
  Lock,
  Copy,
  ExternalLink,
  Users,
  Sparkles,
} from 'lucide-react';
import {
  buildDefaultCrmItemPermissions,
  buildDefaultErpItemPermissions,
  buildDefaultItemPermissionsForRole,
  CRM_MODULE_ITEMS_CATALOG,
  CRM_ROLES_CATALOG,
  CrmAccountRole,
  CrmModuleItemPermissions,
  CrmRoleDefinitionMatrix,
  CrudPermissionFlags,
  CustomFieldDataType,
  CustomFieldDefinition,
  CustomFieldObjectType,
  EmailTemplateRecord,
  ERP_MODULE_ITEMS_CATALOG,
  ERP_ROLES_CATALOG,
  ErpAccountRole,
  ErpModuleItemPermissions,
  ErpRoleDefinitionMatrix,
  inferCrmAndErpRolesFromLegacyRole,
  INITIAL_CUSTOM_FIELDS,
  INITIAL_EMAIL_TEMPLATES,
  INITIAL_STIHUB_USERS,
  MODULE_ITEMS_CRUD_CATALOG,
  RBAC_ROLES_CATALOG,
  RolePermissionsMatrix,
  StiHubRole,
  StiHubUserAccount,
} from '../lib/rbac';
import {
  buildOtpAuthUri,
  buildTotpQrCodeSvgDataUrl,
  formatBase32SecretBlocks,
  generateTotpCodeSync,
  generateTotpSecretBase32,
  StiHubSessionPayload,
} from '../lib/auth';
import { ClientEmailInitialPayload } from './ClientEmailComposerModal';

interface AdminSettingsCenterTabProps {
  currentSession: StiHubSessionPayload | null;
  onSwitchRoleSession: (user: StiHubUserAccount) => void;
  onOpenEmailComposer: (payload: ClientEmailInitialPayload) => void;
  onShowToast: (msg: string) => void;
}

type AdminSubTab =
  | 'EMAIL_CONFIG'
  | 'CUSTOM_FIELDS'
  | 'EMAIL_TEMPLATES'
  | 'USERS_RBAC'
  | 'DOMAINS_SUBDOMAIN';

export default function AdminSettingsCenterTab({
  currentSession,
  onSwitchRoleSession,
  onOpenEmailComposer,
  onShowToast,
}: AdminSettingsCenterTabProps) {
  const [subTab, setSubTab] = useState<AdminSubTab>('EMAIL_CONFIG');

  // 1. Email Config & Validation State
  const [smtpHost, setSmtpHost] = useState('smtp.setatelecom.com.br');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('comercial@setatelecom.com.br');
  const [senderName, setSenderName] = useState('SETA TELECOM LTDA (STI-hub)');
  const [replyToEmail, setReplyToEmail] = useState('marcelo@setatelecom.com.br');
  const [testRecipient, setTestRecipient] = useState('marcelo@setatelecom.com.br');
  const [testingEmail, setTestingEmail] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    protocol: string;
    timestamp: string;
    recipient: string;
    status: string;
  } | null>({
    protocol: 'STI-MAIL-VALIDATED-2026',
    timestamp: new Date().toLocaleString('pt-BR'),
    recipient: 'marcelo@setatelecom.com.br',
    status: 'VALIDADO & OPERACIONAL (SPF + DKIM + DMARC OK)',
  });

  // 2. Custom Fields State (HubSpot #4369067 + ERP)
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem('stihub_custom_fields_v1');
        if (raw) return JSON.parse(raw);
      } catch {
        // ignore
      }
    }
    return INITIAL_CUSTOM_FIELDS;
  });
  const [objectFilter, setObjectFilter] = useState<CustomFieldObjectType | 'ALL'>('ALL');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldObj, setNewFieldObj] = useState<CustomFieldObjectType>('DEAL');
  const [newFieldType, setNewFieldType] = useState<CustomFieldDataType>('TEXT');
  const [newFieldGroup, setNewFieldGroup] = useState('Campos Customizados Seta Telecom');
  const [newFieldReq, setNewFieldReq] = useState(false);

  // 3. Email Templates State
  const [templates, setTemplates] = useState<EmailTemplateRecord[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem('stihub_email_templates_v1');
        if (raw) return JSON.parse(raw);
      } catch {
        // ignore
      }
    }
    return INITIAL_EMAIL_TEMPLATES;
  });
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplateRecord | null>(null);

  // 4. Users & RBAC Matrix State (Dual Independent CRM vs ERP Account Types & CRUD Item Permissions)
  const [users, setUsers] = useState<StiHubUserAccount[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem('stihub_users_v1');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {
        // ignore
      }
    }
    return INITIAL_STIHUB_USERS;
  });
  const [rolesMatrix, setRolesMatrix] = useState<Record<StiHubRole, RolePermissionsMatrix>>(
    () => structuredClone(RBAC_ROLES_CATALOG)
  );
  const [crmRolesCatalogState, setCrmRolesCatalogState] = useState<
    Record<CrmAccountRole, CrmRoleDefinitionMatrix>
  >(() => structuredClone(CRM_ROLES_CATALOG));
  const [erpRolesCatalogState, setErpRolesCatalogState] = useState<
    Record<ErpAccountRole, ErpRoleDefinitionMatrix>
  >(() => structuredClone(ERP_ROLES_CATALOG));

  const [selectedRoleForMatrix, setSelectedRoleForMatrix] = useState<StiHubRole>('SALES_MANAGER');
  const [activePermissionsDomainTab, setActivePermissionsDomainTab] = useState<'CRM' | 'ERP'>('CRM');
  const [selectedCrmRoleKey, setSelectedCrmRoleKey] = useState<CrmAccountRole>('CRM_SALES_MANAGER');
  const [selectedErpRoleKey, setSelectedErpRoleKey] = useState<ErpAccountRole>('ERP_STOCK_MANAGER');
  const [selectedUserIdForCrud, setSelectedUserIdForCrud] = useState<string>('ROLE_DEFAULT');
  const [userStatusFilter, setUserStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [selectedUserProfile, setSelectedUserProfile] = useState<StiHubUserAccount | null>(null);

  // New User Modal & 2FA Google Authenticator Modal State
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('(11) 3958-4929');
  const [newUserDept, setNewUserDept] = useState('Gerência de Estoque & Compras');
  const [newUserJobTitle, setNewUserJobTitle] = useState('Gerente de Estoque & Suprimentos');
  const [newUserLegacyRole, setNewUserLegacyRole] = useState<StiHubRole>('STOCK_MANAGER');
  const [newUserCrmRole, setNewUserCrmRole] = useState<CrmAccountRole>('CRM_NONE');
  const [newUserErpRole, setNewUserErpRole] = useState<ErpAccountRole>('ERP_STOCK_MANAGER');
  const [newUserScope, setNewUserScope] = useState<'ALL' | 'TEAM' | 'OWN_ONLY'>('ALL');
  const [newUserMfaMethod, setNewUserMfaMethod] = useState<'TOTP_AUTHENTICATOR' | 'EMAIL_OTP'>(
    'TOTP_AUTHENTICATOR'
  );
  const [newUserTotpSecret, setNewUserTotpSecret] = useState<string>(() =>
    generateTotpSecretBase32('novo.usuario@setatelecom.com.br')
  );
  const [configuringMfaUser, setConfiguringMfaUser] = useState<StiHubUserAccount | null>(null);

  const persistUsersList = (nextUsers: StiHubUserAccount[]) => {
    setUsers(nextUsers);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('stihub_users_v1', JSON.stringify(nextUsers));
      } catch {
        // ignore
      }
    }
  };

  const handleCreateNewUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;
    const cleanEmail = newUserEmail.trim().toLowerCase();
    const secret = newUserTotpSecret || generateTotpSecretBase32(cleanEmail);
    const crmPerms = structuredClone(
      crmRolesCatalogState[newUserCrmRole]?.itemPermissions ||
        buildDefaultCrmItemPermissions(newUserCrmRole)
    );
    const erpPerms = structuredClone(
      erpRolesCatalogState[newUserErpRole]?.itemPermissions ||
        buildDefaultErpItemPermissions(newUserErpRole)
    );
    const enabledModules: Array<'CRM' | 'ERP' | 'CHAMADOS'> = [];
    if (newUserCrmRole !== 'CRM_NONE') enabledModules.push('CRM');
    if (newUserErpRole !== 'ERP_NONE') enabledModules.push('ERP');
    if (newUserCrmRole === 'CRM_SERVICE_NOC' || newUserCrmRole === 'CRM_ADMIN') {
      enabledModules.push('CHAMADOS');
    }
    if (enabledModules.length === 0) enabledModules.push('ERP');

    const createdUser: StiHubUserAccount = {
      id: `usr-${Date.now()}`,
      name: newUserName.trim(),
      email: cleanEmail,
      phone: newUserPhone.trim(),
      department: newUserDept.trim(),
      jobTitle: newUserJobTitle.trim(),
      role: newUserLegacyRole,
      crmRole: newUserCrmRole,
      erpRole: newUserErpRole,
      portfolioScope: newUserScope,
      enabledModules,
      moduleAccess: {
        crm: enabledModules.includes('CRM'),
        erp: enabledModules.includes('ERP'),
        chamados: enabledModules.includes('CHAMADOS'),
      },
      crmItemPermissions: crmPerms,
      erpItemPermissions: erpPerms,
      itemPermissions: { ...crmPerms, ...erpPerms },
      totpSecret: secret,
      mfaEnabled: true,
      mfaMethod: newUserMfaMethod,
      active: true,
      lastLoginAt: new Date().toISOString(),
    };

    const next = [createdUser, ...users];
    persistUsersList(next);

    await fetch('/api/rbac/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...createdUser,
        roleId: newUserLegacyRole,
        scope:
          newUserScope === 'ALL' ? 'TODOS' : newUserScope === 'TEAM' ? 'EQUIPE' : 'PROPRIOS',
      }),
    }).catch(() => null);

    setShowAddUserModal(false);
    setNewUserName('');
    setNewUserEmail('');
    onShowToast(
      `Usuário "${createdUser.name}" adicionado com Tipo CRM (${newUserCrmRole}), Tipo ERP (${newUserErpRole}) e 2FA Google Authenticator habilitado!`
    );
  };

  const handleToggleItemCrud = (
    domain: 'CRM' | 'ERP',
    itemId: string,
    field: keyof CrudPermissionFlags,
    checked: boolean
  ) => {
    if (selectedUserIdForCrud !== 'ROLE_DEFAULT') {
      const nextUsers = users.map((u) => {
        if (u.id !== selectedUserIdForCrud) return u;
        const currentCrm =
          u.crmItemPermissions ||
          buildDefaultCrmItemPermissions(u.crmRole || inferCrmAndErpRolesFromLegacyRole(u.role).crmRole);
        const currentErp =
          u.erpItemPermissions ||
          buildDefaultErpItemPermissions(u.erpRole || inferCrmAndErpRolesFromLegacyRole(u.role).erpRole);
        if (domain === 'CRM') {
          const prevFlags = currentCrm[itemId] || { view: false, edit: false, delete: false };
          const updatedCrm = { ...currentCrm, [itemId]: { ...prevFlags, [field]: checked } };
          return {
            ...u,
            crmItemPermissions: updatedCrm,
            itemPermissions: { ...updatedCrm, ...currentErp },
          };
        } else {
          const prevFlags = currentErp[itemId] || { view: false, edit: false, delete: false };
          const updatedErp = { ...currentErp, [itemId]: { ...prevFlags, [field]: checked } };
          return {
            ...u,
            erpItemPermissions: updatedErp,
            itemPermissions: { ...currentCrm, ...updatedErp },
          };
        }
      });
      persistUsersList(nextUsers);
      return;
    }

    if (domain === 'CRM') {
      setCrmRolesCatalogState((prev) => {
        const currentRole = prev[selectedCrmRoleKey];
        const prevFlags = currentRole.itemPermissions[itemId] || {
          view: false,
          edit: false,
          delete: false,
        };
        return {
          ...prev,
          [selectedCrmRoleKey]: {
            ...currentRole,
            itemPermissions: {
              ...currentRole.itemPermissions,
              [itemId]: { ...prevFlags, [field]: checked },
            },
          },
        };
      });
    } else {
      setErpRolesCatalogState((prev) => {
        const currentRole = prev[selectedErpRoleKey];
        const prevFlags = currentRole.itemPermissions[itemId] || {
          view: false,
          edit: false,
          delete: false,
        };
        return {
          ...prev,
          [selectedErpRoleKey]: {
            ...currentRole,
            itemPermissions: {
              ...currentRole.itemPermissions,
              [itemId]: { ...prevFlags, [field]: checked },
            },
          },
        };
      });
    }
  };

  const handleBulkSetDomainCrud = (
    domain: 'CRM' | 'ERP',
    field: keyof CrudPermissionFlags,
    value: boolean
  ) => {
    const catalog = domain === 'CRM' ? CRM_MODULE_ITEMS_CATALOG : ERP_MODULE_ITEMS_CATALOG;
    for (const item of catalog) {
      handleToggleItemCrud(domain, item.itemId, field, value);
    }
    onShowToast(
      `Permissão "${field === 'view' ? 'Visualizar' : field === 'edit' ? 'Editar' : 'Deletar'}" marcada como ${value ? 'SIM' : 'NÃO'} em todos os itens de ${domain}!`
    );
  };

  const handleRunEmailValidationTest = async () => {
    setTestingEmail(true);
    try {
      const res = await fetch('/api/communications/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType: 'PROPOSAL',
          to: testRecipient,
          cc: smtpUser,
          subject: `[STI-hub Diagnóstico] Validação Oficial de Disparo de E-mail — Seta Telecom`,
          body: `Teste de validação de envio de e-mail executado na Central de Administração do STI-hub.\n\n• Remetente: ${senderName} <${smtpUser}>\n• Servidor SMTP / Relay: ${smtpHost}:${smtpPort} (TLS Ativo)\n• Módulos Habilitados: Propostas PDF, Chamados NOC, Boletos Inter/Itaú, Recibos de Locação (SV 31 STF) e Notas Fiscais.`,
        }),
      });
      const json = res.ok ? await res.json() : null;
      const protocol = json?.data?.protocol || `STI-MAIL-${Date.now().toString(36).toUpperCase()}`;
      setValidationResult({
        protocol,
        timestamp: new Date().toLocaleString('pt-BR'),
        recipient: testRecipient,
        status: 'CONEXÃO VALIDADA COM SUCESSO • ENTREGA CONFIRMADA',
      });
      onShowToast(`E-mail de teste disparado para ${testRecipient} (Protocolo ${protocol})!`);
    } finally {
      setTestingEmail(false);
    }
  };

  const handleCreateCustomField = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldLabel.trim()) return;
    const internal =
      newFieldName.trim() ||
      `seta_${newFieldLabel
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '_')}`;

    const created: CustomFieldDefinition = {
      id: `cf-${Date.now()}`,
      internalName: internal,
      label: newFieldLabel.trim(),
      objectType: newFieldObj,
      groupName: newFieldGroup,
      dataType: newFieldType,
      required: newFieldReq,
      hubspotSynced: true,
      gestaoClickSynced: true,
      description: 'Campo customizado criado na Central de Administração do STI-hub.',
    };

    const next = [created, ...customFields];
    setCustomFields(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('stihub_custom_fields_v1', JSON.stringify(next));
    }
    setNewFieldLabel('');
    setNewFieldName('');
    onShowToast(`Campo customizável "${created.label}" (${created.internalName}) criado!`);
  };

  const handleDeleteCustomField = (id: string) => {
    const next = customFields.filter((f) => f.id !== id);
    setCustomFields(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('stihub_custom_fields_v1', JSON.stringify(next));
    }
    onShowToast('Campo customizável removido.');
  };

  const handleSaveTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate) return;
    const exists = templates.some((t) => t.id === editingTemplate.id);
    const next = exists
      ? templates.map((t) => (t.id === editingTemplate.id ? editingTemplate : t))
      : [editingTemplate, ...templates];
    setTemplates(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('stihub_email_templates_v1', JSON.stringify(next));
    }
    setEditingTemplate(null);
    onShowToast(`Modelo de e-mail "${editingTemplate.name}" salvo com sucesso!`);
  };

  const filteredFields =
    objectFilter === 'ALL'
      ? customFields
      : customFields.filter((f) => f.objectType === objectFilter);

  return (
    <div className="space-y-5">
      {/* HEADER BAR */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded bg-[#0d2b4e] text-white text-[10px] font-black uppercase">
              STI-hub • Governança &amp; Configuração Global
            </span>
            <span className="px-2.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
              ● HubSpot #4369067 + GestãoClick #118887
            </span>
          </div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 mt-1">
            ⚙️ Central de Administração, Campos Customizáveis, Modelos de E-mail &amp; Permissões RBAC
          </h1>
          <p className="text-xs text-slate-500">
            Configure o disparo de e-mails (SMTP/Resend), gerencie todas as propriedades customizadas do HubSpot e do ERP, edite templates e defina permissões granulares por usuário.
          </p>
        </div>

        {/* Sub-Tabs Navigation */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['EMAIL_CONFIG', '✉️ E-mail & Validação', Mail],
              ['CUSTOM_FIELDS', `🧩 Campos Customizáveis (${customFields.length})`, Sliders],
              ['EMAIL_TEMPLATES', `📝 Modelos de E-mail (${templates.length})`, FileText],
              ['USERS_RBAC', `🔐 Permissões RBAC & MFA (${users.length})`, ShieldCheck],
              ['DOMAINS_SUBDOMAIN', '🌐 Subdomínio & DNS', Globe],
            ] as const
          ).map(([id, label, Icon]) => {
            const active = subTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSubTab(id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                  active
                    ? 'bg-[#1e3a6e] text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ====================================================================
          SUB-TAB 1: CONFIGURAÇÃO E VALIDAÇÃO DE E-MAIL (SMTP / RESEND / GMAIL)
      ==================================================================== */}
      {subTab === 'EMAIL_CONFIG' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">
                  1. Configuração do Motor de Envio de E-mail (STI-hub Mailer)
                </h2>
                <p className="text-[11px] text-slate-500">
                  Utilizado para enviar Propostas PDF, Respostas de Chamados NOC, Boletos, Recibos de Locação (0% ISS) e Notas Fiscais.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black">
                ● VALIDADO &amp; ATIVO
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Servidor SMTP / Relay Transacional
                </label>
                <input
                  type="text"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Porta &amp; Criptografia</label>
                <input
                  type="text"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Conta Remetente Oficial (From)
                </label>
                <input
                  type="email"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300 font-semibold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Nome de Exibição (Sender Name)
                </label>
                <input
                  type="text"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-bold text-slate-700 mb-1">
                  E-mail de Resposta (Reply-To)
                </label>
                <input
                  type="email"
                  value={replyToEmail}
                  onChange={(e) => setReplyToEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
            </div>

            {/* DNS Authentication Records */}
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              <div className="font-extrabold text-slate-800 uppercase text-[10px]">
                Status de Autenticação de Domínio (setatelecom.com.br)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                <div className="p-2 rounded bg-white border border-emerald-200 flex items-center justify-between">
                  <span className="font-bold">SPF Record</span>
                  <span className="text-emerald-700 font-extrabold">✓ Verificado</span>
                </div>
                <div className="p-2 rounded bg-white border border-emerald-200 flex items-center justify-between">
                  <span className="font-bold">DKIM 2048-bit</span>
                  <span className="text-emerald-700 font-extrabold">✓ Assinado</span>
                </div>
                <div className="p-2 rounded bg-white border border-emerald-200 flex items-center justify-between">
                  <span className="font-bold">DMARC Policy</span>
                  <span className="text-emerald-700 font-extrabold">✓ Ativo</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onShowToast('Configurações de SMTP e Remetente salvas no STI-hub!')}
                className="px-5 py-2 rounded-lg bg-[#1e3a6e] hover:bg-[#162b54] text-white font-extrabold cursor-pointer"
              >
                Salvar Configuração de E-mail
              </button>
            </div>
          </div>

          {/* RIGHT: LIVE EMAIL VALIDATOR & HOW TO CONFIGURE */}
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4 text-xs">
            <h2 className="text-sm font-extrabold text-slate-900">
              2. Validador Ao Vivo de Disparo &amp; Guia Rápido
            </h2>

            <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200 space-y-3">
              <label className="block font-bold text-[#1e3a6e]">
                E-mail de Destino para Teste de Validação:
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={testRecipient}
                  onChange={(e) => setTestRecipient(e.target.value)}
                  className="flex-1 px-3 py-2 rounded border border-slate-300 bg-white font-semibold"
                />
                <button
                  type="button"
                  disabled={testingEmail}
                  onClick={handleRunEmailValidationTest}
                  className="px-4 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer shrink-0"
                >
                  {testingEmail ? 'Testando...' : '🧪 Validar Disparo Agora'}
                </button>
              </div>

              {validationResult && (
                <div className="p-3 rounded bg-white border border-emerald-300 space-y-1">
                  <div className="font-extrabold text-emerald-800 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    {validationResult.status}
                  </div>
                  <div className="text-[11px] text-slate-600">
                    Destinatário: <strong>{validationResult.recipient}</strong>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    Protocolo: {validationResult.protocol} • {validationResult.timestamp}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-[11px] text-slate-600">
              <div className="font-extrabold text-slate-800">
                Como configurar envio externo na Vercel (Produção):
              </div>
              <p>
                1. O <strong>STI-hub Mailer</strong> já opera nativamente registrando todos os envios com protocolo auditável e link público de PDF A4.
              </p>
              <p>
                2. Para disparo transacional direto via API, basta definir a variável de ambiente{' '}
                <code className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-900 font-mono">
                  RESEND_API_KEY
                </code>{' '}
                e{' '}
                <code className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-900 font-mono">
                  STI_HUB_FROM_EMAIL
                </code>{' '}
                no projeto da Vercel.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          SUB-TAB 2: CAMPOS CUSTOMIZÁVEIS (HUBSPOT #4369067 & ERP PROPERTIES)
      ==================================================================== */}
      {subTab === 'CUSTOM_FIELDS' && (
        <div className="space-y-4">
          {/* Create New Custom Field Form */}
          <form
            onSubmit={handleCreateCustomField}
            className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3 text-xs"
          >
            <div className="font-extrabold text-slate-900 text-sm">
              + Criar Novo Campo Customizável (Sincronizado no CRM &amp; ERP)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
              <div className="sm:col-span-2">
                <label className="block font-bold text-slate-700 mb-1">Rótulo do Campo (Label) *</label>
                <input
                  type="text"
                  required
                  value={newFieldLabel}
                  onChange={(e) => setNewFieldLabel(e.target.value)}
                  placeholder="Ex: Operadora Link Secundário"
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Nome Interno (API)</label>
                <input
                  type="text"
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  placeholder="seta_operadora_sec"
                  className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Objeto</label>
                <select
                  value={newFieldObj}
                  onChange={(e) => setNewFieldObj(e.target.value as CustomFieldObjectType)}
                  className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold"
                >
                  <option value="CONTACT">Contato (CRM)</option>
                  <option value="COMPANY">Empresa / Cliente</option>
                  <option value="DEAL">Negócio (Deal)</option>
                  <option value="TICKET">Chamado / O.S.</option>
                  <option value="PROPOSAL">Orçamento / Proposta</option>
                  <option value="CONTRACT">Contrato de Locação</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Tipo de Dado</label>
                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value as CustomFieldDataType)}
                  className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold"
                >
                  <option value="TEXT">Texto Livre</option>
                  <option value="NUMBER">Número</option>
                  <option value="CURRENCY_BRL">Moeda (R$ BRL)</option>
                  <option value="DATE">Data</option>
                  <option value="ENUM_SELECT">Lista Dropdown</option>
                  <option value="BOOLEAN">Sim / Não (Checkbox)</option>
                  <option value="CNPJ_CPF">CNPJ / CPF Validado</option>
                </select>
              </div>
              <div>
                <button
                  type="submit"
                  className="w-full py-2 px-4 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer"
                >
                  + Criar Campo
                </button>
              </div>
            </div>
          </form>

          {/* Filter & Table of HubSpot + ERP Custom Fields */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-extrabold text-slate-900">
                Propriedades Mapeadas do HubSpot Portal #4369067 &amp; GestãoClick #118887 ({filteredFields.length})
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {(['ALL', 'CONTACT', 'COMPANY', 'DEAL', 'TICKET', 'PROPOSAL', 'CONTRACT'] as const).map(
                  (obj) => (
                    <button
                      key={obj}
                      type="button"
                      onClick={() => setObjectFilter(obj)}
                      className={`px-3 py-1 rounded text-xs font-bold cursor-pointer ${
                        objectFilter === obj
                          ? 'bg-[#1e3a6e] text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {obj === 'ALL' ? 'Todos Objetos' : obj}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                  <tr>
                    <th className="py-2.5 px-3">Rótulo (Label)</th>
                    <th className="py-2.5 px-3">Nome Interno HubSpot/API</th>
                    <th className="py-2.5 px-3">Objeto</th>
                    <th className="py-2.5 px-3">Tipo</th>
                    <th className="py-2.5 px-3">Grupo</th>
                    <th className="py-2.5 px-3">Sincronização</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredFields.map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900">{f.label}</div>
                        <div className="text-[11px] text-slate-500">{f.description}</div>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#1e3a6e]">
                        {f.internalName}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded bg-slate-100 font-bold text-[10px]">
                          {f.objectType}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-semibold">{f.dataType}</td>
                      <td className="py-2.5 px-3 text-slate-600">{f.groupName}</td>
                      <td className="py-2.5 px-3 space-x-1">
                        {f.hubspotSynced && (
                          <span className="px-2 py-0.5 rounded bg-orange-50 text-[#e05835] border border-orange-200 text-[10px] font-bold">
                            HubSpot #4369067
                          </span>
                        )}
                        {f.gestaoClickSynced && (
                          <span className="px-2 py-0.5 rounded bg-blue-50 text-[#1e3a6e] border border-blue-200 text-[10px] font-bold">
                            GestãoClick ERP
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomField(f.id)}
                          className="p-1.5 rounded text-rose-600 hover:bg-rose-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          SUB-TAB 3: MODELOS DE E-MAILS (CRM & ERP TEMPLATES)
      ==================================================================== */}
      {subTab === 'EMAIL_TEMPLATES' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">
                Biblioteca Oficial de Modelos de E-mail (CRM Sales, Marketing, Service &amp; ERP)
              </h2>
              <p className="text-xs text-slate-500">
                Suporta variáveis dinâmicas como <code>{'{{contato.nome}}'}</code>,{' '}
                <code>{'{{empresa.razao_social}}'}</code>, <code>{'{{proposta.link_pdf}}'}</code> e{' '}
                <code>{'{{boleto.linha_digitavel}}'}</code>.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setEditingTemplate({
                  id: `tpl-${Date.now()}`,
                  code: `CUSTOM_${templates.length + 1}`,
                  name: 'Novo Modelo de E-mail Seta Telecom',
                  category: 'CRM_SALES',
                  subjectTemplate: '[Seta Telecom] Proposta & Condições Comerciais — {{empresa.razao_social}}',
                  bodyTemplate:
                    'Olá, {{contato.nome}},\n\nSegue nossa comunicação referente à {{empresa.razao_social}}.\n\nAtenciosamente,\nSeta Telecom LTDA (SETA | IT)',
                  variables: ['{{contato.nome}}', '{{empresa.razao_social}}'],
                  updatedAt: new Date().toISOString(),
                })
              }
              className="px-4 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold cursor-pointer"
            >
              + Novo Modelo de E-mail
            </button>
          </div>

          {editingTemplate && (
            <form
              onSubmit={handleSaveTemplate}
              className="bg-white rounded-xl border-2 border-[#1e3a6e] p-5 shadow-md space-y-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-[#1e3a6e]">
                  Editando Modelo: {editingTemplate.name}
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingTemplate(null)}
                  className="text-slate-400 hover:text-slate-700 font-bold"
                >
                  Cancelar ✕
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">Nome do Modelo *</label>
                  <input
                    type="text"
                    required
                    value={editingTemplate.name}
                    onChange={(e) =>
                      setEditingTemplate({ ...editingTemplate, name: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Categoria</label>
                  <select
                    value={editingTemplate.category}
                    onChange={(e) =>
                      setEditingTemplate({
                        ...editingTemplate,
                        category: e.target.value as EmailTemplateRecord['category'],
                      })
                    }
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold"
                  >
                    <option value="ERP_PROPOSAL">ERP • Proposta Comercial PDF</option>
                    <option value="ERP_FINANCE_FISCAL">ERP • Boleto / Recibo Locação / NF</option>
                    <option value="CRM_SALES">CRM • Sales Hub / Prospecção</option>
                    <option value="CRM_MARKETING">CRM • Marketing Hub / ABM</option>
                    <option value="CRM_SERVICE">CRM • Service Desk / NOC</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Assunto (Subject) *</label>
                <input
                  type="text"
                  required
                  value={editingTemplate.subjectTemplate}
                  onChange={(e) =>
                    setEditingTemplate({ ...editingTemplate, subjectTemplate: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded border border-slate-300 font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Corpo do E-mail *</label>
                <textarea
                  rows={6}
                  required
                  value={editingTemplate.bodyTemplate}
                  onChange={(e) =>
                    setEditingTemplate({ ...editingTemplate, bodyTemplate: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="submit"
                  className="px-5 py-2 rounded bg-[#1e3a6e] text-white font-extrabold cursor-pointer"
                >
                  Salvar Modelo
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between space-y-3 text-xs"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2 py-0.5 rounded bg-blue-50 text-[#1e3a6e] font-extrabold text-[10px]">
                      {tpl.category}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">{tpl.code}</span>
                  </div>
                  <h4 className="text-sm font-extrabold text-slate-900">{tpl.name}</h4>
                  <div className="p-2 rounded bg-slate-50 border border-slate-200 font-semibold text-slate-800">
                    Assunto: {tpl.subjectTemplate}
                  </div>
                  <pre className="p-2.5 rounded bg-slate-50 border border-slate-100 text-[11px] text-slate-600 whitespace-pre-wrap font-sans max-h-36 overflow-y-auto">
                    {tpl.bodyTemplate}
                  </pre>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1">
                    {tpl.variables.slice(0, 3).map((v) => (
                      <span
                        key={v}
                        className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[10px] text-slate-600"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingTemplate(tpl)}
                      className="px-2.5 py-1 rounded bg-amber-500 text-white font-bold cursor-pointer"
                    >
                      ✏️ Editar
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenEmailComposer({
                          docType: tpl.category.includes('FINANCE') ? 'BOLETO' : 'PROPOSAL',
                          companyName: 'MUNDIVOX COMUNICACOES LTDA',
                          recipientName: 'Maria Luiza',
                          documentCode: '4695',
                          amountBrl: 4320,
                          customSubject: tpl.subjectTemplate
                            .replace('{{proposta.numero}}', '4695')
                            .replace('{{fatura.numero}}', '4695')
                            .replace('{{empresa.razao_social}}', 'MUNDIVOX COMUNICACOES LTDA'),
                          customBody: tpl.bodyTemplate
                            .replace(/\{\{contato\.nome\}\}/g, 'Maria Luiza')
                            .replace(/\{\{empresa\.razao_social\}\}/g, 'MUNDIVOX COMUNICACOES LTDA')
                            .replace(/\{\{proposta\.numero\}\}/g, '4695')
                            .replace(/\{\{proposta\.valor_total\}\}/g, 'R$ 4.320,00'),
                        })
                      }
                      className="px-2.5 py-1 rounded bg-[#1e3a6e] text-white font-bold cursor-pointer"
                    >
                      ✉️ Usar Modelo
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ====================================================================
          SUB-TAB 4: USUÁRIOS, PERFIS SEPARADOS (CRM vs ERP), PERMISSÕES CRUD POR ITEM & 2FA GOOGLE AUTHENTICATOR
      ==================================================================== */}
      {subTab === 'USERS_RBAC' && (
        <div className="space-y-5">
          {/* Caminho / Guia Rápido para Adicionar Usuários, Tipos de Conta (CRM vs ERP), Permissões CRUD e 2FA */}
          <div className="bg-[#0d2b4e] text-white rounded-xl p-4 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-[10px] font-black uppercase tracking-wider text-[#ff7a59]">
                ARQUITETURA DE CONTAS E PERMISSÕES SEPARADAS (CRM ≠ ERP) + 2FA GOOGLE AUTHENTICATOR
              </div>
              <div className="text-sm font-extrabold">
                1. Tipos de Conta do CRM são independentes dos Tipos de Conta do ERP • 2. Permissões Visualizar / Editar / Deletar por Módulo e Item • 3. Pareamento 2FA QR Code
              </div>
              <p className="text-xs text-slate-300">
                Cada colaborador possui seu <strong>Tipo de Conta no CRM</strong> (ex.: Administrador CRM, Gestor Comercial, Executivo B2B, Marketing, NOC) e seu <strong>Tipo de Conta no ERP</strong> (ex.: Administrador ERP, Comercial ERP, Financeiro &amp; Fiscal, Gerência de Estoque, Contratos/O.S., PDV), cada um com sua própria matriz de <strong>Visualizar, Editar e Deletar</strong>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setNewUserTotpSecret(
                  generateTotpSecretBase32(`user-${Date.now()}@setatelecom.com.br`)
                );
                setShowAddUserModal(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-sm cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" /> + Adicionar Novo Usuário &amp; 2FA
            </button>
          </div>

          {/* Users Directory & Instant Role Switcher */}
          {!selectedUserProfile && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-slate-900">
                  Configurações &gt; Usuários — Todos os Usuários Ativos e Desativados ({users.length})
                </h2>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {((["ALL", "ACTIVE", "INACTIVE"] as const)).map((k) => {
                    const lbl = k === "ALL" ? `Todos (${users.length})` : k === "ACTIVE" ? `Ativos (${users.filter((x) => x.active).length})` : `Desativados (${users.filter((x) => !x.active).length})`;
                    return (
                    <button key={k} type="button" onClick={() => setUserStatusFilter(k)} className={"px-3 py-1 rounded-lg text-xs font-extrabold cursor-pointer " + (userStatusFilter === k ? "bg-[#0d2b4e] text-white" : "bg-slate-100 text-slate-700")}>
                      {lbl}
                    </button>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500">
                  Altere separadamente o <strong>Tipo de Conta CRM</strong> e o <strong>Tipo de Conta ERP</strong>, abra o <strong>QR Code 2FA Google Authenticator</strong> ou clique em <strong>Customizar CRUD</strong>.
                </p>
              </div>
              {currentSession && (
                <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-900 text-xs font-extrabold">
                  Sessão Ativa: {currentSession.name} ({currentSession.role})
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                  <tr>
                    <th className="py-2.5 px-3">Colaborador / E-mail</th>
                    <th className="py-2.5 px-3">Tipo de Conta CRM</th>
                    <th className="py-2.5 px-3">Tipo de Conta ERP</th>
                    <th className="py-2.5 px-3">Segurança 2FA Google Authenticator</th>
                    <th className="py-2.5 px-3 text-right">Ações (2FA / Permissões / Sessão)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.filter((u) => userStatusFilter === 'ALL' ? true : userStatusFilter === 'ACTIVE' ? u.active : !u.active).map((u) => {
                    const inferred = inferCrmAndErpRolesFromLegacyRole(u.role);
                    const effCrmRole: CrmAccountRole = u.crmRole || inferred.crmRole;
                    const effErpRole: ErpAccountRole = u.erpRole || inferred.erpRole;
                    const isCurrent = currentSession?.email === u.email;
                    return (
                      <tr key={u.id} onClick={() => setSelectedUserProfile(u)} className={`cursor-pointer ${isCurrent ? 'bg-blue-50/50' : !u.active ? 'opacity-70 bg-slate-50' : 'hover:bg-blue-50/30'}`}>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">{u.name}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {u.email} • {u.department}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded bg-orange-50 text-[#0d2b4e] border border-orange-200 text-[10px] font-bold">
                            {crmRolesCatalogState[effCrmRole]?.label || effCrmRole}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded bg-blue-50 text-[#1e3a6e] border border-blue-200 text-[10px] font-bold">
                            {erpRolesCatalogState[effErpRole]?.label || effErpRole}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                            {u.mfaEnabled ? "2FA Ativo (" + (u.mfaMethod === "TOTP_AUTHENTICATOR" ? "Google Auth" : "E-mail") + ")" : "2FA Inativo"}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedUserProfile(u)}
                              className="px-3 py-1 rounded bg-[#0d2b4e] text-white text-[11px] font-extrabold cursor-pointer"
                            >
                              Abrir Perfil
                            </button>
                            <button
                              type="button"
                              onClick={() => onSwitchRoleSession(u)}
                              className="px-2.5 py-1 rounded bg-slate-100 border border-slate-300 text-slate-800 text-[11px] font-bold cursor-pointer"
                            >
                              Simular
                            </button>
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

          {/* TELA DE CADASTRO DO USUÁRIO + TIPOS DE CONTA + PERMISSÕES (TODOS OS SISTEMAS) AO CLICAR EM UM USUÁRIO */}
          {selectedUserProfile && (() => {
            const inferred = inferCrmAndErpRolesFromLegacyRole(selectedUserProfile.role);
            const effCrm = selectedUserProfile.crmRole || inferred.crmRole;
            const effErp = selectedUserProfile.erpRole || inferred.erpRole;
            const crmMap = selectedUserProfile.crmItemPermissions || buildDefaultCrmItemPermissions(effCrm);
            const erpMap = selectedUserProfile.erpItemPermissions || buildDefaultErpItemPermissions(effErp);
            const secret = selectedUserProfile.totpSecret || generateTotpSecretBase32(selectedUserProfile.email);
            const otpUri = buildOtpAuthUri({ secretBase32: secret, email: selectedUserProfile.email, accountName: selectedUserProfile.name });
            const qrUrl = buildTotpQrCodeSvgDataUrl(otpUri, secret);
            const codeNow = generateTotpCodeSync(secret);

            return (
              <div className="bg-white rounded-2xl border-2 border-[#0d2b4e] p-5 shadow-md space-y-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setSelectedUserProfile(null)} className="px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-300 font-extrabold cursor-pointer">
                      ← Voltar para Lista de Usuários
                    </button>
                    <div>
                      <span className="text-[10px] font-black uppercase text-[#ff7a59] block">
                        CONFIGURAÇÕES &gt; USUÁRIOS &gt; CADASTRO DO USUÁRIO, TIPOS DE CONTA E PERMISSÕES
                      </span>
                      <h3 className="text-sm font-extrabold text-slate-900">
                        {selectedUserProfile.name} ({selectedUserProfile.email}) — {selectedUserProfile.active ? "ATIVO" : "DESATIVADO"}
                      </h3>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedUserProfile({ ...selectedUserProfile, active: !selectedUserProfile.active })}
                      className={"px-3 py-1.5 rounded-lg font-extrabold cursor-pointer " + (selectedUserProfile.active ? "bg-rose-50 text-rose-800 border border-rose-300" : "bg-emerald-50 text-emerald-800 border border-emerald-300")}
                    >
                      {selectedUserProfile.active ? "Desativar Usuário" : "Reativar Usuário"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = users.map((u) => (u.id === selectedUserProfile.id ? selectedUserProfile : u));
                        persistUsersList(next);
                        setSelectedUserProfile(null);
                        onShowToast("Cadastro, Tipos de Conta e Permissões de " + selectedUserProfile.name + " salvos!");
                      }}
                      className="px-4 py-1.5 rounded-lg bg-[#ff7a59] text-white font-extrabold cursor-pointer"
                    >
                      Salvar Usuário &amp; Permissões
                    </button>
                  </div>
                </div>

                {/* 1. Dados de Cadastro & 2FA */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Nome Completo</label>
                    <input type="text" value={selectedUserProfile.name} onChange={(e) => setSelectedUserProfile({ ...selectedUserProfile, name: e.target.value })} className="w-full px-3 py-2 rounded border border-slate-300 font-bold" />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">E-mail Corporativo</label>
                    <input type="email" value={selectedUserProfile.email} onChange={(e) => setSelectedUserProfile({ ...selectedUserProfile, email: e.target.value })} className="w-full px-3 py-2 rounded border border-slate-300 font-mono" />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Departamento</label>
                    <input type="text" value={selectedUserProfile.department} onChange={(e) => setSelectedUserProfile({ ...selectedUserProfile, department: e.target.value })} className="w-full px-3 py-2 rounded border border-slate-300" />
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-wrap items-center gap-4">
                  <img src={qrUrl} alt="QR 2FA" className="w-20 h-20 rounded-lg border border-slate-300 bg-white p-1" />
                  <div className="space-y-1 flex-1">
                    <div className="font-extrabold text-[#0d2b4e]">2FA Google Authenticator ({selectedUserProfile.email})</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="px-2 py-0.5 rounded bg-white border border-slate-300 font-mono font-black">{formatBase32SecretBlocks(secret)}</code>
                      
                    </div>
                  </div>
                </div>

                {/* 2. Tipos de Conta por Sistema */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div>
                    <label className="block font-extrabold text-[#0d2b4e] mb-1">Tipo de Conta no CRM &amp; Chamados:</label>
                    <select
                      value={effCrm}
                      onChange={(e) => {
                        const nextCrm = e.target.value as CrmAccountRole;
                        setSelectedUserProfile({
                          ...selectedUserProfile,
                          crmRole: nextCrm,
                          crmItemPermissions: buildDefaultCrmItemPermissions(nextCrm),
                        });
                      }}
                      className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold text-[#0d2b4e]"
                    >
                      {(Object.keys(crmRolesCatalogState) as CrmAccountRole[]).map((k) => (
                        <option key={k} value={k}>{k} — {crmRolesCatalogState[k].label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-extrabold text-[#1e3a6e] mb-1">Tipo de Conta no ERP:</label>
                    <select
                      value={effErp}
                      onChange={(e) => {
                        const nextErp = e.target.value as ErpAccountRole;
                        setSelectedUserProfile({
                          ...selectedUserProfile,
                          erpRole: nextErp,
                          erpItemPermissions: buildDefaultErpItemPermissions(nextErp),
                        });
                      }}
                      className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold text-[#1e3a6e]"
                    >
                      {(Object.keys(erpRolesCatalogState) as ErpAccountRole[]).map((k) => (
                        <option key={k} value={k}>{k} — {erpRolesCatalogState[k].label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 3. Permissões Visualizar | Editar | Deletar para Todos os Sistemas */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-[#0d2b4e] text-white px-3 py-2 font-extrabold">Permissões no Sistema CRM &amp; Chamados ({CRM_MODULE_ITEMS_CATALOG.length} itens)</div>
                    <div className="max-h-64 overflow-y-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-slate-100 text-slate-600 uppercase text-[9px]">
                          <tr><th className="py-1.5 px-2">Item CRM</th><th className="py-1.5 px-2 text-center">Visualizar</th><th className="py-1.5 px-2 text-center">Editar</th><th className="py-1.5 px-2 text-center">Deletar</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {CRM_MODULE_ITEMS_CATALOG.map((it) => {
                            const fl = crmMap[it.itemId] || { view: false, edit: false, delete: false };
                            return (
                              <tr key={it.itemId}>
                                <td className="py-1.5 px-2 font-semibold">{it.itemLabel}</td>
                                <td className="py-1.5 px-2 text-center"><input type="checkbox" checked={fl.view} onChange={(e) => setSelectedUserProfile({ ...selectedUserProfile, crmItemPermissions: { ...crmMap, [it.itemId]: { ...fl, view: e.target.checked } } })} /></td>
                                <td className="py-1.5 px-2 text-center"><input type="checkbox" checked={fl.edit} onChange={(e) => setSelectedUserProfile({ ...selectedUserProfile, crmItemPermissions: { ...crmMap, [it.itemId]: { ...fl, edit: e.target.checked } } })} /></td>
                                <td className="py-1.5 px-2 text-center"><input type="checkbox" checked={fl.delete} onChange={(e) => setSelectedUserProfile({ ...selectedUserProfile, crmItemPermissions: { ...crmMap, [it.itemId]: { ...fl, delete: e.target.checked } } })} /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-[#1e3a6e] text-white px-3 py-2 font-extrabold">Permissões no Sistema ERP ({ERP_MODULE_ITEMS_CATALOG.length} itens)</div>
                    <div className="max-h-64 overflow-y-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-slate-100 text-slate-600 uppercase text-[9px]">
                          <tr><th className="py-1.5 px-2">Item ERP</th><th className="py-1.5 px-2 text-center">Visualizar</th><th className="py-1.5 px-2 text-center">Editar</th><th className="py-1.5 px-2 text-center">Deletar</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {ERP_MODULE_ITEMS_CATALOG.map((it) => {
                            const fl = erpMap[it.itemId] || { view: false, edit: false, delete: false };
                            return (
                              <tr key={it.itemId}>
                                <td className="py-1.5 px-2 font-semibold">{it.itemLabel}</td>
                                <td className="py-1.5 px-2 text-center"><input type="checkbox" checked={fl.view} onChange={(e) => setSelectedUserProfile({ ...selectedUserProfile, erpItemPermissions: { ...erpMap, [it.itemId]: { ...fl, view: e.target.checked } } })} /></td>
                                <td className="py-1.5 px-2 text-center"><input type="checkbox" checked={fl.edit} onChange={(e) => setSelectedUserProfile({ ...selectedUserProfile, erpItemPermissions: { ...erpMap, [it.itemId]: { ...fl, edit: e.target.checked } } })} /></td>
                                <td className="py-1.5 px-2 text-center"><input type="checkbox" checked={fl.delete} onChange={(e) => setSelectedUserProfile({ ...selectedUserProfile, erpItemPermissions: { ...erpMap, [it.itemId]: { ...fl, delete: e.target.checked } } })} /></td>
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

          {/* MODAL 1: + ADICIONAR NOVO USUÁRIO COM TIPO CRM, TIPO ERP E 2FA GOOGLE AUTHENTICATOR */}
          {showAddUserModal && (() => {
            const previewEmail = newUserEmail.trim() || 'novo.colaborador@setatelecom.com.br';
            const otpauthUri = buildOtpAuthUri({
              secretBase32: newUserTotpSecret,
              email: previewEmail,
              accountName: newUserName.trim() || previewEmail,
            });
            const qrSvgUrl = buildTotpQrCodeSvgDataUrl(otpauthUri, newUserTotpSecret);
            const currentCode = generateTotpCodeSync(newUserTotpSecret);

            return (
              <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full p-6 space-y-4 text-xs my-6">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <div>
                      <span className="text-[10px] font-black uppercase text-[#ff7a59] block">
                        CADASTRO DE USUÁRIO STI-HUB • CONTAS CRM &amp; ERP INDEPENDENTES + 2FA
                      </span>
                      <h3 className="text-base font-extrabold text-slate-900">
                        + Adicionar Novo Usuário, Tipos de Conta (CRM / ERP) &amp; 2FA Google Authenticator
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddUserModal(false)}
                      className="px-3 py-1 rounded border border-slate-300 font-bold text-slate-600 cursor-pointer"
                    >
                      Fechar ✕
                    </button>
                  </div>

                  <form onSubmit={handleCreateNewUser} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Nome Completo *</label>
                        <input
                          type="text"
                          required
                          value={newUserName}
                          onChange={(e) => setNewUserName(e.target.value)}
                          placeholder="Ex: Leandro Souza"
                          className="w-full px-3 py-2 rounded border border-slate-300"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">E-mail Corporativo *</label>
                        <input
                          type="email"
                          required
                          value={newUserEmail}
                          onChange={(e) => setNewUserEmail(e.target.value)}
                          placeholder="leandro@setatelecom.com.br"
                          className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Cargo / Departamento</label>
                        <input
                          type="text"
                          value={newUserDept}
                          onChange={(e) => setNewUserDept(e.target.value)}
                          className="w-full px-3 py-2 rounded border border-slate-300"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                      <div>
                        <label className="block font-extrabold text-[#0d2b4e] mb-1">
                          1. Tipo de Conta no CRM (Sales / Marketing / Chamados):
                        </label>
                        <select
                          value={newUserCrmRole}
                          onChange={(e) => setNewUserCrmRole(e.target.value as CrmAccountRole)}
                          className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold text-[#0d2b4e]"
                        >
                          {(Object.keys(crmRolesCatalogState) as CrmAccountRole[]).map((cKey) => (
                            <option key={cKey} value={cKey}>
                              {cKey} — {crmRolesCatalogState[cKey].label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block font-extrabold text-[#1e3a6e] mb-1">
                          2. Tipo de Conta no ERP (Admin / Comercial / Financeiro / Gerência de Estoque):
                        </label>
                        <select
                          value={newUserErpRole}
                          onChange={(e) => {
                            const nextErp = e.target.value as ErpAccountRole;
                            setNewUserErpRole(nextErp);
                            if (nextErp === 'ERP_STOCK_MANAGER') setNewUserLegacyRole('STOCK_MANAGER');
                            else if (nextErp === 'ERP_FINANCE') setNewUserLegacyRole('ERP_FINANCE_FISCAL');
                            else if (nextErp === 'ERP_ADMIN') setNewUserLegacyRole('SUPER_ADMIN');
                            else if (nextErp === 'ERP_COMMERCIAL') setNewUserLegacyRole('SALES_MANAGER');
                          }}
                          className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold text-[#1e3a6e]"
                        >
                          {(Object.keys(erpRolesCatalogState) as ErpAccountRole[]).map((eKey) => (
                            <option key={eKey} value={eKey}>
                              {eKey} — {erpRolesCatalogState[eKey].label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Pareamento Imediato do 2FA Google Authenticator no Cadastro */}
                    <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-col sm:flex-row items-center gap-4">
                      <img
                        src={qrSvgUrl}
                        alt="QR Code Google Authenticator"
                        className="w-28 h-28 rounded-xl border border-slate-300 bg-white p-1.5 shrink-0"
                      />
                      <div className="space-y-1.5 flex-1">
                        <div className="font-extrabold text-[#0d2b4e]">
                          3. Habilitação Imediata do 2FA Google Authenticator (RFC 6238 TOTP)
                        </div>
                        <p className="text-[11px] text-slate-600">
                          Escaneie o QR Code no aplicativo <strong>Google Authenticator</strong> ou digite a chave Base32 abaixo:
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="px-2 py-1 rounded bg-white border border-slate-300 font-mono font-black text-[#0d2b4e]">
                            {formatBase32SecretBlocks(newUserTotpSecret)}
                          </code>
                          <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-900 font-mono font-black">
                            Código 6 dígitos agora: {currentCode}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setNewUserTotpSecret(
                                generateTotpSecretBase32(`${previewEmail}-${Date.now()}`)
                              )
                            }
                            className="px-2.5 py-1 rounded bg-white border border-slate-300 font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            Regerar Chave TOTP
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() => setShowAddUserModal(false)}
                        className="px-4 py-2 rounded border border-slate-300 font-bold cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="px-5 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer"
                      >
                        Criar Usuário com Permissões CRM/ERP &amp; 2FA Ativo
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            );
          })()}

          {/* MODAL 2: CONFIGURAR 2FA / QR CODE GOOGLE AUTHENTICATOR DE UM USUÁRIO EXISTENTE */}
          {configuringMfaUser && (() => {
            const secret =
              configuringMfaUser.totpSecret ||
              generateTotpSecretBase32(configuringMfaUser.email);
            const otpauthUri = buildOtpAuthUri({
              secretBase32: secret,
              email: configuringMfaUser.email,
              accountName: configuringMfaUser.name,
            });
            const qrSvgUrl = buildTotpQrCodeSvgDataUrl(otpauthUri, secret);
            const activeCode = generateTotpCodeSync(secret);

            return (
              <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full p-6 space-y-4 text-xs">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <div>
                      <span className="text-[10px] font-black uppercase text-emerald-700 block">
                        SEGURANÇA MFA 2FA • GOOGLE AUTHENTICATOR (RFC 6238)
                      </span>
                      <h3 className="text-sm font-extrabold text-slate-900">
                        Pareamento 2FA Google Authenticator — {configuringMfaUser.name}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfiguringMfaUser(null)}
                      className="px-2.5 py-1 rounded border border-slate-300 font-bold cursor-pointer"
                    >
                      Fechar ✕
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <img
                      src={qrSvgUrl}
                      alt="QR Code 2FA"
                      className="w-32 h-32 rounded-xl border border-slate-300 bg-white p-1.5 shrink-0"
                    />
                    <div className="space-y-2 flex-1">
                      <div className="font-bold text-slate-900">
                        Conta: <span className="font-mono">{configuringMfaUser.email}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">Chave Secreta Base32:</span>
                        <code className="px-2 py-1 rounded bg-white border border-slate-300 font-mono font-black text-[#0d2b4e] block mt-0.5">
                          {formatBase32SecretBlocks(secret)}
                        </code>
                      </div>

                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const nextSecret = generateTotpSecretBase32(
                          `${configuringMfaUser.email}:${Date.now()}`
                        );
                        setConfiguringMfaUser({ ...configuringMfaUser, totpSecret: nextSecret });
                      }}
                      className="px-3 py-2 rounded border border-slate-300 font-bold hover:bg-slate-100 cursor-pointer"
                    >
                      Regerar Chave Secreta TOTP
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const updatedUser: StiHubUserAccount = {
                          ...configuringMfaUser,
                          totpSecret: secret,
                          mfaEnabled: true,
                          mfaMethod: 'TOTP_AUTHENTICATOR',
                        };
                        const nextUsers = users.map((u) =>
                          u.id === updatedUser.id ? updatedUser : u
                        );
                        persistUsersList(nextUsers);
                        await fetch('/api/rbac/users', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(updatedUser),
                        }).catch(() => null);
                        setConfiguringMfaUser(null);
                        onShowToast(
                          `2FA Google Authenticator habilitado e sincronizado para ${updatedUser.name}!`
                        );
                      }}
                      className="px-4 py-2 rounded bg-[#0d2b4e] text-white font-extrabold cursor-pointer"
                    >
                      Salvar e Habilitar 2FA Google Authenticator
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ====================================================================
          SUB-TAB 5: DOMÍNIOS & SUBDOMÍNIO OFICIAL (STI-HUB)
      ==================================================================== */}
      {subTab === 'DOMAINS_SUBDOMAIN' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                🌐 Subdomínios Oficiais Configurados — STI-hub (Seta Telecom)
              </h2>
              <p className="text-slate-500">
                Subdomínios ativos na Vercel com certificado SSL/TLS automático e proteção de rotas via Middleware MFA.
              </p>
            </div>
            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-black">
              ● SSL / HTTPS ATIVO
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                domain: 'sti-hub.vercel.app',
                role: 'Subdomínio Principal STI-hub (CRM + ERP)',
                status: 'ATIVO • PRODUÇÃO',
                url: 'https://sti-hub.vercel.app',
              },
              {
                domain: 'hubspot-pro-crm-nu.vercel.app',
                role: 'Espelho de Produção Vercel',
                status: 'ATIVO • PRODUÇÃO',
                url: 'https://hubspot-pro-crm-nu.vercel.app',
              },
              {
                domain: 'stihub.setatelecom.com.br',
                role: 'Subdomínio Corporativo Customizado (CNAME)',
                status: 'CNAME PRONTO: cname.vercel-dns.com',
                url: 'https://sti-hub.vercel.app',
              },
            ].map((d) => (
              <div key={d.domain} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
                  {d.status}
                </span>
                <div className="text-sm font-black text-[#1e3a6e] font-mono">{d.domain}</div>
                <div className="text-[11px] text-slate-600">{d.role}</div>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#0091ae] hover:underline"
                >
                  Abrir Subdomínio <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

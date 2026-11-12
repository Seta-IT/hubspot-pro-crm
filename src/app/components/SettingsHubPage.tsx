'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search, Settings } from 'lucide-react';
import UserAccountModal from './UserAccountModal';
import StiHubAdminRbacPanel, { type AdminSubView } from './StiHubAdminRbacPanel';
import type { ErpConfigAccess } from '../lib/erp-config-access';
import {
  SETTINGS_GROUPS,
  canSeeSettingsItem,
  filterSettingsItems,
  visibleSettingsItems,
  type NavAccessContext,
  type SettingsNavItem,
} from '../lib/hubspot-nav';
import type { CrmEmailTemplate, StiHubRbacState, StiHubUserRecord } from '../../db/types';

const GERAL_TABS: Array<{ id: 'PERFIL' | 'EMAIL' | 'SEGURANCA'; itemId: string; label: string }> = [
  { id: 'PERFIL', itemId: 'pref-geral', label: 'Perfil' },
  { id: 'EMAIL', itemId: 'pref-email', label: 'E-mail' },
  { id: 'SEGURANCA', itemId: 'pref-seguranca', label: 'Segurança' },
];

function isGeralItem(id: string): boolean {
  return id === 'pref-geral' || id === 'pref-email' || id === 'pref-seguranca';
}

export default function SettingsHubPage({
  access,
  user,
  rbacState,
  emailTemplates,
  initialItemId,
  homeScreenLabel,
  canChooseHomeScreen,
  onOpenHomeScreenPreference,
  onBack,
  onUserUpdated,
  onSelectActiveUser,
  onRefresh,
  onShowToast,
  onLogout,
  onItemChange,
}: {
  access: NavAccessContext;
  user: StiHubUserRecord;
  rbacState: StiHubRbacState | null;
  emailTemplates?: CrmEmailTemplate[];
  initialItemId?: string;
  homeScreenLabel?: string;
  canChooseHomeScreen?: boolean;
  onOpenHomeScreenPreference?: () => void;
  onBack: () => void;
  onUserUpdated: (updated: StiHubUserRecord) => void;
  onSelectActiveUser?: (user: StiHubUserRecord) => void;
  onRefresh: () => Promise<void>;
  onShowToast: (msg: string) => void;
  onLogout: () => void;
  onItemChange?: (itemId: string) => void;
}) {
  const visible = useMemo(() => visibleSettingsItems(access), [access]);
  const firstId = visible[0]?.id || 'pref-geral';
  const [activeId, setActiveId] = useState(initialItemId && visible.some((i) => i.id === initialItemId) ? initialItemId : firstId);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (initialItemId && visible.some((i) => i.id === initialItemId)) {
      setActiveId(initialItemId);
    }
  }, [initialItemId]);

  const filtered = filterSettingsItems(visible, query);
  const sidebarItems = filtered.filter((item) => item.id === 'pref-geral' || !isGeralItem(item.id));
  // Se a busca casar só E-mail/Segurança, mostre Geral.
  const showGeralInSidebar =
    sidebarItems.some((i) => i.id === 'pref-geral') ||
    filtered.some((i) => isGeralItem(i.id));

  const selectItem = (id: string) => {
    setActiveId(id);
    onItemChange?.(id);
  };

  const active: SettingsNavItem | undefined =
    visible.find((i) => i.id === activeId) || visible.find((i) => i.id === firstId);

  const geralTab = (GERAL_TABS.find((t) => t.itemId === activeId)?.id || 'PERFIL') as 'PERFIL' | 'EMAIL' | 'SEGURANCA';
  const showGeral = active ? isGeralItem(active.id) : false;
  const showAdmin = Boolean(active && !isGeralItem(active.id) && active.adminSubView);

  return (
    <div className="rounded-lg overflow-hidden border border-slate-200 bg-[#f5f8fa] min-h-[780px] flex flex-col" data-testid="settings-hub">
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700 cursor-pointer"
          data-testid="settings-back"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <Settings className="w-4 h-4 text-slate-500 shrink-0" />
          <h1 className="text-sm font-semibold text-slate-900 truncate">Configurações</h1>
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-lg ml-auto">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar configurações"
            className="w-full pl-9 pr-3 py-2 rounded-md border border-slate-200 text-sm text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
            data-testid="settings-search"
          />
        </div>
      </div>

      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        <aside className="w-full md:w-64 shrink-0 bg-white border-b md:border-b-0 md:border-r border-slate-200 p-3 overflow-y-auto">
          {SETTINGS_GROUPS.map((group) => {
            const groupItems = sidebarItems.filter((i) => i.group === group.id);
            const items =
              group.id === 'PREFERENCIAS' && showGeralInSidebar && !groupItems.some((i) => i.id === 'pref-geral')
                ? [{ ...(visible.find((i) => i.id === 'pref-geral') as SettingsNavItem), id: 'pref-geral', label: 'Geral' }, ...groupItems]
                : groupItems.map((i) => (i.id === 'pref-geral' ? { ...i, label: 'Geral' } : i));
            if (items.length === 0 || items.some((i) => !i)) return null;
            return (
              <div key={group.id} className="mb-4">
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {items.filter(Boolean).map((item) => {
                    const activeGroup = item.id === 'pref-geral' ? isGeralItem(activeId) : activeId === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectItem(item.id)}
                        className={`w-full text-left px-2.5 py-2 rounded-md text-xs font-semibold cursor-pointer ${
                          activeGroup ? 'bg-slate-100 text-[#0d2b4e]' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </aside>

        <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-4">
          {showGeral && (
            <>
              <div className="flex flex-wrap items-center gap-1.5 bg-white p-1.5 rounded-xl border border-slate-200">
                {GERAL_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => selectItem(tab.itemId)}
                    className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                      geralTab === tab.id ? 'bg-[#0d2b4e] text-white' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <UserAccountModal
                embedded
                visibleSections={[geralTab]}
                user={user}
                onClose={() => undefined}
                onUserUpdated={onUserUpdated}
                homeScreenLabel={homeScreenLabel}
                canChooseHomeScreen={canChooseHomeScreen}
                onOpenHomeScreenPreference={geralTab === 'PERFIL' ? onOpenHomeScreenPreference : undefined}
                onLogout={onLogout}
                onShowToast={onShowToast}
              />
            </>
          )}

          {showAdmin && active?.adminSubView && (
            <StiHubAdminRbacPanel
              key={active.adminSubView}
              access={access.erpConfig as ErpConfigAccess | null}
              hideTopBanner
              rbacState={rbacState}
              emailTemplates={emailTemplates}
              initialSubView={active.adminSubView as AdminSubView}
              activeUser={user}
              onSelectActiveUser={onSelectActiveUser}
              onRefresh={onRefresh}
              onShowToast={onShowToast}
              singleView
            />
          )}

          {!showGeral && !showAdmin && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm font-semibold text-slate-600">
              Nenhuma configuração disponível para o seu perfil.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function settingsItemAllowed(itemId: string, access: NavAccessContext): boolean {
  const item = visibleSettingsItems(access).find((i) => i.id === itemId);
  return Boolean(item && canSeeSettingsItem(item, access));
}

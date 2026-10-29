'use client';

import React, { useMemo, useState } from 'react';
import { Home, Kanban, Receipt, Ticket, CheckCircle2, X } from 'lucide-react';
import {
  HomeModuleAccess,
  HomeScreenId,
  HomeSystemId,
  HOME_SYSTEMS,
  getAllowedSystems,
  getHomeScreen,
  getOverviewScreenForSystem,
  getScreensForSystem,
  resolveInitialHomeScreen,
  shouldOfferHomeScreenChoice,
} from '../lib/home-screen';

interface HomeScreenPreferenceModalProps {
  userName: string;
  access: HomeModuleAccess;
  savedScreenId: HomeScreenId | null;
  onSave: (screenId: HomeScreenId | null) => void;
  onClose: () => void;
}

const SYSTEM_ICONS: Record<HomeSystemId, React.ComponentType<{ className?: string }>> = {
  CRM: Kanban,
  ERP: Receipt,
  CHAMADOS: Ticket,
};

export default function HomeScreenPreferenceModal({
  userName,
  access,
  savedScreenId,
  onSave,
  onClose,
}: HomeScreenPreferenceModalProps) {
  const allowedSystems = useMemo(() => getAllowedSystems(access), [access]);
  const canChoose = shouldOfferHomeScreenChoice(access);
  const effective = resolveInitialHomeScreen({ saved: savedScreenId, access }).screenId;
  const initialScreen: HomeScreenId | null = effective;
  const [selectedSystem, setSelectedSystem] = useState<HomeSystemId | null>(
    initialScreen ? getHomeScreen(initialScreen).system : allowedSystems[0] || null
  );
  const [selectedScreen, setSelectedScreen] = useState<HomeScreenId | null>(initialScreen);

  const screens = selectedSystem ? getScreensForSystem(selectedSystem) : [];
  const currentLabel = effective ? `${getHomeScreen(effective).system === 'CHAMADOS' ? 'Chamados' : getHomeScreen(effective).system} - ${getHomeScreen(effective).label}` : 'Nenhuma';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden text-xs my-6">
        <div className="bg-[#0d2b4e] text-white px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#ff7a59] flex items-center justify-center">
              <Home className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold">Tela inicial padrão</h2>
              <p className="text-[11px] text-slate-300 font-semibold">
                Escolha o sistema e a tela que abrem ao entrar no STI-hub, {userName}.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-1.5 rounded-md hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-600">Tela inicial atual</span>
            <span className="font-semibold text-[#0d2b4e]">{currentLabel}</span>
          </div>

          {!canChoose ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
              <p className="font-semibold">Seu acesso inclui apenas um sistema.</p>
              <p className="mt-1">
                O STI-hub abre automaticamente a Visão Geral desse sistema. A escolha da tela inicial fica
                disponível quando houver acesso a mais de um sistema.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <h3 className="text-[11px] uppercase tracking-wide font-bold text-slate-500">1. Sistema</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {HOME_SYSTEMS.filter((s) => allowedSystems.includes(s.id)).map((sys) => {
                    const Icon = SYSTEM_ICONS[sys.id];
                    const active = selectedSystem === sys.id;
                    return (
                      <button
                        key={sys.id}
                        type="button"
                        onClick={() => {
                          setSelectedSystem(sys.id);
                          if (!selectedScreen || getHomeScreen(selectedScreen).system !== sys.id) {
                            setSelectedScreen(getOverviewScreenForSystem(sys.id));
                          }
                        }}
                        className={`text-left rounded-lg border px-3 py-2.5 transition cursor-pointer ${
                          active
                            ? 'border-[#ff7a59] bg-[#fff3ef] ring-1 ring-[#ff7a59]'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${active ? 'text-[#ff7a59]' : 'text-slate-500'}`} />
                          <span className="font-semibold text-[#0d2b4e] text-[13px]">{sys.label}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">{sys.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedSystem && (
                <div className="space-y-2">
                  <h3 className="text-[11px] uppercase tracking-wide font-bold text-slate-500">2. Tela</h3>
                  <div className="space-y-1.5">
                    {screens.map((scr) => {
                      const active = selectedScreen === scr.id;
                      return (
                        <label
                          key={scr.id}
                          className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition ${
                            active ? 'border-[#00bda5] bg-[#e5f8f6]' : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <input
                            type="radio"
                            name="home-screen"
                            className="mt-0.5 accent-[#00a38d]"
                            checked={active}
                            onChange={() => setSelectedScreen(scr.id)}
                          />
                          <span>
                            <span className="block font-semibold text-[#0d2b4e]">{scr.label}</span>
                            <span className="block text-[11px] text-slate-500">{scr.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-500">
                Links diretos (por exemplo, um link de proposta ou um endereço com parâmetros) continuam abrindo o
                destino do link. Se o seu acesso a um sistema for removido, o STI-hub abre o primeiro sistema
                permitido.
              </p>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          {canChoose ? (
            <button
              type="button"
              onClick={() => onSave(null)}
              className="px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-200 font-semibold cursor-pointer"
            >
              Restaurar padrão do sistema
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 font-semibold text-slate-700 cursor-pointer"
            >
              {canChoose ? 'Cancelar' : 'Fechar'}
            </button>
            {canChoose && (
              <button
                type="button"
                disabled={!selectedScreen}
                onClick={() => onSave(selectedScreen)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#ff7a59] hover:bg-[#e86646] disabled:opacity-50 text-white font-semibold cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Salvar tela inicial
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

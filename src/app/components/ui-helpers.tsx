'use client';

import React from 'react';
import { BuyingRoleType, LeadStatus, LifecycleStage } from '../../db/types';

export const BUYING_ROLE_OPTIONS: Array<{ value: BuyingRoleType; label: string }> = [
  { value: 'DECISOR', label: 'Decisor' },
  { value: 'COMPRADOR_ECONOMICO', label: 'Comprador Econômico' },
  { value: 'INFLUENCIADOR_TECNICO', label: 'Influenciador Técnico' },
  { value: 'CAMPEAO', label: 'Campeão' },
  { value: 'BLOQUEADOR', label: 'Bloqueador' },
  { value: 'OPERACIONAL', label: 'Operacional' },
];

export const ICP_TIER_OPTIONS: Array<{ value: 'TIER_1' | 'TIER_2' | 'TIER_3'; label: string }> = [
  { value: 'TIER_1', label: 'Tier 1 — Enterprise / Estratégico' },
  { value: 'TIER_2', label: 'Tier 2 — Mid-Market B2B' },
  { value: 'TIER_3', label: 'Tier 3 — SMB / Entrada' },
];

export const SETA_OWNER_OPTIONS: string[] = [
  'Marcelo Lopes Mira',
  'Evelyn Ternero Seta Telecom',
  'Contato Seta Telecom',
  'Roberto Carquejo (Inativo)',
  '(Inside) Gabriel Lopes (Inativo)',
  'Felipe Seta (Inativo)',
];

export function getBuyingRoleLabel(role: BuyingRoleType | string | null | undefined): string {
  const map: Record<string, string> = {
    DECISOR: 'Decisor',
    COMPRADOR_ECONOMICO: 'Comprador Econômico',
    INFLUENCIADOR_TECNICO: 'Influenciador Técnico',
    CAMPEAO: 'Campeão',
    BLOQUEADOR: 'Bloqueador',
    OPERACIONAL: 'Operacional',
  };
  return role ? map[role] || role : 'Não definido';
}

export function getBuyingRoleBadge(role: BuyingRoleType | string | null | undefined) {
  if (!role) return null;
  const map: Record<string, { label: string; bg: string; text: string; border: string }> = {
    DECISOR: {
      label: 'Decisor',
      bg: 'bg-purple-50',
      text: 'text-purple-800',
      border: 'border-purple-200',
    },
    COMPRADOR_ECONOMICO: {
      label: 'Comprador Econômico',
      bg: 'bg-emerald-50',
      text: 'text-emerald-800',
      border: 'border-emerald-200',
    },
    INFLUENCIADOR_TECNICO: {
      label: 'Influenciador Técnico',
      bg: 'bg-sky-50',
      text: 'text-sky-800',
      border: 'border-sky-200',
    },
    CAMPEAO: {
      label: 'Campeão',
      bg: 'bg-amber-50',
      text: 'text-amber-800',
      border: 'border-amber-200',
    },
    BLOQUEADOR: {
      label: 'Bloqueador',
      bg: 'bg-rose-50',
      text: 'text-rose-800',
      border: 'border-rose-200',
    },
    OPERACIONAL: {
      label: 'Operacional',
      bg: 'bg-slate-100',
      text: 'text-slate-700',
      border: 'border-slate-200',
    },
  };
  const info = map[role] || {
    label: role,
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-normal border ${info.bg} ${info.text} ${info.border}`}
    >
      {info.label}
    </span>
  );
}

export function getIcpTierBadge(tier: 'TIER_1' | 'TIER_2' | 'TIER_3' | string | null | undefined) {
  if (!tier) return null;
  const map: Record<string, { label: string; bg: string; text: string; border: string }> = {
    TIER_1: {
      label: 'ICP Tier 1',
      bg: 'bg-indigo-50',
      text: 'text-indigo-800',
      border: 'border-indigo-200',
    },
    TIER_2: {
      label: 'ICP Tier 2',
      bg: 'bg-cyan-50',
      text: 'text-cyan-800',
      border: 'border-cyan-200',
    },
    TIER_3: {
      label: 'ICP Tier 3',
      bg: 'bg-slate-100',
      text: 'text-slate-700',
      border: 'border-slate-200',
    },
  };
  const info = map[tier] || {
    label: tier,
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-normal border ${info.bg} ${info.text} ${info.border}`}
    >
      {info.label}
    </span>
  );
}

export function formatBRL(value: number | null | undefined): string {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatDateTimeBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return '—';
  }
}

export function formatRelativeDays(iso: string | null | undefined): string {
  if (!iso) return 'Sem registro';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Sem registro';
    const diffMs = Date.now() - d.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days <= 0) return 'Hoje';
    if (days === 1) return 'Ontem';
    return `Há ${days} dias`;
  } catch {
    return 'Sem registro';
  }
}

export function getLifecycleBadge(stage: LifecycleStage | string) {
  const map: Record<string, { label: string; bg: string; text: string; border: string }> = {
    SUBSCRIBER: {
      label: 'Assinante',
      bg: 'bg-slate-100',
      text: 'text-slate-700',
      border: 'border-slate-200',
    },
    LEAD: {
      label: 'Lead',
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      border: 'border-blue-200',
    },
    MQL: {
      label: 'MQL',
      bg: 'bg-indigo-50',
      text: 'text-indigo-700',
      border: 'border-indigo-200',
    },
    SQL: {
      label: 'SQL Qualificado',
      bg: 'bg-amber-50',
      text: 'text-amber-800',
      border: 'border-amber-200',
    },
    OPPORTUNITY: {
      label: 'Oportunidade',
      bg: 'bg-orange-50',
      text: 'text-[#e05835]',
      border: 'border-orange-200',
    },
    CUSTOMER: {
      label: 'Cliente Ativo',
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      border: 'border-emerald-200',
    },
    EVANGELIST: {
      label: 'Promotor',
      bg: 'bg-teal-50',
      text: 'text-teal-700',
      border: 'border-teal-200',
    },
  };
  const info = map[stage] || {
    label: stage || 'Outro',
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-normal border ${info.bg} ${info.text} ${info.border}`}
    >
      {info.label}
    </span>
  );
}

export function getLeadStatusLabel(status: LeadStatus | string): string {
  const map: Record<string, string> = {
    NEW: 'Novo',
    OPEN: 'Aberto',
    IN_PROGRESS: 'Em Andamento',
    OPEN_DEAL: 'Negócio Aberto',
    UNQUALIFIED: 'Desqualificado',
    ATTEMPTED_TO_CONTACT: 'Tentativa de Contato',
    CONNECTED: 'Conectado',
    BAD_TIMING: 'Timing Futuro',
  };
  return map[status] || status;
}

export function getScoreColorClasses(score: number): {
  bar: string;
  badge: string;
  text: string;
  label: string;
} {
  if (score >= 80) {
    return {
      bar: 'bg-emerald-500',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      text: 'text-emerald-600',
      label: 'Quente (A+)',
    };
  }
  if (score >= 60) {
    return {
      bar: 'bg-amber-500',
      badge: 'bg-amber-50 text-amber-800 border-amber-200',
      text: 'text-amber-600',
      label: 'Morno (B)',
    };
  }
  return {
    bar: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    text: 'text-rose-600',
    label: 'Frio / Baixo (C)',
  };
}

'use client';

// Acesso calculado no servidor (GET /api/auth/session) + matriz rbac.ts
// (resolveErpConfigAccess). null enquanto carrega: quem usa deve esconder (fail closed).
import { useEffect, useState } from 'react';
import {
  type ErpConfigAccess,
  type ErpConfigSessionLike,
  NO_ERP_CONFIG_ACCESS,
  resolveErpConfigAccess,
} from '../lib/erp-config-access';

export function useErpConfigAccess(refreshKey?: string | null, enabled = true): ErpConfigAccess | null {
  const [access, setAccess] = useState<ErpConfigAccess | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive) setAccess(resolveErpConfigAccess((j?.data ?? null) as ErpConfigSessionLike | null));
      })
      .catch(() => {
        if (alive) setAccess(NO_ERP_CONFIG_ACCESS);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey, enabled]);
  return access;
}

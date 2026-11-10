// t33u: o short link /p/<codigo> resolve no servidor (GET /api/p/<codigo>) o id da proposta e o
// token assinado, e reaproveita a mesma folha A4 publica (/proposta/[id]) por este contexto.
import { createContext } from 'react';

export type ProposalLinkOverride = { proposalId: string; token: string } | null;

export const ProposalLinkOverrideContext = createContext<ProposalLinkOverride>(null);

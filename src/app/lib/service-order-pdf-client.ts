// Download do PDF da OS no navegador, a partir do documento atual (sem novo registro no historico).
import { buildServiceOrderPdf, type ServiceOrderDocumentModel } from '../../modules/erp/service-order-document';

export function downloadServiceOrderPdfFromModel(model: ServiceOrderDocumentModel, fileName: string): void {
  if (typeof document === 'undefined') return;
  const bytes = buildServiceOrderPdf(model);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function fetchServiceOrderDocument(
  osId: string
): Promise<{ ok: true; model: ServiceOrderDocumentModel; fileName: string } | { ok: false; error: string; status: number }> {
  const res = await fetch(`/api/erp/service-orders/${encodeURIComponent(osId)}/document`, { cache: 'no-store' }).catch(() => null);
  const json = res ? await res.json().catch(() => null) : null;
  if (!res || !res.ok || !json?.data) {
    return { ok: false, error: String(json?.error || 'Ordem de serviço não encontrada.'), status: res?.status || 0 };
  }
  return { ok: true, model: json.data as ServiceOrderDocumentModel, fileName: String(json.fileName || 'OS.pdf') };
}

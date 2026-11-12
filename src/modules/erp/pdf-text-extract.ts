// Extração de texto de PDF no servidor (unpdf: build do pdf.js para serverless, sem worker).
// PDFs escaneados (só imagem) não têm camada de texto e voltam com texto vazio.
export const MAX_PDF_BYTES = 3 * 1024 * 1024;
export const MAX_PDF_PAGES = 40;

export async function extractPdfText(data: Uint8Array): Promise<{ text: string; pages: number }> {
  if (data.byteLength > MAX_PDF_BYTES) throw new Error('PDF acima de 3 MB.');
  const head = Buffer.from(data.subarray(0, 1024)).toString('latin1');
  if (!head.includes('%PDF-')) throw new Error('Arquivo não é um PDF válido.');
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(data), { isEvalSupported: false } as never);
  try {
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const out: string[] = [];
    for (let i = 1; i <= pages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Reconstrói as linhas pela posição Y (faturas costumam vir em colunas).
      const rows = new Map<number, Array<{ x: number; s: string }>>();
      for (const item of content.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>) {
        if (typeof item.str !== 'string' || !item.str.trim() || !Array.isArray(item.transform)) continue;
        const y = Math.round(item.transform[5] / 2) * 2;
        const x = item.transform[4];
        const row = rows.get(y) || [];
        row.push({ x, s: item.str });
        rows.set(y, row);
      }
      const ys = [...rows.keys()].sort((a, b) => b - a);
      for (const y of ys) {
        const row = rows.get(y)!.sort((a, b) => a.x - b.x);
        out.push(row.map((r) => r.s.trim()).join(' ').replace(/\s+/g, ' ').trim());
      }
      out.push('');
    }
    return { text: out.join('\n'), pages: pdf.numPages };
  } finally {
    try {
      await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
    } catch {
      // ignore
    }
  }
}

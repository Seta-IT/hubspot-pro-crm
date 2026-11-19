// ============================================================================
// STI-hub — Fase 6: estatistica dos testes A/B e multivariados (sem dependencias).
//  - Tamanho de amostra por variante (duas proporcoes, bicaudal, correcao de Bonferroni).
//  - Teste qui-quadrado de independencia (k variantes) e teste z de duas proporcoes.
//  - Decisao: todas as variantes com a amostra minima + qui-quadrado significativo + a melhor
//    variante significativamente acima da segunda (alfa corrigido).
// ============================================================================

/** Funcao de distribuicao acumulada da normal padrao (Abramowitz-Stegun 7.1.26 via erf). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Inversa da normal padrao (algoritmo de Acklam, erro relativo ~1e-9). */
export function normalInv(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError('p fora de (0,1)');
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normalInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function logGamma(x: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const v of g) ser += v / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Gama incompleta regularizada superior Q(a, x). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** p-valor da qui-quadrado com df graus de liberdade. */
export function chiSquarePValue(chi2: number, df: number): number {
  if (!(chi2 > 0) || df <= 0) return 1;
  return Math.min(1, Math.max(0, gammaQ(df / 2, chi2 / 2)));
}

export interface ProportionStat {
  conversions: number;
  n: number;
}

/** Qui-quadrado de independencia 2 x k (converteu / nao converteu por variante). */
export function chiSquareTest(groups: ProportionStat[]): { chi2: number; df: number; pValue: number } {
  const valid = groups.filter((g) => g.n > 0);
  const N = valid.reduce((s, g) => s + g.n, 0);
  const X = valid.reduce((s, g) => s + g.conversions, 0);
  if (valid.length < 2 || N === 0 || X === 0 || X === N) return { chi2: 0, df: Math.max(0, valid.length - 1), pValue: 1 };
  let chi2 = 0;
  for (const g of valid) {
    const e1 = (g.n * X) / N;
    const e0 = (g.n * (N - X)) / N;
    chi2 += (g.conversions - e1) ** 2 / e1 + (g.n - g.conversions - e0) ** 2 / e0;
  }
  const df = valid.length - 1;
  return { chi2, df, pValue: chiSquarePValue(chi2, df) };
}

/** Teste z de duas proporcoes (bicaudal, variancia combinada). */
export function twoProportionZTest(a: ProportionStat, b: ProportionStat): { z: number; pValue: number } {
  if (a.n === 0 || b.n === 0) return { z: 0, pValue: 1 };
  const p1 = a.conversions / a.n;
  const p2 = b.conversions / b.n;
  const p = (a.conversions + b.conversions) / (a.n + b.n);
  const se = Math.sqrt(p * (1 - p) * (1 / a.n + 1 / b.n));
  if (!(se > 0)) return { z: 0, pValue: 1 };
  const z = (p1 - p2) / se;
  return { z, pValue: Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))) };
}

/**
 * Tamanho de amostra por variante para detectar o aumento relativo `minDetectableLift` sobre a
 * taxa de base, com alfa bicaudal corrigido por Bonferroni para (variantes - 1) comparacoes.
 */
export function sampleSizePerVariant(input: { baselineRate: number; minDetectableLift: number; alpha?: number; power?: number; variants?: number }): number {
  const alpha = input.alpha ?? 0.05;
  const power = input.power ?? 0.8;
  const k = Math.max(2, input.variants ?? 2);
  const p1 = Math.min(0.99, Math.max(0.0005, input.baselineRate));
  const p2 = Math.min(0.999, p1 * (1 + Math.max(0.01, input.minDetectableLift)));
  const a = alpha / (k - 1);
  const za = normalInv(1 - a / 2);
  const zb = normalInv(power);
  const pbar = (p1 + p2) / 2;
  const n = (za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p2 - p1) ** 2;
  return Math.ceil(n);
}

export interface VariantResult extends ProportionStat {
  id: string;
  label: string;
  rate: number;
}

export interface ExperimentDecision {
  significant: boolean;
  winnerId: string | null;
  pValue: number;
  pairwisePValue: number;
  chi2: number;
  reachedSample: boolean;
  /** Explicacao em portugues (vai para a tela e para a auditoria). */
  reason: string;
}

export function evaluateVariants(variants: VariantResult[], opts: { alpha: number; minPerVariant: number }): ExperimentDecision {
  const chi = chiSquareTest(variants);
  const sorted = [...variants].sort((x, y) => y.rate - x.rate || y.n - x.n);
  const best = sorted[0];
  const second = sorted[1];
  const pair = best && second ? twoProportionZTest(best, second) : { z: 0, pValue: 1 };
  const corrected = opts.alpha / Math.max(1, variants.length - 1);
  const reachedSample = variants.length >= 2 && variants.every((v) => v.n >= opts.minPerVariant);
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  let reason: string;
  let significant = false;
  if (!reachedSample) {
    const missing = variants.filter((v) => v.n < opts.minPerVariant).map((v) => `${v.label} (${v.n}/${opts.minPerVariant})`);
    reason = `Amostra mínima ainda não atingida: ${missing.join(', ')}.`;
  } else if (chi.pValue >= opts.alpha) {
    reason = `Sem diferença significativa entre as variantes (qui-quadrado p = ${chi.pValue.toFixed(4)}, alfa ${opts.alpha}).`;
  } else if (pair.pValue >= corrected) {
    reason = `${best.label} lidera (${pct(best.rate)}), mas não supera ${second.label} (${pct(second.rate)}) com significância (p = ${pair.pValue.toFixed(4)}, alfa corrigido ${corrected.toFixed(4)}).`;
  } else {
    significant = true;
    reason = `${best.label} venceu: ${pct(best.rate)} contra ${pct(second.rate)} de ${second.label} (qui-quadrado p = ${chi.pValue.toFixed(4)}; z p = ${pair.pValue.toFixed(4)}).`;
  }
  return { significant, winnerId: significant ? best.id : null, pValue: chi.pValue, pairwisePValue: pair.pValue, chi2: chi.chi2, reachedSample, reason };
}

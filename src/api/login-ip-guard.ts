// ============================================================================
// Pacote I (D3, 01/11/2026): limite de falhas de login por IP sem trancar o escritorio.
// Antes (H): 20 falhas/10 min por IP => 429 para TODOS atras do mesmo IP (NAT), inclusive com a
// senha correta. Agora a contagem e por IP + e-mail:
//  - pulverizacao (credential spraying): 20 E-MAILS DIFERENTES com falha a partir do mesmo IP em
//    10 min => o IP inteiro recebe 429 (protecao por IP continua);
//  - forca bruta numa conta: 10 falhas do mesmo (IP, e-mail) em 10 min => 429 so para esse par
//    (o bloqueio por conta do repositorio, com 6 falhas, continua valendo);
//  - teto de seguranca: 100 falhas do IP em 10 min => 429 no IP.
// Um colega que erra a propria senha nao tranca os outros usuarios do mesmo NAT.
// O e-mail e guardado so como HMAC (chave aleatoria por processo).
//
// Pacote J (D-I4): IPv6 e contado pelo prefixo /64 (rateLimitIpKey); IPv4 mapeado => IPv4.
// Pacote J (D-I5, limite conhecido, so documentado): (a) os baldes de transbordo do contador por
// conta (repositorio, mapa cheio) sao compartilhados — colisao adianta o bloqueio em 1-3 tentativas
// e um flood distribuido grande pode travar baldes temporariamente; (b) requisicoes sem IP
// resolvido pelo bridge caem todas no balde 'sem-ip' (na Vercel o IP sempre vem da borda).
// Mitigacao futura, se necessario: mais baldes ou janela curta por balde.
// ============================================================================
import crypto from 'node:crypto';
import { rateLimitIpKey } from './client-ip';

export class LoginIpFailureGuard {
  static readonly DISTINCT_EMAILS_PER_IP = 20;
  static readonly FAILS_PER_IP_EMAIL = 10;
  static readonly FAILS_PER_IP_TOTAL = 100;
  static readonly WINDOW_MS = 10 * 60 * 1000;
  static readonly MAX_IPS = 5000;

  private readonly key = crypto.randomBytes(32);
  /** ip -> (hash do e-mail -> instantes das falhas) */
  private readonly byIp = new Map<string, Map<string, number[]>>();

  private emailHash(email: string): string {
    return crypto
      .createHmac('sha256', this.key)
      .update(String(email || '').trim().toLowerCase())
      .digest('base64url')
      .slice(0, 22);
  }

  private live(ip: string, now: number): Map<string, number[]> | undefined {
    const m = this.byIp.get(ip);
    if (!m) return undefined;
    for (const [h, arr] of m) {
      const fresh = arr.filter((t) => now - t < LoginIpFailureGuard.WINDOW_MS);
      if (fresh.length) m.set(h, fresh);
      else m.delete(h);
    }
    if (m.size === 0) {
      this.byIp.delete(ip);
      return undefined;
    }
    return m;
  }

  /** true => recusar com 429 antes de verificar a senha. */
  isBlocked(ip: string, email: string, now: number = Date.now()): boolean {
    const m = this.live(rateLimitIpKey(ip), now); // Pacote J (D-I4): IPv6 agrupado por /64
    if (!m) return false;
    if (m.size >= LoginIpFailureGuard.DISTINCT_EMAILS_PER_IP) return true;
    let total = 0;
    for (const arr of m.values()) total += arr.length;
    if (total >= LoginIpFailureGuard.FAILS_PER_IP_TOTAL) return true;
    return (m.get(this.emailHash(email))?.length || 0) >= LoginIpFailureGuard.FAILS_PER_IP_EMAIL;
  }

  hit(ip: string, email: string, now: number = Date.now()): void {
    const k = rateLimitIpKey(ip); // Pacote J (D-I4): IPv6 agrupado por /64
    let m = this.live(k, now);
    if (!m) {
      if (this.byIp.size >= LoginIpFailureGuard.MAX_IPS) {
        for (const ipk of [...this.byIp.keys()]) {
          this.live(ipk, now);
          if (this.byIp.size < LoginIpFailureGuard.MAX_IPS) break;
        }
        // Sem espaco: o IP mais antigo sai (Map preserva ordem de insercao).
        if (this.byIp.size >= LoginIpFailureGuard.MAX_IPS) this.byIp.delete(this.byIp.keys().next().value as string);
      }
      m = new Map();
      this.byIp.set(k, m);
    }
    const h = this.emailHash(email);
    const arr = m.get(h) || [];
    arr.push(now);
    m.set(h, arr.slice(-LoginIpFailureGuard.FAILS_PER_IP_TOTAL));
  }
}

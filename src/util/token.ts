import { createHash, timingSafeEqual } from 'node:crypto';

// ¿La cabecera `Authorization` trae exactamente `Bearer <token>`? Se compara en tiempo constante (sobre hashes
// del mismo largo) para no filtrar el token por diferencias de tiempo de respuesta.
export function tokenValido(cabecera: string | undefined | null, token: string | undefined): boolean {
  if (!token || !cabecera) return false;
  const hash = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(cabecera), hash(`Bearer ${token}`));
}

// tablero-cache.ts — caché local del tablero (stale-while-revalidate).
// Módulo propio (sin side effects) para que login.ts pueda PRECARGAR el
// tablero antes de redirigir: al llegar a /tablero/ los datos ya están
// pintados al instante y solo queda la revalidación en segundo plano.

export interface ProduccionCache {
  id: string;
  [key: string]: unknown;
}

export interface BoardCache {
  producciones: ProduccionCache[];
  editores: { email: string; nombre: string }[];
  ediciones: { numero: string; estado: string }[];
}

export const BOARD_CACHE_KEY = 'tds-board-cache-v1';

export function readCachedBoard(): BoardCache | null {
  try { return JSON.parse(localStorage.getItem(BOARD_CACHE_KEY) || 'null'); } catch { return null; }
}

export function saveCachedBoard(cache: BoardCache) {
  try { localStorage.setItem(BOARD_CACHE_KEY, JSON.stringify(cache)); } catch { /* sin caché local */ }
}

export function clearCachedBoard() {
  try { localStorage.removeItem(BOARD_CACHE_KEY); } catch { /* sin caché local */ }
}

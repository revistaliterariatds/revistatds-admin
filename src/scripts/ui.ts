// ui.ts — helpers de UI compartidos por todas las vistas del panel:
// escape HTML, chequeos de rol, nav común y diálogo de confirmación estilizado.

import { clearSession, type Usuario } from './api';

// ── escape / roles ──

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function esGestor(user: Usuario | null): boolean {
  return user?.rol === 'COORDINADOR' || user?.rol === 'WEBMASTER' || user?.rol === 'SUPERVISOR';
}

export function esAdmin(user: Usuario | null): boolean {
  return user?.rol === 'COORDINADOR' || user?.rol === 'WEBMASTER';
}

// ── nav común (nombre, rol, pestañas según rol, logout) ──

const TABS_GESTOR = ['nav-users', 'nav-config', 'nav-analytics', 'nav-descargas'];

export function renderNav(user: Usuario | null) {
  const navUser = document.getElementById('nav-user');
  if (!navUser || !user) return;
  const gestor = esGestor(user);
  navUser.hidden = false;
  const name = document.getElementById('nav-user-name');
  if (name) name.textContent = user.nombre || user.email;
  const role = document.getElementById('nav-user-role');
  if (role) role.textContent = user.rol;
  TABS_GESTOR.forEach((id) => {
    const link = document.getElementById(id);
    if (link) (link as HTMLElement).hidden = !gestor;
  });
  document.getElementById('nav-logout')?.addEventListener('click', () => {
    clearSession();
    window.location.replace('/');
  });
}

// ── confirmación estilizada (<dialog>) en reemplazo de confirm() nativo ──
// Resuelve true/false; Escape y "Cancelar" resuelven false. Se apila sobre
// otros <dialog> abiertos (detalle de producción, cita, etc.).

let confirmDialog: HTMLDialogElement | null = null;

function asegurarDialogo(): HTMLDialogElement {
  if (confirmDialog) return confirmDialog;
  const dlg = document.createElement('dialog');
  dlg.className = 'confirm-modal';
  dlg.innerHTML = `
    <p class="confirm-msg"></p>
    <div class="detail-acciones confirm-actions">
      <button type="button" class="btn-enviar btn-confirmar-si">Confirmar</button>
      <button type="button" class="btn-ghost btn-confirmar-no">Cancelar</button>
    </div>`;
  document.body.appendChild(dlg);
  confirmDialog = dlg;
  return dlg;
}

export function confirmar(mensaje: string): Promise<boolean> {
  if (typeof HTMLDialogElement === 'undefined') {
    return Promise.resolve(window.confirm(mensaje));
  }
  const dlg = asegurarDialogo();
  return new Promise((resolve) => {
    (dlg.querySelector('.confirm-msg') as HTMLElement).textContent = mensaje;

    let settled = false;
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    const finish = (valor: boolean) => {
      if (settled) return;
      settled = true;
      ac.abort();
      dlg.close();
      resolve(valor);
    };

    dlg.querySelector('.btn-confirmar-si')?.addEventListener('click', () => finish(true), opts);
    dlg.querySelector('.btn-confirmar-no')?.addEventListener('click', () => finish(false), opts);
    dlg.addEventListener('cancel', () => finish(false), opts); // Escape

    dlg.showModal();
    (dlg.querySelector('.btn-confirmar-si') as HTMLButtonElement).focus();
  });
}

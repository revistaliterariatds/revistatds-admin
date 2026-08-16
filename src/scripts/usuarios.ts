import { api, btnCargando, clearSession, getIdToken, getUser } from './api';

interface UsuarioPanel { email: string; rol: string; nombre: string; alias: string; usar_alias_notif: boolean; activo: boolean; }
const user = getUser();
const esGestor = user?.rol === 'COORDINADOR' || user?.rol === 'WEBMASTER' || user?.rol === 'SUPERVISOR';
let puedeEditar = false;
let usuarios: UsuarioPanel[] = [];

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function renderNav() {
  const nav = document.getElementById('nav-user');
  const name = document.getElementById('nav-user-name');
  const role = document.getElementById('nav-user-role');
  const usersLink = document.getElementById('nav-users');
  const configLink = document.getElementById('nav-config');
  const analyticsLink = document.getElementById('nav-analytics');
  const descargasLink = document.getElementById('nav-descargas');
  if (!user || !nav || !name || !role) return;
  nav.hidden = false;
  name.textContent = user.nombre || user.email;
  role.textContent = user.rol;
  if (usersLink) usersLink.hidden = !esGestor;
  if (configLink) configLink.hidden = !esGestor;
  if (analyticsLink) analyticsLink.hidden = !esGestor;
  if (descargasLink) descargasLink.hidden = !esGestor;
  document.getElementById('nav-logout')?.addEventListener('click', () => { clearSession(); window.location.replace('/'); });
}

function alertUser(message: string, error = false) {
  const el = document.getElementById('users-alert');
  if (!el) return;
  el.hidden = false;
  el.className = `status-card${error ? ' error' : ''}`;
  el.textContent = message;
}

function renderUsers() {
  const body = document.getElementById('users-body');
  if (!body) return;
  body.innerHTML = usuarios.map((u, i) => `<tr>
    <td data-label="Email">${esc(u.email)}</td><td data-label="Nombre">${esc(u.alias || u.nombre || '—')}</td>
    <td data-label="Rol">${esc(u.rol)}</td><td data-label="Notificaciones">${u.usar_alias_notif ? 'Alias' : 'Nombre real'}</td>
    <td data-label="Estado">${u.activo ? 'Activo' : 'Inactivo'}</td>
    <td data-label="Acción">${puedeEditar ? `<button type="button" class="btn-mini" data-edit="${i}">Editar</button>` : 'Solo lectura'}</td>
  </tr>`).join('');
  body.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => editar(Number((button as HTMLElement).dataset.edit))));
}

function editar(index: number | null) {
  const form = document.getElementById('user-form') as HTMLFormElement;
  form.hidden = false;
  form.dataset.index = index == null ? '' : String(index);
  const u = index == null ? { email: '', nombre: '', rol: 'EDITOR', alias: '', usar_alias_notif: false, activo: true } : usuarios[index];
  (document.getElementById('user-email') as HTMLInputElement).value = u.email;
  (document.getElementById('user-email') as HTMLInputElement).readOnly = index != null;
  (document.getElementById('user-name') as HTMLInputElement).value = u.nombre;
  (document.getElementById('user-role') as HTMLSelectElement).value = u.rol;
  (document.getElementById('user-alias') as HTMLInputElement).value = u.alias;
  (document.getElementById('user-alias-notif') as HTMLInputElement).checked = u.usar_alias_notif;
  (document.getElementById('user-active') as HTMLInputElement).checked = u.activo;
}

const USERS_CACHE_KEY = 'tds-users-cache-v1';

function readCachedUsers(): { users: UsuarioPanel[]; puede_editar: boolean } | null {
  try { return JSON.parse(localStorage.getItem(USERS_CACHE_KEY) || 'null'); } catch { return null; }
}

async function cargar() {
  const cached = readCachedUsers();
  if (cached) {
    usuarios = cached.users;
    puedeEditar = cached.puede_editar;
    document.getElementById('btn-nuevo-usuario')!.hidden = !puedeEditar;
    renderUsers();
  }
  const data = await api('panel/users/list');
  if (data.status !== 'ok') { alertUser(data.message || 'No se pudieron cargar los usuarios.', true); return; }
  usuarios = data.users || [];
  puedeEditar = data.puede_editar === true;
  document.getElementById('btn-nuevo-usuario')!.hidden = !puedeEditar;
  renderUsers();
  try { localStorage.setItem(USERS_CACHE_KEY, JSON.stringify({ users: usuarios, puede_editar: puedeEditar })); } catch { /* sin caché local */ }
}

async function guardar(event: SubmitEvent) {
  event.preventDefault();
  const form = document.getElementById('user-form') as HTMLFormElement;
  const email = (document.getElementById('user-email') as HTMLInputElement).value;
  const nombre = (document.getElementById('user-name') as HTMLInputElement).value;
  const rol = (document.getElementById('user-role') as HTMLSelectElement).value;
  const alias = (document.getElementById('user-alias') as HTMLInputElement).value;
  const usar_alias_notif = (document.getElementById('user-alias-notif') as HTMLInputElement).checked;
  const activo = (document.getElementById('user-active') as HTMLInputElement).checked;
  const btn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
  btnCargando(btn, true);
  try { localStorage.removeItem(USERS_CACHE_KEY); } catch { /* sin caché local */ }
  const index = form.dataset.index;
  if (index !== undefined && index !== '') {
    const u = usuarios[Number(index)];
    if (u) Object.assign(u, { nombre, rol, alias, usar_alias_notif, activo });
  } else {
    usuarios.push({ email, nombre, rol, alias, usar_alias_notif, activo });
  }
  renderUsers();
  form.hidden = true;
  const data = await api('panel/users/save', { email, nombre, rol, alias, usar_alias_notif, activo });
  btnCargando(btn, false);
  if (data.status !== 'ok') {
    alertUser(data.message || 'No se pudo guardar.', true);
    await cargar(); // revierte el optimismo
    return;
  }
  alertUser(data.message || 'Usuario guardado.');
  await cargar();
}

function init() {
  if (!user || !getIdToken() || !esGestor) { window.location.replace('/tablero/'); return; }
  renderNav();
  document.getElementById('btn-nuevo-usuario')?.addEventListener('click', () => editar(null));
  document.getElementById('btn-cancelar-usuario')?.addEventListener('click', () => { (document.getElementById('user-form') as HTMLFormElement).hidden = true; });
  document.getElementById('user-form')?.addEventListener('submit', guardar);
  cargar();
}

init();

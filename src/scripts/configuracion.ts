import { api, getIdToken, getUser } from './api';
import { esGestor, renderNav } from './ui';

const user = getUser();

function showAlert(message: string, error = false) {
  const el = document.getElementById('config-alert')!;
  el.hidden = false;
  el.className = `status-card${error ? ' error' : ''}`;
  el.textContent = message;
}

function hideAlert() {
  document.getElementById('config-alert')!.hidden = true;
}

const CONFIG_CACHE_KEY = 'tds-config-cache-v3';

const SUBJECT_KEYS = ['confirmation', 'correcciones', 'revision', 'consulta', 'version', 'devolucion', 'agenda', 'recordatorio', 'digest', 'token_vencido'];
const BODY_KEYS = ['confirmation', 'correcciones', 'revision', 'consulta', 'version', 'devolucion', 'recordatorio', 'digest', 'token_vencido'];
const FREC_COMBOS = [
  ['frec_recordatorio_editor', 'frec-recordatorio-editor'],
  ['frec_recordatorio_editor_dia', 'frec-recordatorio-editor-dia'],
  ['frec_digest_coordinador', 'frec-digest-coordinador'],
  ['frec_digest_coordinador_dia', 'frec-digest-coordinador-dia'],
  ['frec_digest_supervisor', 'frec-digest-supervisor'],
  ['frec_digest_supervisor_dia', 'frec-digest-supervisor-dia'],
  ['frec_tokens_coordinador', 'frec-tokens-coordinador'],
  ['frec_tokens_coordinador_dia', 'frec-tokens-coordinador-dia'],
  ['frec_tokens_supervisor', 'frec-tokens-supervisor'],
  ['frec_tokens_supervisor_dia', 'frec-tokens-supervisor-dia'],
];

function fillForm(config: Record<string, string>) {
  (document.getElementById('config-expira') as HTMLInputElement).value = config.expira_token_dias || '30';
  (document.getElementById('config-recordatorio-dias') as HTMLInputElement).value = config.recordatorio_editores_dias || '3';
  (document.getElementById('config-site') as HTMLInputElement).value = config.site_base_url || '';
  SUBJECT_KEYS.forEach((key) => {
    (document.getElementById(`mail-subject-${key}`) as HTMLInputElement).value = config[`mail_subject_${key}`] || '';
  });
  BODY_KEYS.forEach((key) => {
    (document.getElementById(`mail-body-${key}`) as HTMLInputElement).value = config[`mail_body_${key}`] || '';
  });
  FREC_COMBOS.forEach(([cfgKey, id]) => {
    (document.getElementById(id) as HTMLInputElement).value = config[cfgKey] || '';
  });
  (document.getElementById('config-form') as HTMLFormElement).hidden = false;
}

function readCachedConfig(): Record<string, string> | null {
  try { return JSON.parse(localStorage.getItem(CONFIG_CACHE_KEY) || 'null'); } catch { return null; }
}

async function load() {
  const cached = readCachedConfig();
  if (cached) fillForm(cached);
  else showAlert('Cargando configuración…');
  const data = await api('panel/config/list');
  if (data.status !== 'ok') {
    if (!cached) showAlert(data.message || 'No se pudo cargar la configuración.', true);
    return;
  }
  hideAlert();
  const config = data.config || {};
  try { localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config)); } catch { /* sin caché local */ }
  fillForm(config);
}

async function save(key: string, value: string) {
  const data = await api('panel/config/save', { key, value });
  if (data.status !== 'ok') throw new Error(data.message || 'No se pudo guardar.');
}

async function submit(event: SubmitEvent) {
  event.preventDefault();
  try {
    await save('expira_token_dias', (document.getElementById('config-expira') as HTMLInputElement).value);
    await save('recordatorio_editores_dias', (document.getElementById('config-recordatorio-dias') as HTMLInputElement).value);
    await save('site_base_url', (document.getElementById('config-site') as HTMLInputElement).value);
    for (const key of SUBJECT_KEYS) {
      await save(`mail_subject_${key}`, (document.getElementById(`mail-subject-${key}`) as HTMLInputElement).value);
    }
    for (const key of BODY_KEYS) {
      await save(`mail_body_${key}`, (document.getElementById(`mail-body-${key}`) as HTMLInputElement).value);
    }
    for (const [cfgKey, id] of FREC_COMBOS) {
      await save(cfgKey, (document.getElementById(id) as HTMLInputElement).value);
    }
    try { localStorage.removeItem(CONFIG_CACHE_KEY); } catch { /* sin caché local */ }
    showAlert('Configuración guardada.');
  } catch (error) { showAlert(error instanceof Error ? error.message : 'No se pudo guardar.', true); }
}

function init() {
  if (!user || !getIdToken() || !esGestor(user)) { window.location.replace('/tablero/'); return; }
  renderNav(user);
  document.getElementById('config-form')?.addEventListener('submit', submit);
  load();
}

init();

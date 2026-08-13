/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_GOOGLE_CLIENT_ID: string;
  readonly PUBLIC_APPS_SCRIPT_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

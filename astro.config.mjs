// @ts-check
import { defineConfig } from 'astro/config';

// Panel editorial de Tramas del Sur — static SSG en GitHub Pages
// Dominio custom: https://redaccion.tramasdelsur.com.ar (CNAME en Cloudflare)
export default defineConfig({
  site: 'https://redaccion.tramasdelsur.com.ar',
  base: '/',
  trailingSlash: 'always',
});

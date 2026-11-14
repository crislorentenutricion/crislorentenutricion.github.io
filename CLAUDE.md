# CLAUDE.md — Web Cris Lorente Nutrición

Sitio web de **Cris Lorente Nutrición** — 11ty (Eleventy) v3 + Nunjucks, desplegado en GitHub Pages via GitHub Actions.

> Convenciones técnicas (stack, SEO, bugs) → `../convenciones/negocio/web-tecnico.md`
> Tests y reglas TDD → `../convenciones/negocio/web-tests.md`
> Textos legales y embudo → `../convenciones/negocio/web-legal.md`

## Workflow

1. Editar archivos en `src/` (NUNCA en `_site/`)
2. Previsualizar: `npx eleventy --serve --port=3000`
3. **Antes de commit**: `npm test` (unit + build, ~1s). Si falla algo, corregir o actualizar test (ver `web-tests.md`)
4. Solo con aprobación de Cristina → commit + push → web live en ~2 min (CI ejecuta `test:unit` como gate antes del deploy)

## Estructura

```
src/
├── _data/                         ← blog.json (27 posts), site.json, reviews.js, env.js
├── _includes/layouts/             ← base.njk, post.njk, app.njk (PWA), backoffice.njk
├── _includes/                     ← header, footer, head-meta, icon, blog-card, testimonials, booking-embed,
│                                    consent-banner, cta-valoracion, cta-seguimiento, cta-planificador,
│                                    onb-hint-medidas, onb-modal-medidas
├── index.njk, sobre-mi.njk, metodo.njk, testimonios.njk, preguntas-frecuentes.njk, 404.njk
├── menu-mensual-personalizado.njk, perdida-peso-sostenible.njk   ← landings de servicio
├── servicios.njk, empezar.njk, revision/                          ← redirects
├── blog/posts/                    ← 27 posts (.njk, solo contenido)
├── legal/                         ← privacidad, privacidad-seguimiento, aviso-legal, condiciones
├── seguimiento/, lead-magnet/     ← landing de la app y lead magnet
├── mi-seguimiento/                ← PWA de pacientes
├── backoffice/                    ← panel interno
├── css/, js/, fonts/, img/
├── sitemap.njk (genera sitemap.xml), feed.njk (genera feed.xml), robots.txt, llms.txt, humans.txt
```

## Blog: añadir post

1. Entrada en `blog.json` (slug, title, description, category, categoryLabel, urlCategory, date, image, imageAlt, featured)
2. Crear `src/blog/posts/{slug}.njk` con frontmatter + contenido HTML
3. Imagen en `src/img/blog/`, con el nombre de fichero que figure en el campo `image` (no tiene por qué coincidir con el slug)
4. O usar `/publicar-post` para automatizar desde Notion

## Reglas

- Identidad pública: se veta el título (`nutricionista`, `dietista`, `Técnica Superior en Dietética` sin "estudiante de") y las promesas de resultado con cifras, no el vocabulario del servicio. La lista de lo vetado y lo permitido está en la sección «Identidad pública» del CLAUDE.md raíz, y esa es la que manda
- Legal: cambios requieren confirmación de Cristina
- SEO: mantener title, description, ogImage en frontmatter. En el sitemap.xml los posts salen de blog.json; las páginas estáticas están escritas a mano en `src/sitemap.njk` (una página nueva hay que añadirla ahí)
- SEO: posts de recetas deben incluir JSON-LD Recipe inline. Todos los posts heredan BlogPosting + BreadcrumbList de post.njk
- Design system, bugs CSS → `../convenciones/negocio/web-tecnico.md`
- Tests obligatorios en cada cambio → `../convenciones/negocio/web-tests.md`
- Textos legales → `../convenciones/negocio/web-legal.md`

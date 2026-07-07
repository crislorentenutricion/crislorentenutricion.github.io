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
├── _data/blog.json, site.json     ← datos del blog (18 posts) y globales
├── _includes/layouts/             ← base.njk, page.njk, post.njk
├── _includes/                     ← header, footer, blog-card, cta-valoracion, head-meta
├── index.njk, sobre-mi.njk, 404.njk
├── blog/posts/                    ← 18 posts (.njk, solo contenido)
├── legal/                         ← privacidad, aviso-legal, condiciones
├── css/style.css, js/main.js, img/
├── sitemap.njk (genera sitemap.xml dinámico), robots.txt
```

## Blog: añadir post

1. Entrada en `blog.json` (slug, title, description, category, date, image)
2. Crear `src/blog/posts/{slug}.njk` con frontmatter + contenido HTML
3. Imagen en `src/img/blog/{slug}.jpg`
4. O usar `/publicar-post` para automatizar desde Notion

## Reglas

- Marca: "acompañamiento (educativo) en hábitos alimentarios" — regla dura post-reposicionamiento 2026-05-08: NUNCA "asesoría nutricional", "nutricionista", "dietista", "menú personalizado", "gramajes", "valoración gratuita" en copy público. Diccionario completo en el CLAUDE.md raíz del proyecto
- Legal: cambios requieren confirmación de Cristina
- SEO: mantener title, description, ogImage en frontmatter. El sitemap.xml se genera solo desde blog.json
- SEO: posts de recetas deben incluir JSON-LD Recipe inline. Todos los posts heredan BlogPosting + BreadcrumbList de post.njk
- Design system, bugs CSS → `../convenciones/negocio/web-tecnico.md`
- Tests obligatorios en cada cambio → `../convenciones/negocio/web-tests.md`
- Textos legales → `../convenciones/negocio/web-legal.md`

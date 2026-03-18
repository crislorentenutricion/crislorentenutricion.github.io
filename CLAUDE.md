# CLAUDE.md — Web Cris Lorente Nutrición

Sitio web de **Cris Lorente Nutrición** — 11ty (Eleventy) v3 + Nunjucks, desplegado en GitHub Pages via GitHub Actions.

> Convenciones completas de negocio, clínica, legal y SEO → `../convenciones/negocio/web-legal-seo.md`

## Workflow

1. Editar archivos en `src/` (NUNCA en `_site/`)
2. Previsualizar: `npx eleventy --serve --port=3000`
3. Solo con aprobación de Cristina → commit + push → web live en ~2 min

## Estructura

```
src/
├── _data/blog.json, site.json     ← datos del blog (18 posts) y globales
├── _includes/layouts/             ← base.njk, page.njk, post.njk
├── _includes/                     ← header, footer, blog-card, cta-valoracion, head-meta
├── index.njk, servicios.njk, sobre-mi.njk, 404.njk
├── blog/posts/                    ← 18 posts (.njk, solo contenido)
├── legal/                         ← privacidad, aviso-legal, condiciones
├── css/style.css, js/main.js, img/
├── sitemap.xml, robots.txt
```

## Blog: añadir post

1. Entrada en `blog.json` (slug, title, description, category, date, image)
2. Crear `src/blog/posts/{slug}.njk` con frontmatter + contenido HTML
3. Imagen en `src/img/blog/{slug}.jpg`
4. O usar `/publicar-post` para automatizar desde Notion

## Reglas

- Marca: "asesoría nutricional personalizada" (nunca "alimentaria")
- Legal: cambios requieren confirmación de Cristina
- SEO: mantener title, description, ogImage en frontmatter. Actualizar sitemap.xml
- Design system, bugs CSS, textos legales → ver `../convenciones/negocio/web-legal-seo.md`

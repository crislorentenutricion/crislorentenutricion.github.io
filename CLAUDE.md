# CLAUDE.md — Web Cris Lorente Nutrición

## Qué es este repo

Sitio web estático de **Cris Lorente Nutrición** alojado en GitHub Pages. Generado con **11ty (Eleventy) v3** a partir de templates Nunjucks en `src/`. El output es HTML estático servido desde la rama `gh-pages` via GitHub Actions.

> **Convenciones de negocio, clínica e integraciones** están en el directorio padre (`../`). Este CLAUDE.md solo cubre la gestión técnica de la web.

## Workflow de edición

```
editar src/**/*.njk o src/_data/*.json
  → commit + push a main
  → GitHub Actions: build 11ty → despliega _site/ a gh-pages
  → web live en ~2 min
```

**Regla**: los cambios se guardan como commit sin push para revisión de Cristina. Solo hacer push con su aprobación.

## Estructura de archivos

```
├── src/                            ← EDITAR AQUÍ
│   ├── _data/
│   │   ├── blog.json               ← "BD" del blog: 18 posts
│   │   └── site.json               ← datos globales (nombre, URL, redes)
│   ├── _includes/
│   │   ├── layouts/
│   │   │   ├── base.njk            ← HTML base (<html>, <head>, scripts)
│   │   │   ├── page.njk            ← layout para páginas normales
│   │   │   └── post.njk            ← layout para artículos de blog
│   │   ├── header.njk              ← navegación
│   │   ├── footer.njk              ← footer
│   │   ├── blog-card.njk           ← card de blog (homepage + index)
│   │   ├── cta-valoracion.njk      ← CTA "Reserva gratuita"
│   │   └── head-meta.njk           ← meta tags, OG, canonical
│   ├── index.njk                   ← Inicio
│   ├── servicios.njk               ← Servicios + FAQ + formulario
│   ├── sobre-mi.njk                ← Sobre mí
│   ├── 404.njk                     ← Error (permalink → /404.html)
│   ├── blog/
│   │   ├── index.njk               ← Hub "Aprende" (filtros por categoría)
│   │   └── posts/                  ← 18 posts (solo contenido, sin boilerplate)
│   ├── legal/
│   │   ├── privacidad.njk
│   │   ├── aviso-legal.njk
│   │   └── condiciones.njk
│   ├── css/style.css               ← Design system completo
│   ├── js/main.js                  ← Menú hamburguesa, nav activo, scroll
│   ├── img/                        ← Imágenes
│   ├── sitemap.xml                 ← Sitemap estático (actualizar al añadir páginas)
│   └── robots.txt
├── .eleventy.js                    ← Config 11ty (input: src, output: _site)
├── package.json                    ← Dependencia: @11ty/eleventy
├── .github/workflows/deploy.yml   ← CI/CD: build + deploy automático
└── _site/                          ← OUTPUT generado (gitignoreado)
```

## URLs generadas por 11ty

| Página | URL |
|--------|-----|
| Inicio | `/` |
| Servicios | `/servicios/` |
| Sobre mí | `/sobre-mi/` |
| Blog hub | `/blog/` |
| Post educación | `/blog/educacion/{slug}/` |
| Post CristiFood | `/blog/cristifood/{slug}/` |
| Post Bienestar | `/blog/bienestar/{slug}/` |
| Legal | `/legal/privacidad/`, `/legal/aviso-legal/`, `/legal/condiciones/` |

## Design system

### Paleta (CSS variables en `:root`)

```css
--color-green: #4a7c59;       /* marca, botones, acentos */
--color-green-dark: #3a6347;  /* hover */
--color-green-light: #f4f9f5; /* fondo plan destacado */
--color-cream: #f8f6f0;       /* fondo secciones alternas */
--color-white: #ffffff;
--color-black: #111111;
--color-gray: #6b7280;
--color-border: #e0ddd4;      /* bordes de tarjetas */
```

### Tipografía

- Fuente: `Manrope` (Google Fonts)
- Peso base: 400 (regular)
- Títulos: 600 (semibold)
- Line-height: 1.6 (texto), 1.2 (headings)

### Botones

| Tipo | Clase | Uso |
|------|-------|-----|
| Primario | `.btn-primary` | CTA principal (fondo verde, texto blanco, radius 30px) |
| Secundario | `.btn-secondary` | CTA secundario (outline verde) |

### Secciones

Alternar fondos blanco/crema para ritmo visual. Padding vertical: 80px (desktop) / 48px (móvil).

### Tarjetas

- Borde: `1px solid var(--color-border)`
- Radius: 12px, padding: 32px
- Sombra: `0 2px 8px rgba(0,0,0,0.04)`, hover: `0 4px 16px rgba(0,0,0,0.08)`

## Navegación

```
Inicio | Servicios | Sobre mí | Aprende (blog) | [botón] Reserva gratuita
```

El botón "Reserva gratuita" apunta a `/servicios/#formulario-contacto`.

## Blog: añadir un post nuevo

1. Añadir entrada a `src/_data/blog.json` (slug, title, description, category, date, image, imageAlt)
2. Crear `src/blog/posts/{slug}.njk` con frontmatter + contenido
3. Subir imagen a `src/img/blog/{slug}.jpg`
4. Commit + push → GitHub Actions genera y despliega

O usar la skill `/publicar-post` que automatiza todo desde Notion.

## SEO implementado

- Meta description + Open Graph + Twitter card en todas las páginas (via `head-meta.njk`)
- `<link rel="canonical">` dinámico via `{{ site.url }}{{ page.url }}`
- `sitemap.xml` con las 26 URLs del sitio
- `robots.txt`

**Al crear páginas nuevas**: añadir frontmatter `title`, `description` y actualizar `sitemap.xml`.

## Bugs CSS conocidos y fixes aplicados

**`.main-nav a` pisa el color de `.btn-primary`**
```css
.main-nav .btn-primary { color: var(--color-white); }
.main-nav .btn-primary:hover { color: var(--color-white); }
```

**Foto circular en Sobre mí no se centra en móvil**
```css
/* media query max-width: 900px */
.about-hero-inner img { margin: 0 auto; display: block; }
```

**Hero image necesita declaración explícita**
```css
.hero-image { display: block; }
.hero-image img { border-radius: 16px; width: 100%; height: 400px; object-fit: cover; object-position: top; display: block; }
```

## Textos legales

Cristina ha decidido **no incluir NIF ni dirección postal**. Los archivos de `legal/` tienen placeholders. No presionar para completarlos.

## Reglas para Claude

1. **Marca**: "asesoría nutricional personalizada" (nunca "alimentaria"). "Menú mensual" (nunca "de la semana").
2. **Tono**: cercano, empático, sin tecnicismos, sin juzgar.
3. **Legal**: cualquier cambio en textos legales requiere confirmación de Cristina.
4. **SEO**: mantener meta description y Open Graph en cada página nueva. Actualizar sitemap.xml.
5. **Convenciones completas**: para negocio, clínica, integraciones → consultar `../convenciones/`.

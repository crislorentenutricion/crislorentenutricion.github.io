# CLAUDE.md — Web Cris Lorente Nutrición

## Qué es este repo

Sitio web estático de **Cris Lorente Nutrición** alojado en GitHub Pages. HTML/CSS/JS puro, sin generador estático.

> **Convenciones de negocio, clínica e integraciones** están en el directorio padre (`../`). Este CLAUDE.md solo cubre la gestión técnica de la web.

## Workflow de edición

```bash
# editar archivo(s)
git add archivo.html css/style.css
git commit -m "descripción del cambio"
git push
# GitHub Pages se actualiza en ~1-2 minutos
```

**Regla**: los cambios en la web se guardan primero como commit sin push para revisión de Cristina antes de publicar. Solo hacer push con su aprobación.

## Estructura de archivos

```
├── index.html              # Inicio
├── servicios.html          # Servicios + FAQ + formulario de contacto
├── sobre-mi.html           # Sobre mí
├── blog/index.html         # Hub "Aprende" (3 categorías)
├── legal/
│   ├── privacidad.html     # Pendiente textos definitivos
│   ├── aviso-legal.html    # Pendiente textos definitivos
│   └── condiciones.html    # Pendiente textos definitivos
├── css/style.css           # Design system completo
├── js/main.js              # Menú hamburguesa, nav activo, scroll suave
├── img/
│   ├── cristina.jpg        # Foto lifestyle → INICIO
│   └── cristina-profesional.jpg  # Foto profesional → SOBRE MÍ
├── sitemap.xml
├── robots.txt
└── 404.html
```

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

El botón "Reserva gratuita" apunta a `servicios.html#formulario-contacto`.

## SEO implementado

- `<meta name="description">` en todas las páginas
- Open Graph (`og:title`, `og:description`, `og:image`, `og:url`)
- Twitter card en index.html
- `<link rel="canonical">` en todas las páginas
- `sitemap.xml` + `robots.txt`

**Al crear páginas nuevas**: mantener meta description y Open Graph.

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
4. **SEO**: mantener meta description y Open Graph en cada página nueva.
5. **Convenciones completas**: para negocio, clínica, integraciones → consultar `../convenciones/`.

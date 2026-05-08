# Copy alternativo — OPCIÓN B (pack cerrado de 3 meses)

> Este archivo contiene los bloques de copy listos para sustituir cuando se
> decida pasar de la OPCIÓN A (suscripción mensual 40 €/mes) a la OPCIÓN B
> (pack cerrado de 3 meses + mantenimiento opcional).
>
> **Antes de aplicar:** confirmar con Cris el precio del pack y el precio
> del mantenimiento posterior. Brief orientativo: 99-120 € pack + 30 €/mes
> mantenimiento. Sustituir `[€ PACK]` y `[€ MANTENIMIENTO]` por los valores
> reales antes de mergear.

---

## A. Plan card en `home` (sección de precios)

**Reemplazar el bloque actual `<div class="plan-card …">` por:**

```html
<h2 class="section-title reveal">Programa completo de 3 meses</h2>
<p class="section-subtitle reveal">Un proceso con principio y final claro. Después, mantenimiento opcional.</p>
<div class="plan-card-wrap">
  <div class="plan-card card plan-featured reveal">
    <h3>Plan completo</h3>
    <div class="plan-price"><span class="price">[€ PACK]</span><span class="period"> / 3 meses</span></div>
    <ul class="plan-features">
      <li>Programa estructurado en 3 fases (Cimientos · Construcción · Integración) durante 3 meses</li>
      <li>6 sesiones por videollamada (la primera, de 60-75 min, es gratuita y previa al alta en el programa)</li>
      <li>Material educativo semanal en mi app CLN — Mi Seguimiento</li>
      <li>Propuestas de comidas mensuales orientativas + lista de la compra</li>
      <li>Acompañamiento por WhatsApp (respuesta en 24h laborables)</li>
      <li>Plan personalizado de mantenimiento al finalizar el programa</li>
    </ul>
    <a href="#formulario-contacto" class="btn btn-primary btn-full plan-btn" data-plan="Programa completo de 3 meses">Reservar mi primera llamada gratuita&nbsp;→</a>
  </div>
</div>
```

Pago en un único cargo o fraccionado en 3 cuotas. Sin permanencia tras el programa: el mantenimiento posterior es opcional, a `[€ MANTENIMIENTO]/mes`.

---

## B. Hero de `home` — línea de pricing bajo el CTA

**Sustituir:**

```html
<p class="hero-price-hint"><strong>40 €/mes</strong> · Sin permanencia</p>
```

**Por:**

```html
<p class="hero-price-hint"><strong>[€ PACK]</strong> · Programa de 3 meses · Mantenimiento opcional después</p>
```

(Aplica también al CTA final del home, mismo cambio.)

---

## C. JSON-LD `ProfessionalService` en `home`

**`priceRange`:**
```json
"priceRange": "[€ PACK]"
```

**`hasOfferCatalog`:** sustituir el bloque actual por:

```json
"hasOfferCatalog": {
  "@type": "OfferCatalog",
  "name": "Programa completo de 3 meses",
  "itemListElement": [
    {
      "@type": "Offer",
      "name": "Programa completo de 3 meses",
      "price": "[€ PACK]",
      "priceCurrency": "EUR",
      "url": "https://www.crislorentenutricion.com/#formulario-contacto",
      "availability": "https://schema.org/InStock",
      "description": "Programa estructurado en 3 fases (Cimientos · Construcción · Integración). Incluye 6 sesiones, material educativo semanal, propuestas de comidas, lista de la compra, WhatsApp y plan de mantenimiento al finalizar."
    },
    {
      "@type": "Offer",
      "name": "Mantenimiento mensual (opcional, tras el programa)",
      "price": "[€ MANTENIMIENTO]",
      "priceCurrency": "EUR",
      "url": "https://www.crislorentenutricion.com/#formulario-contacto",
      "availability": "https://schema.org/InStock",
      "description": "Modalidad opcional al finalizar el programa de 3 meses. Sesiones más espaciadas y enfoque en consolidar lo aprendido."
    },
    {
      "@type": "Offer",
      "name": "Primera llamada gratuita",
      "price": "0",
      "priceCurrency": "EUR",
      "url": "https://www.crislorentenutricion.com/#formulario-contacto",
      "availability": "https://schema.org/InStock",
      "description": "Videollamada de 60-75 minutos sin compromiso para conocernos y ver si encajamos."
    }
  ]
}
```

---

## D. FAQ en `home`

### "¿Cuánto cuesta y hay permanencia?"

**HTML + JSON-LD:**

> El programa completo de 3 meses cuesta `[€ PACK]`, en un único pago o fraccionado en 3 cuotas mensuales. Sin permanencia tras el programa: el mantenimiento posterior es opcional, a `[€ MANTENIMIENTO]/mes`.

### "¿Qué pasa después de los 3 meses?"

> Tienes dos opciones. Una: continuar en modalidad mantenimiento opcional, a `[€ MANTENIMIENTO]/mes`, con sesiones más espaciadas. Dos: salir del programa con tu plan personalizado de mantenimiento. Sin presión y sin penalización en ninguno de los dos casos.

---

## E. `/metodo/` — sección "Qué incluye el programa"

Cambiar el último bullet:

- Opción A: `Sin permanencia: si decides no continuar, lo comunicas con 7 días de antelación`
- Opción B: `Sin permanencia tras el programa: el mantenimiento posterior es opcional`

---

## F. `booking-embed.njk` — `bookingPlan` por defecto

**Cambiar:**

```njk
value="{{ bookingPlan or 'Acompañamiento personalizado en hábitos' }}"
```

**Por:**

```njk
value="{{ bookingPlan or 'Programa completo de 3 meses' }}"
```

Y en el `index.njk`, el `{% set bookingPlan = "Acompañamiento personalizado en hábitos" %}` pasa a `{% set bookingPlan = "Programa completo de 3 meses" %}`.

**Importante:** actualizar también `tests/build-integrity.test.js` con el nuevo plan key esperado para `index.html`.

---

## G. Disclaimer de footer

No requiere cambios. El disclaimer ya está alineado con el brief 1 y es independiente del modelo comercial.

---

## Checklist de aplicación de la opción B

1. [ ] Confirmar con Cris precio del pack y precio del mantenimiento.
2. [ ] Sustituir todas las apariciones de `[€ PACK]` y `[€ MANTENIMIENTO]` en este archivo y en los archivos del repo.
3. [ ] Aplicar bloque A (plan card).
4. [ ] Aplicar bloque B (hero/CTA price hint).
5. [ ] Aplicar bloque C (JSON-LD).
6. [ ] Aplicar bloque D (FAQ home).
7. [ ] Aplicar bloque E (/metodo/ qué incluye).
8. [ ] Aplicar bloque F (bookingPlan + test).
9. [ ] Repasar landings `/perdida-peso-sostenible/` y `/menu-mensual-personalizado/` — pasar a la misma narrativa de pack si aún se mantienen.
10. [ ] Correr `npm test` y verificar visualmente.

// Cliente Supabase + auth-guard. Mismo patrón que /mi-seguimiento/empezar/.
// La revisión mensual vive dentro del perímetro auth del PWA: sin sesión la
// paciente vuelve al login de Mi Seguimiento.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = window.__MS_ENV__.supabaseUrl;
const SUPABASE_KEY = window.__MS_ENV__.supabasePublishableKey;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[revision] Supabase env vars vacías — submit no funcionará');
} else {
  const supa = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage }
  });
  window.supa = supa;

  // Primer nombre en Title Case para la pantalla de gracias ('tú' si no hay).
  // logic.js se carga antes que este módulo (ver revision.njk).
  function nombreGracias(nombre) {
    return window.MsLogic.primerNombre(nombre) || 'tú';
  }

  // Redacción del paso 2 para pacientes de plan base (menú de opciones):
  // reescribe textContent/placeholder de los elementos ya presentes en el
  // DOM. Los `name=` de los campos no cambian — los datos siguen siendo
  // comparables entre planes. Idempotente (se llama como mucho una vez,
  // pero no rompe si se llamara dos veces).
  function aplicarRedaccionBase() {
    const paso2 = document.querySelector('.onb-step[data-step="2"]');
    if (!paso2) return;
    paso2.dataset.title = 'Cómo te ha ido la semana';
    const h2 = paso2.querySelector('h2');
    if (h2) h2.textContent = 'Cómo te ha ido la semana';

    const labelAdherencia = paso2.querySelector('.onb-field label');
    if (labelAdherencia) {
      labelAdherencia.childNodes[0].textContent = '¿Cómo de fácil te está siendo llevar tu semana? ';
    }
    const spans = paso2.querySelectorAll('.onb-radios .onb-radio span');
    if (spans[0]) spans[0].textContent = 'Fácil — la llevo sin problema';
    if (spans[1]) spans[1].textContent = 'Regular — he tenido algún tropiezo';
    if (spans[2]) spans[2].textContent = 'Me está costando bastante';

    const labelDificultades = paso2.querySelector('label[for="f-dificultades"]');
    if (labelDificultades) labelDificultades.textContent = '¿Has tenido dificultades para organizar tus comidas? ¿Cuáles?';

    const labelPlatosNo = paso2.querySelector('label[for="f-platos-no"]');
    if (labelPlatosNo) labelPlatosNo.innerHTML = 'Opciones que <strong>no</strong> repetirías';
    const textareaPlatosNo = document.getElementById('f-platos-no');
    if (textareaPlatosNo) textareaPlatosNo.placeholder = 'Nómbralas si puedes — las quito de tus próximas opciones.';

    const labelPlatosSi = paso2.querySelector('label[for="f-platos-si"]');
    if (labelPlatosSi) labelPlatosSi.innerHTML = 'Opciones que <strong>sí</strong> repetirías';
    const textareaPlatosSi = document.getElementById('f-platos-si');
    if (textareaPlatosSi) textareaPlatosSi.placeholder = 'Las que repetirías sin dudar — las mantengo en tu rotación.';
  }

  supa.auth.onAuthStateChange(async (event, session) => {
    if (event !== 'INITIAL_SESSION') return;
    if (!session) {
      const gateMsg = document.querySelector('.onb-auth-gate-msg');
      if (gateMsg) gateMsg.textContent = 'Volvamos al login…';
      window.location.replace('/mi-seguimiento/');
      return;
    }

    // ¿Ya enviada la revisión para la próxima sesión? Si sí, saltamos
    // directamente a la pantalla de gracias — una vez enviada, no se
    // puede editar (decisión Cristina 2026-04-20). Evita dobles submits
    // y complejidad de manejo de updates.
    let yaEnviada = false;
    let firstName = '';
    try {
      const { data: pac } = await supa
        .from('pacientes')
        .select('id, nombre')
        .eq('email', session.user.email)
        .maybeSingle();
      if (pac && pac.id) {
        firstName = nombreGracias(pac.nombre);

        // Redacción del paso 2 según plan: mismo formulario para todas,
        // solo cambia el texto si el menú vigente es de plan base
        // (opciones/intercambiador) — detección sin flags, igual que la PWA.
        const menuTodayISO = window.MsLogic ? window.MsLogic.toISO(new Date()) : new Date().toISOString().slice(0, 10);
        const { data: menuVigente } = await supa
          .from('menus')
          .select('*')
          .eq('paciente_id', pac.id)
          .lte('vigente_desde', menuTodayISO)
          .order('vigente_desde', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (window.MsLogic && window.MsLogic.menuTieneOpciones(menuVigente)) aplicarRedaccionBase();

        const nowIso = new Date().toISOString();
        const { data: proxima } = await supa
          .from('sesiones')
          .select('id')
          .eq('paciente_id', pac.id)
          .gte('fecha', nowIso)
          .order('fecha', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (proxima && proxima.id) {
          const { data: rev } = await supa
            .from('revisiones')
            .select('id')
            .eq('sesion_id', proxima.id)
            .limit(1);
          yaEnviada = !!(rev && rev.length);
        }
      }
    } catch (e) {
      console.warn('[revision] chequeo yaEnviada falló, sigo al formulario', e);
    }

    const gate = document.getElementById('onb-auth-gate');
    const container = document.querySelector('.onb-container');
    if (gate) gate.hidden = true;
    if (container) {
      container.hidden = false;
      container.classList.add('onb-fade-in');
    }
    if (yaEnviada && typeof window.onbGoToThanks === 'function') {
      window.onbGoToThanks(firstName);
    }
  });

  // Expone el submit real al IIFE. Lanza si no hay sesión o si la paciente
  // no tiene fila en `pacientes`; el handler lo convierte en mensaje visible.
  window.onbSubmitRevision = async function(data) {
    const { data: sess } = await supa.auth.getSession();
    const session = sess && sess.session;
    if (!session || !session.user || !session.user.email) {
      throw new Error('Sin sesión activa');
    }

    // Resuelve paciente_id + nombre por email de sesión (la paciente no
    // los reescribe en el formulario).
    const { data: pac, error: pacErr } = await supa
      .from('pacientes')
      .select('id, nombre')
      .eq('email', session.user.email)
      .maybeSingle();
    if (pacErr) throw pacErr;
    if (!pac || !pac.id) throw new Error('Paciente no encontrado');

    // Inyecta identidad desde la sesión: el JSONB mantiene el mismo shape
    // (`contenido.nombre`, `contenido.email`) que el Google Form legacy.
    data.nombre = pac.nombre || '';
    data.email = session.user.email;

    // Resuelve próxima sesión futura (si existe): vincula la revisión con
    // la próxima cita para que el banner/modal de la home sepa que ya está
    // enviada. Si no hay sesión futura, sesion_id queda NULL (revisión
    // espontánea, admitida).
    const nowIso = new Date().toISOString();
    const { data: proxima, error: sesErr } = await supa
      .from('sesiones')
      .select('id')
      .eq('paciente_id', pac.id)
      .gte('fecha', nowIso)
      .order('fecha', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (sesErr) throw sesErr;

    const { error: insErr } = await supa
      .from('revisiones')
      .insert({
        paciente_id: pac.id,
        sesion_id: (proxima && proxima.id) || null,
        contenido: data
      });
    if (insErr) throw insErr;

    // Devuelve el primer nombre capitalizado para la pantalla de gracias.
    return { firstName: nombreGracias(pac.nombre) };
  };
}

// Cliente Supabase + auth-guard. Mismo patrón que /mi-seguimiento/app.js.
// La anamnesis vive dentro del perímetro auth del PWA: sin sesión la paciente
// vuelve al login de Mi Seguimiento.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = window.__MS_ENV__.supabaseUrl;
const SUPABASE_KEY = window.__MS_ENV__.supabasePublishableKey;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[empezar] Supabase env vars vacías — submit no funcionará');
} else {
  const supa = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage }
  });
  window.supa = supa;

  supa.auth.onAuthStateChange((event, session) => {
    if (event !== 'INITIAL_SESSION') return;
    if (!session) {
      const gateMsg = document.querySelector('.onb-auth-gate-msg');
      if (gateMsg) gateMsg.textContent = 'Volvamos al login…';
      window.location.replace('/mi-seguimiento/');
      return;
    }
    const gate = document.getElementById('onb-auth-gate');
    const container = document.querySelector('.onb-container');
    if (gate) gate.hidden = true;
    if (container) {
      container.hidden = false;
      container.classList.add('onb-fade-in');
    }
  });

  // Expone el submit real al IIFE. Lanza si no hay sesión; el handler lo
  // convierte en mensaje visible.
  window.onbSubmitAnamnesis = async function(data) {
    const { data: sess } = await supa.auth.getSession();
    const session = sess && sess.session;
    if (!session || !session.user || !session.user.email) {
      throw new Error('Sin sesión activa');
    }
    const { error } = await supa
      .from('pacientes')
      .update({
        anamnesis: data,
        anamnesis_completed_at: new Date().toISOString()
      })
      .eq('email', session.user.email);
    if (error) throw error;
  };
}

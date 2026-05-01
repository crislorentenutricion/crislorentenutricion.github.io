const supabaseUrl = process.env.SUPABASE_URL || '';

// URL de la Edge Function `lead-magnet-alta`. Por defecto la derivamos de
// SUPABASE_URL para no duplicar config; LEAD_MAGNET_ALTA_URL permite
// apuntar a otro deployment (p.ej. una función desplegada en otro project ref).
const leadMagnetAltaUrl = process.env.LEAD_MAGNET_ALTA_URL ||
  (supabaseUrl ? supabaseUrl.replace(/\/$/, '') + '/functions/v1/lead-magnet-alta' : '');

module.exports = {
  amplitudeApiKey: process.env.AMPLITUDE_API_KEY || '',
  supabaseUrl: supabaseUrl,
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
  // Edge Function de captura del lead magnet (planificador semanal).
  // Si el build no la tiene configurada, el bloque sigue renderizando pero
  // el POST se omite y se muestra mensaje de error genérico.
  leadMagnetAltaUrl: leadMagnetAltaUrl,
  // Tracking de ads — gated por consent banner. Sin IDs configurados, no se carga nada.
  metaPixelId: process.env.META_PIXEL_ID || '',
  googleAdsId: process.env.GOOGLE_ADS_ID || '',
  googleAdsConversionLabel: process.env.GOOGLE_ADS_CONVERSION_LABEL || '',
  // Backoffice interno — gate UX en cliente. La validación dura vive en
  // las policies RLS de Supabase (auth.email() = email de Cristina).
  cristinaEmail: process.env.CRISTINA_EMAIL || ''
};

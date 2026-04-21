module.exports = {
  amplitudeApiKey: process.env.AMPLITUDE_API_KEY || '',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
  // Tracking de ads — gated por consent banner. Sin IDs configurados, no se carga nada.
  metaPixelId: process.env.META_PIXEL_ID || '',
  googleAdsId: process.env.GOOGLE_ADS_ID || '',
  googleAdsConversionLabel: process.env.GOOGLE_ADS_CONVERSION_LABEL || ''
};

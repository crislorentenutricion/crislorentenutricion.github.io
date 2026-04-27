// Fuente única de las reseñas Google de CLN.
// Consumida por testimonios.njk (todas), index.njk y perdida-peso-sostenible.njk
// (las 2 primeras). La skill /sincronizar-resenas edita este fichero al añadir
// una reseña nueva.
//
// Campos por reseña:
//   - name           Nombre completo tal y como aparece en Google (autor en JSON-LD).
//   - displayName    Nombre corto para mostrar en la tarjeta (ej. "Jose Antonio N.").
//   - initial        Letra del avatar.
//   - datePublished  YYYY-MM-DD.
//   - rating         1-5.
//   - reviewBody     Texto íntegro de la reseña (JSON-LD reviewBody, sin truncar).
//   - displayText    Texto que se muestra en la tarjeta (puede acortarse con … final).

const googleProfileUrl = "https://www.google.com/search?sca_esv=ef5fb46a2a3e8e1b&q=Cris+Lorente+Nutrici%C3%B3n&si=AL3DRZEsmMGCryMMFSHJ3StBhOdZ2-6yYkXd_doETEE1OR-qOfCiWAAsw_ZH92LMOEtLNJidusS_EHqCeQWwVB-xdd21C9A9SN6Iej5W9VIhgAISrLobKPM%3D";

const reviews = [
  {
    name: "Valeria Geria Beltran",
    displayName: "Valeria G.",
    initial: "V",
    datePublished: "2026-04-23",
    rating: 5,
    reviewBody: "Super recomendada! Cristina es una gran profesional. Ha estado pendiente en todo momento de la evolución, y se ha mostrado muy flexible a la hora de adaptar los menús a las necesidades de cada persona.",
    displayText: "Super recomendada! Cristina es una gran profesional. Ha estado pendiente en todo momento de la evolución, y se ha mostrado muy flexible a la hora de adaptar los menús a las necesidades de cada persona."
  },
  {
    name: "Azu",
    displayName: "Azu",
    initial: "A",
    datePublished: "2026-04-09",
    rating: 5,
    reviewBody: "Sin lugar a duda es la mejor nutricionista que he podido tener. Me encanta los menús, me gusta mucho las combinaciones que pone o las opciones que da para no tener todas las semanas lo mismo y variar un poco. Para nada es estricta, no te pone restricciones a los alimentos, se adapta a ti y tus necesidades. Sin lugar a duda te recomendaría siempre.",
    displayText: "Sin lugar a duda es la mejor nutricionista que he podido tener. Me encanta los menús, las combinaciones que pone y las opciones que da para no tener todas las semanas lo mismo. Me siento tan bien y noto tantas mejorías... para nada es estricta, no te pone restricciones, se adapta a ti y tus necesidades. Sin lugar a duda te recomendaría siempre."
  },
  {
    name: "Jose Antonio Navarro Marco",
    displayName: "Jose Antonio N.",
    initial: "J",
    datePublished: "2026-04-01",
    rating: 5,
    reviewBody: "La mejor nutricionista online a la que he ido. Se adapta a mis preferencias y me ha ayudado a lograr mis objetivos. Normalmente me cuesta mucho perder peso por lo duras que son las dietas, pero con ella todo fue muy fácil. Recomendado 100%.",
    displayText: "La mejor nutricionista online a la que he ido. Se adapta a mis preferencias y me ha ayudado a lograr mis objetivos. Normalmente me cuesta mucho perder peso por lo duras que son las dietas, pero con ella todo fue muy fácil. Recomendado 100%."
  }
];

const reviewCount = reviews.length;
const ratingSum = reviews.reduce((s, r) => s + r.rating, 0);
const ratingAvg = ratingSum / reviewCount;
// Si todas son enteras y la media es entera, mostrar sin decimal ("5"); si no, 1 decimal ("4.7").
const ratingValue = Number.isInteger(ratingAvg) ? String(ratingAvg) : ratingAvg.toFixed(1);

module.exports = {
  googleProfileUrl,
  reviews,
  aggregateRating: {
    ratingValue,
    reviewCount,
    bestRating: "5",
    worstRating: "1"
  }
};

// Erfundene Flugdaten für die Tests: der Schirm dreht seinen Kurs DURCH DIE LUFT (Steuerkurs ψ),
// die Bewegung über Grund ergibt sich daraus plus Wind. So ist die Drehrate über Grund ungleichmässig wie im echten Flug.
"use strict";

// Reproduzierbarer Zufall (mulberry32) mit Normalverteilung (Box-Muller)
function zufall(seed) {
  let a = seed >>> 0;
  const u = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const normal = () => { let x = 0; while (x === 0) x = u(); return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * u()); };
  return { u, normal };
}

// Wind aus Stärke (km/h) und Herkunftsrichtung (°) → Vektor, in den er weht (m/s)
function windVektor(kmh, vonGrad) {
  const nach = (vonGrad + 180) * Math.PI / 180, v = kmh / 3.6;
  return { ost: v * Math.sin(nach), nord: v * Math.cos(nach) };
}

/* Flug aus Abschnitten simulieren.
   abschnitte: [{dauer (s), rate (°/s, + = rechts)}]; zwischen Abschnitten wird die Drehrate über rampeS linear umgestellt.
   opts: {hz, fluggeschwKmh, wind {ost, nord}, startKurs (Steuerkurs), rauschenGeschw (m/s, σ), rauschenKurs (°, σ),
          seed, steigen (m/s), startHoehe, t0, luecken [[von, bis]] (s, ohne Daten), geschwSchwankung (Anteil)} */
function simuliere(abschnitte, opts) {
  const o = Object.assign({ hz: 2, fluggeschwKmh: 34, wind: { ost: 0, nord: 0 }, startKurs: 0, rauschenGeschw: 0, rauschenKurs: 0,
                            seed: 1, steigen: 0, startHoehe: 1500, t0: 1000, luecken: [], rampeS: 1.5, geschwSchwankung: 0 }, opts);
  const z = zufall(o.seed);
  const dt = 1 / o.hz;
  const V = o.fluggeschwKmh / 3.6;
  const raten = [];
  let ges = 0;
  for (const a of abschnitte) { raten.push({ von: ges, bis: ges + a.dauer, rate: a.rate }); ges += a.dauer; }
  const rateUm = (t) => {
    // Rampe: in den ersten rampeS Sekunden eines Abschnitts von der vorigen Rate zur neuen
    for (let i = 0; i < raten.length; i++) {
      const r = raten[i];
      if (t >= r.von && t < r.bis) {
        const vor = i > 0 ? raten[i - 1].rate : r.rate;
        const f = o.rampeS > 0 ? Math.min(1, (t - r.von) / o.rampeS) : 1;
        return vor + (r.rate - vor) * f;
      }
    }
    return 0;
  };
  const out = [];
  let psi = o.startKurs, h = o.startHoehe;
  for (let k = 0; k * dt < ges - 1e-9; k++) {
    const t = k * dt;
    const tt = o.t0 + t;
    const v = V * (1 + o.geschwSchwankung * Math.sin(psi * Math.PI / 180 * 1));   // optional: Fahrtschwankung im Kreis
    const go = v * Math.sin(psi * Math.PI / 180) + o.wind.ost;
    const gn = v * Math.cos(psi * Math.PI / 180) + o.wind.nord;
    let g = Math.hypot(go, gn) + o.rauschenGeschw * z.normal();
    let kurs = Math.atan2(go, gn) * 180 / Math.PI + o.rauschenKurs * z.normal();
    if (g < 0) { g = -g; kurs += 180; }
    kurs = ((kurs % 360) + 360) % 360;
    const inLuecke = o.luecken.some(([a, b]) => t >= a && t < b);
    if (!inLuecke) out.push({ t: tt, kursGrad: kurs, geschwindigkeit: g, hoehe: h, wahr: { psi, ost: go, nord: gn } });
    psi = ((psi + rateUm(t) * dt) % 360 + 360) % 360;
    h += o.steigen * dt;
  }
  return out;
}

module.exports = { zufall, windVektor, simuliere };

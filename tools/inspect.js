// Monthly inspection: runs the real engine against the real scenario and reports only
// what changed or what needs a decision.
//
// Usage:  node tools/inspect.js entrada.json [--json]
//
// It computes NOTHING from prose and invents NOTHING. Every figure either comes out of
// runSim() or out of the input file, which the caller fills from Gastos and futuro_state.
// Three rules it exists to enforce, each one the fix for a real mistake:
//
//  ⚠ A Gastos total is a FLOW. It is never a cost basis, a valuation or a price. Those
//    come from the scenario or from the owner, and where neither has them the answer is
//    "no consta", never a number that looks close.
//  ⚠ Inputs are checked for freshness BEFORE anything is concluded from them. A stale
//    balance and a month cut short both produce confident, wrong readings.
//  ⚠ Silence is a finding too. A month with nothing to report must say so in one line.
const fs = require('fs');

const IN = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const W  = require('./harness.js')(IN.indexHtml);
const hoy = IN.today ? new Date(IN.today + 'T12:00:00Z') : new Date();

const money = v => (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
const dias  = iso => iso == null ? null : Math.floor((hoy - Date.parse(iso)) / 86400000);
const pct   = (a, b) => b ? Math.round((a / b - 1) * 1000) / 10 : null;

const checks = [];
// nivel: 'ok' nada que hacer · 'nota' para saber · 'atencion' requiere una decisión
const add = (nivel, titulo, detalle, datos) => checks.push({ nivel, titulo, detalle, datos });

// ── A. ¿Son confiables los insumos? ───────────────────────────────────────────
// Va primero a propósito. Un balance sin fecha y un mes de extractos cortado producen
// lecturas seguras de sí mismas y equivocadas; todo lo de abajo descansa en esto.
const sc = IN.scenario;
const asOf = sc.liquidAsOf || null;
const dAsOf = dias(asOf);
if (!asOf) {
  add('atencion', 'El efectivo no tiene fecha',
    `El plan está anclado a ${money(sc.liquidBase)} y nada registra de cuándo es. `
    + 'Sin fecha no se puede saber si envejeció: sincronizá IBKR.', { liquidBase: sc.liquidBase });
} else if (dAsOf > 30) {
  add('atencion', `El efectivo tiene ${dAsOf} días`,
    `${money(sc.liquidBase)} sincronizado el ${asOf.slice(0, 10)}. A más de un mes ya mueve la proyección.`,
    { dias: dAsOf });
} else if (dAsOf > 7) {
  add('nota', `El efectivo tiene ${dAsOf} días`, `${money(sc.liquidBase)}, del ${asOf.slice(0, 10)}.`, { dias: dAsOf });
} else {
  add('ok', 'Efectivo al día', `${money(sc.liquidBase)}, del ${asOf.slice(0, 10)}.`, { dias: dAsOf });
}

const meses = (IN.monthlyActuals || []).slice().sort((a, b) => a.ym < b.ym ? -1 : 1);
const completos = meses.filter(m => m.complete);
const ultimo = meses[meses.length - 1];
if (ultimo && !ultimo.complete) {
  add('nota', `Los extractos de ${ultimo.ym} están cortados`,
    `Último movimiento el ${ultimo.lastDay || '?'}. Ese mes no entra en ningún promedio: un mes `
    + 'incompleto no es un mes barato.', { ym: ultimo.ym });
}
if (IN.ibkrLive && IN.ibkrLive.at) {
  const d = dias(IN.ibkrLive.at);
  if (d > 3) add('nota', `El push de IB Gateway lleva ${d} días parado`,
    `Último valor en vivo ${money(IN.ibkrLive.net_liq)} del ${IN.ibkrLive.at.slice(0, 10)}. `
    + 'No afecta el plan (usa el balance diario), sí el número en vivo.', { dias: d });
}

// ── B. Costo de vida ──────────────────────────────────────────────────────────
// Media de los TRES últimos meses COMPLETOS contra lo que el plan supone. Nunca contra
// el mes en curso, que siempre va por la mitad.
const base = Math.round((sc.monthlyExpenses || 0) * (sc.expMultiplier || 1));
const u3 = completos.slice(-3);
if (u3.length === 3) {
  const media = Math.round(u3.reduce((s, m) => s + m.amount, 0) / 3);
  const dif = pct(media, base);
  const txt = `${u3.map(m => m.ym + ' ' + money(m.amount)).join(' · ')} → media ${money(media)} `
            + `contra ${money(base)} del plan (${dif > 0 ? '+' : ''}${dif}%).`;
  if (Math.abs(dif) >= 20) add('atencion', `Gastás ${dif > 0 ? 'más' : 'menos'} de lo que el plan supone`, txt, { media, base, dif });
  else if (Math.abs(dif) >= 10) add('nota', 'El costo de vida se corrió del plan', txt, { media, base, dif });
  else add('ok', 'Costo de vida en línea', txt, { media, base, dif });
} else {
  add('nota', 'Faltan meses completos para el promedio',
    `Hay ${completos.length} de los 3 que hacen falta.`, { completos: completos.length });
}

// ── C. Gasto sin clasificar ───────────────────────────────────────────────────
// No es prolijidad: lo que no tiene categoría se reparte a las obras, así que mueve el
// presupuesto de obra Y el costo de vida al mismo tiempo, en direcciones opuestas.
const sinCat = (IN.unfiled || []).slice(-3);
const totalSin = sinCat.reduce((s, m) => s + (m.amount || 0), 0);
if (totalSin > 0) {
  const peor = sinCat.slice().sort((a, b) => b.amount - a.amount)[0];
  const txt = `${money(totalSin)} en 3 meses sin categoría. El peor: ${peor.ym} con ${money(peor.amount)} `
            + `en ${peor.rows} filas. Eso se reparte entre las obras y no cuenta como costo de vida.`;
  add(totalSin > 15000 ? 'atencion' : 'nota', 'Gasto sin clasificar', txt, { total: totalSin });
}

// ── D. Obras ──────────────────────────────────────────────────────────────────
W.eval('_projectActuals = ' + JSON.stringify(IN.projectActuals || {}) + ';');
W.eval('S = ' + JSON.stringify(sc) + '; ensureFields();');
const obras = JSON.parse(W.eval('JSON.stringify(projectHeadroom())'));
const plan  = JSON.parse(W.eval('JSON.stringify(monthPlan())'));

for (const o of obras) {
  if (o.spent > o.budget) {
    add('atencion', `${o.name}: pasada de presupuesto`,
      `${money(o.spent)} gastados contra ${money(o.budget)} presupuestados (${money(o.spent - o.budget)} de más). `
      + 'Mientras siga así, el plan proyecta cero gasto futuro ahí.', o);
  } else if (!o.spends && o.remaining > 0) {
    add('atencion', `${o.name}: quedan ${money(o.remaining)} que el plan no gasta`,
      'Todas sus cuotas están fechadas antes de este mes, así que el motor no cobra nada más. '
      + 'Hay que mover la fecha de fin, no el presupuesto.', o);
  } else if (o.spends) {
    add('ok', `${o.name}: en curso`,
      `${money(o.spent)} de ${money(o.budget)} · faltan ${money(o.remaining)} · margen hasta romper el plan ${money(o.headroom)}.`, o);
  }
}

// ── E. Salud del plan ─────────────────────────────────────────────────────────
const salud = JSON.parse(W.eval(`(() => {
  const d = runSim();
  let min = Infinity, minAge = null;
  for (const m of d.monthly) if (m.liq < min) { min = m.liq; minAge = m.age + (m.mo - 1) / 12; }
  const last = d.monthly[d.monthly.length - 1];
  const mc  = runMonteCarlo(400, { seed: 42 });
  const mcf = runMonteCarlo(400, { seed: 42, flex: true });
  return JSON.stringify({ min: Math.round(min), minAge: +minAge.toFixed(1),
    finalNW: Math.round(last.liq + last.iliq),
    mc: mc.successRate ?? mc.success ?? mc.rate, mcFlex: mcf.successRate ?? mcf.success ?? mcf.rate });
})()`));

const prev = IN.previous || null;
const dMC  = prev && prev.mc != null ? salud.mc - prev.mc : null;
const dMin = prev && prev.min != null ? salud.min - prev.min : null;
let nivelPlan = 'ok';
if (salud.min < 0) nivelPlan = 'atencion';
else if (salud.mc < 75 || (dMC != null && dMC <= -5)) nivelPlan = 'atencion';
else if (dMC != null && dMC <= -2) nivelPlan = 'nota';
add(nivelPlan, 'El plan',
  `Piso de caja ${money(salud.min)} a los ${salud.minAge} · al final ${money(salud.finalNW)} · `
  + `${salud.mc}% de los mercados aguantan (${salud.mcFlex}% si adaptás el gasto)`
  + (dMC != null ? ` · contra el mes pasado: ${dMC > 0 ? '+' : ''}${dMC} pts, piso ${dMin > 0 ? '+' : ''}${money(dMin)}` : ''),
  salud);

// ── F. Defectos de datos ──────────────────────────────────────────────────────
// Afirmaciones sobre los datos del dueño, no sobre el motor. El self-test de index.html
// prueba el motor contra fixtures sintéticos; nadie prueba que el escenario real sea
// coherente consigo mismo. Cada una de estas ya se cobró una decisión mal tomada.
// ⚠ Agrupadas por DEFECTO, no por propiedad. Quince líneas diciendo lo mismo sobre
// quince activos no se leen, y lo que no se lee no avisa de nada.
const sinCosto = (sc.deals || []).filter(d => d.exit && d.exit.sellingCosts === 0).map(d => d.name);
if (sinCosto.length)
  add('atencion', `${sinCosto.length} propiedades venden sin costos de transacción`,
    `Un 0 explícito tapa el ${sc.sellCostRate}% global, así que el plan cobra las ventas enteras: `
    + sinCosto.join(', ') + '.', { deals: sinCosto });

const sinCompra = (sc.deals || [])
  .filter(d => d.exit && d.exit.type !== 'none' && d.acquiredFor == null).map(d => d.name);
if (sinCompra.length)
  add('nota', `${sinCompra.length} propiedades sin precio de compra`,
    'No consta qué se pagó por ellas, así que ningún retorno es calculable y cualquier cifra '
    + 'que aparezca está inventada: ' + sinCompra.join(', ') + '.', { deals: sinCompra });

const raros = [];
for (const e of sc.expenses || []) {
  if (e.type === 'oneoff' && e.installN)
    raros.push(`"${e.name}" es un pago único con campos de cuotas sin usar`);
  if (e.gastosCategory && !(IN.projectActuals || {})[e.gastosCategory.trim().toLowerCase()])
    raros.push(`"${e.name}" apunta a la categoría "${e.gastosCategory}", que no existe en Gastos`);
}
if (raros.length)
  add('nota', `${raros.length} gasto${raros.length > 1 ? 's' : ''} mal configurado${raros.length > 1 ? 's' : ''}`,
    raros.join(' · '), { raros });

// ── Salida ────────────────────────────────────────────────────────────────────
const orden = { atencion: 0, nota: 1, ok: 2 };
checks.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
const atencion = checks.filter(c => c.nivel === 'atencion');
const veredicto = atencion.length === 0
  ? 'Nada requiere tu atención este mes.'
  : `${atencion.length} cosa${atencion.length > 1 ? 's' : ''} para decidir.`;

const salida = { fecha: hoy.toISOString().slice(0, 10), escenario: IN.scenarioName || '?',
  veredicto, salud, mesActual: plan, checks };

if (process.argv.includes('--json')) { console.log(JSON.stringify(salida, null, 2)); process.exit(0); }
const icono = { atencion: '●', nota: '○', ok: '·' };
console.log(`\n${veredicto}   [escenario: ${salida.escenario}]\n`);
for (const c of checks) console.log(`${icono[c.nivel]} ${c.titulo}\n  ${c.detalle}\n`);

// Unit tests de BoUi.ejecutarEdgeFunction — wrapper sobre supa.functions.invoke.
//
// El helper sigue vivo en ui.js porque es infra compartida del backoffice;
// el detalle del paciente ya no lo invoca (todas sus acciones son copy-command
// desde 2026-04-24), pero futuras vistas pueden usarlo.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const BoUi = require("../src/backoffice/ui.js");

function _supaMock(invokeImpl) {
  const llamadas = [];
  return {
    llamadas: llamadas,
    functions: {
      invoke: async function (nombre, args) {
        llamadas.push({ nombre: nombre, args: args });
        return invokeImpl(nombre, args);
      }
    }
  };
}

test("ejecutarEdgeFunction: ok=true cuando supa devuelve data sin error", async () => {
  const supa = _supaMock(() => ({ data: { ok: true, draft_id: "r123" }, error: null }));
  const res = await BoUi.ejecutarEdgeFunction(supa, "enviar-menu", { paciente_id: "p1", menu_numero: 1 });
  assert.equal(res.ok, true);
  assert.equal(res.data.draft_id, "r123");
  assert.equal(supa.llamadas.length, 1);
  assert.equal(supa.llamadas[0].nombre, "enviar-menu");
  assert.deepEqual(supa.llamadas[0].args.body, { paciente_id: "p1", menu_numero: 1 });
});

test("ejecutarEdgeFunction: ok=false cuando supa devuelve error HTTP", async () => {
  const supa = _supaMock(() => ({
    data: null,
    error: { message: "FunctionsHttpError: 500", status: 500 }
  }));
  const res = await BoUi.ejecutarEdgeFunction(supa, "cerrar-paciente", { paciente_id: "p1", motivo: "abandono" });
  assert.equal(res.ok, false);
  assert.equal(res.error.type, "http");
  assert.match(res.error.message, /FunctionsHttpError/);
});

test("ejecutarEdgeFunction: ok=false cuando el body trae ok=false (app error)", async () => {
  const supa = _supaMock(() => ({ data: { ok: false, error: "paciente_no_existe" }, error: null }));
  const res = await BoUi.ejecutarEdgeFunction(supa, "repescar-paciente", { paciente_id: "p1" });
  assert.equal(res.ok, false);
  assert.equal(res.error.type, "app");
  assert.equal(res.error.message, "paciente_no_existe");
});

test("ejecutarEdgeFunction: ok=false cuando invoke lanza (red caída)", async () => {
  const supa = _supaMock(() => { throw new Error("fetch failed"); });
  const res = await BoUi.ejecutarEdgeFunction(supa, "reagendar", { calendar_event_id: "x" });
  assert.equal(res.ok, false);
  assert.equal(res.error.type, "network");
  assert.match(res.error.message, /fetch failed/);
});

test("ejecutarEdgeFunction: devuelve error app si falta supa.functions.invoke", async () => {
  const res = await BoUi.ejecutarEdgeFunction({}, "reagendar", {});
  assert.equal(res.ok, false);
  assert.equal(res.error.type, "app");
});

test("ejecutarEdgeFunction: devuelve error app si falta nombre", async () => {
  const supa = _supaMock(() => ({ data: { ok: true }, error: null }));
  const res = await BoUi.ejecutarEdgeFunction(supa, "", {});
  assert.equal(res.ok, false);
  assert.equal(res.error.type, "app");
});

// htmlwidgets binding. All logic lives in the bundled app (lib/app/widget.js,
// built from web/ with `npm run build:widget`); this file only hands it the payload.
//
// R sends the study as JSON text (x.spec_json) so jsonlite's simplification can't turn
// one-element arrays into scalars on the way.
(function () {
  var instances = {};

  function payload(el, x) {
    var config = { outputId: x.outputId || el.id || null, relay: x.relay || null, spec: null };
    if (typeof x.spec_json === 'string' && x.spec_json.length) config.spec = JSON.parse(x.spec_json);
    return config;
  }

  HTMLWidgets.widget({
    name: 'dataManual',
    type: 'output',
    factory: function (el) {
      return {
        renderValue: function (x) {
          instances[el.id] = { el: el, x: x };
          DataManual.render(el, payload(el, x));
        },
        resize: function () {},
      };
    },
  });

  // updateDataManual(session, outputId, spec): load a new study into a running widget.
  if (window.Shiny && Shiny.addCustomMessageHandler) {
    Shiny.addCustomMessageHandler('datamanual-update', function (msg) {
      var inst = instances[msg.id];
      if (!inst) return;
      inst.x = Object.assign({}, inst.x, { spec_json: msg.spec_json });
      DataManual.render(inst.el, payload(inst.el, inst.x));
    });
  }
})();

// htmlwidgets binding. All logic lives in the bundled app (lib/app/widget.js,
// built from web/ with `npm run build:widget`); this file only hands it the payload.
HTMLWidgets.widget({
  name: 'dataManual',
  type: 'output',
  factory: function (el) {
    return {
      renderValue: function (x) {
        if (!x.outputId && el.id) x.outputId = el.id;
        DataManual.render(el, x);
      },
      resize: function () {},
    };
  },
});

import { setHostEndpoint } from '../connectors/host';
import type { HostAdapter } from './types';

/** Payload sent from R by htmlwidgets::createWidget(x = ...). */
export interface WidgetConfig {
  spec?: unknown;
  /** Shiny output id; when set, spec changes are sent back as input$<outputId>_spec. */
  outputId?: string | null;
  /** Session-scoped URL where the R package answers saved-key and API-relay requests. */
  relay?: string | null;
}

interface ShinyGlobal {
  setInputValue(name: string, value: unknown, opts?: { priority?: 'event' }): void;
}

export function createWidgetAdapter(config: WidgetConfig): HostAdapter {
  const shiny = (globalThis as { Shiny?: ShinyGlobal }).Shiny;
  setHostEndpoint(config.relay ?? null);
  return {
    kind: 'widget',
    initialSpec: config.spec ?? null,
    onSpecChange(spec) {
      if (shiny && config.outputId) {
        // Sent as JSON text with the "datamanual.spec" input handler (registered by the R package),
        // which parses it without simplifying, so one-element arrays stay arrays in R.
        shiny.setInputValue(`${config.outputId}_spec:datamanual.spec`, spec ? JSON.stringify(spec) : null, { priority: 'event' });
      }
    },
  };
}

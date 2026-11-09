import type { HostAdapter } from './types';

/** Payload sent from R by htmlwidgets::createWidget(x = ...). */
export interface WidgetConfig {
  spec?: unknown;
  /** Shiny output id; when set, spec changes are sent back as input$<outputId>_spec. */
  outputId?: string | null;
}

interface ShinyGlobal {
  setInputValue(name: string, value: unknown, opts?: { priority?: 'event' }): void;
}

export function createWidgetAdapter(config: WidgetConfig): HostAdapter {
  const shiny = (globalThis as { Shiny?: ShinyGlobal }).Shiny;
  return {
    kind: 'widget',
    initialSpec: config.spec ?? null,
    onSpecChange(spec) {
      if (shiny && config.outputId) {
        shiny.setInputValue(`${config.outputId}_spec`, spec, { priority: 'event' });
      }
    },
  };
}

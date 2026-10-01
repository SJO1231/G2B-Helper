import { renderTemplate } from '../../plugins/template/index';

export function renderTextTemplate(body: string, values: Record<string, unknown>): string {
  return renderTemplate(body, values).text;
}

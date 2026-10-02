export function setIcon(button: HTMLButtonElement, kind: 'settings' | 'close' | 'save' | 'collapse' | 'add' | 'up' | 'down', label: string): void {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', {
    settings: 'M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4M12.5 8a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0M10 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
    close: 'M4 4l8 8M12 4l-8 8', save: 'M2.5 2.5h9l2 2v9h-11ZM5 2.5v4h6v-4M5 13.5v-4h6v4',
    collapse: 'M3 8h10', add: 'M3 8h10M8 3v10', up: 'M4 10l4-4 4 4', down: 'M4 6l4 4 4-4',
  }[kind]);
  svg.append(path); button.replaceChildren(svg); button.classList.add('icon-button');
  button.title = label; button.setAttribute('aria-label', label);
}

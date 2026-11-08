export interface ActionChipSpec {
  text: string;
  className: string;
  act?: string;
  id?: string;
  treated?: boolean;
  onClick: () => void;
}

export interface RerollControlOpts {
  selectedCount: number;
  punished?: boolean;
  onClick: () => void;
}

export function renderRerollButton(opts: RerollControlOpts): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-reroll';
  b.dataset.act = 'reroll';
  b.textContent = opts.punished
    ? `重掷选中(${opts.selectedCount})（将受 ${opts.selectedCount} 点真实伤害）`
    : `重掷选中(${opts.selectedCount})`;
  if (opts.punished) b.title = '「凛冽之音」生效中：重掷多少颗，被重掷方就受到多少点真实伤害';
  b.disabled = opts.selectedCount === 0;
  b.addEventListener('click', opts.onClick);
  return b;
}

export function renderChipRow(leadText: string, chips: ActionChipSpec[], tailText = ''): HTMLElement {
  const row = document.createElement('div');
  row.className = 'actionlist-chips';
  const lead = document.createElement('span');
  lead.className = 'chip-label';
  lead.textContent = leadText;
  row.appendChild(lead);
  for (const spec of chips) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = spec.className;
    if (spec.act) chip.dataset.act = spec.act;
    if (spec.id) chip.dataset.id = spec.id;
    if (spec.treated) chip.dataset.treated = '1';
    chip.textContent = spec.text;
    chip.addEventListener('click', spec.onClick);
    row.appendChild(chip);
  }
  if (tailText) {
    const tail = document.createElement('span');
    tail.className = 'chip-label';
    tail.textContent = tailText;
    row.appendChild(tail);
  }
  return row;
}

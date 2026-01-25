let customSelectListenerAttached = false;

export function enhanceCustomSelects(root: ParentNode = document): void {
    const selects = Array.from(root.querySelectorAll('select.input')) as HTMLSelectElement[];
    selects.forEach((select) => {
        if (select.dataset.customSelect === 'true') return;
        createCustomSelect(select);
    });

    if (!customSelectListenerAttached) {
        document.addEventListener('click', (event) => {
            const target = event.target as HTMLElement | null;
            if (target && target.closest('.custom-select')) return;
            closeAllSelects();
        });
        customSelectListenerAttached = true;
    }
}

function createCustomSelect(select: HTMLSelectElement): void {
    select.dataset.customSelect = 'true';
    select.classList.add('custom-select-native');

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';
    wrapper.dataset.for = select.id || '';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const value = document.createElement('span');
    value.className = 'custom-select-value';
    trigger.appendChild(value);

    const arrow = document.createElement('span');
    arrow.className = 'custom-select-arrow';
    arrow.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
    trigger.appendChild(arrow);

    const menu = document.createElement('div');
    menu.className = 'custom-select-menu';
    menu.setAttribute('role', 'listbox');

    const options = Array.from(select.options);
    options.forEach((option) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'custom-select-option';
        item.dataset.value = option.value;
        item.textContent = option.textContent || option.value;
        if (option.disabled) {
            item.disabled = true;
            item.classList.add('is-disabled');
        }
        if (option.selected) {
            item.classList.add('is-selected');
        }
        menu.appendChild(item);
    });

    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);

    select.insertAdjacentElement('afterend', wrapper);

    if (select.disabled) {
        wrapper.classList.add('is-disabled');
        trigger.disabled = true;
    }

    const updateValue = () => {
        const selectedOption = select.selectedOptions[0] || select.options[select.selectedIndex];
        value.textContent = selectedOption ? selectedOption.textContent || selectedOption.value : '';
        menu.querySelectorAll('.custom-select-option').forEach((optionEl) => {
            optionEl.classList.toggle('is-selected', optionEl.getAttribute('data-value') === select.value);
        });
    };

    updateValue();

    trigger.addEventListener('click', () => {
        if (select.disabled) return;
        const isOpen = wrapper.classList.contains('open');
        closeAllSelects();
        if (!isOpen) {
            wrapper.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
        }
    });

    menu.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | null;
        const optionEl = target?.closest('.custom-select-option') as HTMLButtonElement | null;
        if (!optionEl || optionEl.disabled) return;
        const value = optionEl.dataset.value ?? '';
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        updateValue();
        wrapper.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
    });

    select.addEventListener('change', updateValue);
}

function closeAllSelects(): void {
    document.querySelectorAll('.custom-select.open').forEach((el) => {
        el.classList.remove('open');
        const trigger = el.querySelector<HTMLElement>('.custom-select-trigger');
        if (trigger) {
            trigger.setAttribute('aria-expanded', 'false');
        }
    });
}

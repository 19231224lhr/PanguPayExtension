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
            openSelect(wrapper, trigger);
        }
    });

    trigger.addEventListener('keydown', (event) => {
        if (select.disabled) return;
        const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('.custom-select-option:not(:disabled)'));
        const selectedIndex = Math.max(0, items.findIndex((item) => item.dataset.value === select.value));

        if (event.key === 'Escape') {
            closeAllSelects();
            trigger.focus();
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (wrapper.classList.contains('open')) {
                const active = document.activeElement as HTMLButtonElement | null;
                const option = active?.classList.contains('custom-select-option') ? active : items[selectedIndex];
                if (option) {
                    chooseOption(option, select, wrapper, trigger, updateValue);
                }
            } else {
                openSelect(wrapper, trigger);
                items[selectedIndex]?.focus();
            }
            return;
        }

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!wrapper.classList.contains('open')) {
                openSelect(wrapper, trigger);
            }
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = (selectedIndex + direction + items.length) % items.length;
            items[nextIndex]?.focus();
        }
    });

    menu.addEventListener('keydown', (event) => {
        const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('.custom-select-option:not(:disabled)'));
        const current = document.activeElement as HTMLButtonElement | null;
        const currentIndex = Math.max(0, items.indexOf(current as HTMLButtonElement));

        if (event.key === 'Escape') {
            event.preventDefault();
            closeAllSelects();
            trigger.focus();
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (current?.classList.contains('custom-select-option')) {
                chooseOption(current, select, wrapper, trigger, updateValue);
            }
            return;
        }

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = (currentIndex + direction + items.length) % items.length;
            items[nextIndex]?.focus();
        }
    });

    menu.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | null;
        const optionEl = target?.closest('.custom-select-option') as HTMLButtonElement | null;
        if (!optionEl || optionEl.disabled) return;
        chooseOption(optionEl, select, wrapper, trigger, updateValue);
    });

    select.addEventListener('change', updateValue);
}

function openSelect(wrapper: HTMLElement, trigger: HTMLElement): void {
    closeAllSelects();
    wrapper.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
}

function chooseOption(
    optionEl: HTMLButtonElement,
    select: HTMLSelectElement,
    wrapper: HTMLElement,
    trigger: HTMLElement,
    updateValue: () => void
): void {
    const value = optionEl.dataset.value ?? '';
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    updateValue();
    wrapper.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
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

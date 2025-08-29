export class UIControls {
    private rootElement: HTMLElement;

    constructor(rootElement: HTMLElement) {
        this.rootElement = rootElement;
    }

    private storeValue(key: string, value: string) {
        localStorage.setItem(key, value);
    }

    private loadValue(key: string, defaultValue: string): string {
        return localStorage.getItem(key) || defaultValue;
    }

    public addInput(
        labelText: string,
        inputType: string,
        defaultValue: string,
        onChange: (value: string) => void
    ): string {
        const div = document.createElement('div');
        const label = document.createElement('label');
        label.textContent = labelText;
        const input = document.createElement('input');
        input.type = inputType;
        input.value = this.loadValue(labelText, defaultValue);
        input.oninput = (ev) => {
            const newValue = (ev.target as HTMLInputElement).value;
            this.storeValue(labelText, newValue);
            onChange(newValue);
        };
        div.appendChild(label);
        div.appendChild(input);
        this.rootElement.appendChild(div);

        return input.value;
    }

    public addButton(buttonText: string, onClick: () => void) {
        const button = document.createElement('button');
        button.textContent = buttonText;
        button.onclick = onClick;
        this.rootElement.appendChild(button);

        return button;
    }

    public addCheckbox(
        labelText: string,
        defaultChecked: boolean,
        onChange: (checked: boolean) => void
    ): boolean {
        const div = document.createElement('div');
        const label = document.createElement('label');
        label.textContent = labelText;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked =
            this.loadValue(labelText, defaultChecked.toString()) === 'true';
        checkbox.onchange = (ev) => {
            const checked = (ev.target as HTMLInputElement).checked;
            this.storeValue(labelText, checked.toString());
            onChange(checked);
        };
        div.appendChild(label);
        div.appendChild(checkbox);
        this.rootElement.appendChild(div);

        return checkbox.checked;
    }

    public addSelect(
        labelText: string,
        options: string[],
        defaultValue: string,
        onChange: (value: string) => void
    ): string {
        const div = document.createElement('div');
        const label = document.createElement('label');
        label.textContent = labelText;
        const select = document.createElement('select');
        const value = this.loadValue(labelText, defaultValue);
        for (const optionText of options) {
            const option = document.createElement('option');
            option.value = optionText;
            option.textContent = optionText;
            if (optionText === value) {
                option.selected = true;
            }
            select.appendChild(option);
        }
        select.onchange = (ev) => {
            const newValue = (ev.target as HTMLSelectElement).value;
            this.storeValue(labelText, newValue);
            onChange(newValue);
        };
        div.appendChild(label);
        div.appendChild(select);
        this.rootElement.appendChild(div);

        return value;
    }
}

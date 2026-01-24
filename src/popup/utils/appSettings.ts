import { getSettings, type ExtensionSettings } from '../../core/storage';

export function getActiveLanguage(): ExtensionSettings['language'] {
    return document.documentElement.dataset.lang === 'en' ? 'en' : 'zh-CN';
}

export function applyTheme(theme: ExtensionSettings['theme']): void {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
}

export function applyLanguage(language: ExtensionSettings['language']): void {
    const root = document.documentElement;
    root.dataset.lang = language;
    root.lang = language === 'en' ? 'en' : 'zh-CN';
}

export function applySettings(settings: ExtensionSettings): void {
    applyTheme(settings.theme);
    applyLanguage(settings.language);
}

export async function applyStoredSettings(): Promise<void> {
    const settings = await getSettings();
    applySettings(settings);
}

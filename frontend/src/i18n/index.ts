import en from './en';
import zh from './zh';

export type Locale = 'en' | 'zh';

export const dictionaries: Record<Locale, Record<string, string>> = { en, zh };

export { en, zh };

export const ACCENTS: { key: string; label: string; light: string; dark: string }[] = [
  { key: 'blue', label: 'Blue', light: '#2f6bf0', dark: '#4f8bff' },
  { key: 'indigo', label: 'Indigo', light: '#5b4fe0', dark: '#8378ff' },
  { key: 'teal', label: 'Teal', light: '#0f8f86', dark: '#2bb8ac' },
  { key: 'green', label: 'Green', light: '#2c8a4b', dark: '#45b36b' },
  { key: 'amber', label: 'Amber', light: '#b8740f', dark: '#e3a13c' },
  { key: 'rose', label: 'Rose', light: '#cc3d68', dark: '#f06a92' },
  { key: 'graphite', label: 'Graphite', light: '#56565e', dark: '#9d9da7' }
]

export function accentColor(key: string, dark: boolean): string {
  const a = ACCENTS.find((x) => x.key === key) ?? ACCENTS[0]
  return dark ? a.dark : a.light
}

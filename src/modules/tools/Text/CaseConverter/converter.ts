
export type ConversionMode = 'uppercase' | 'lowercase' | 'snake' | 'camel' | 'Camel' | 'firstUpper' | 'firstLower';

export function convertText(text: string, mode: ConversionMode): string {
    switch (mode) {
        case 'uppercase':
            return text.toUpperCase();
        case 'lowercase':
            return text.toLowerCase();
        case 'firstUpper':
            return text.replace(/(^|[\s-_]+)([a-zA-Z])([a-zA-Z]*)/g, (_, sep, first, rest) => {
                return sep + first.toUpperCase() + rest.toLowerCase();
            })
        case 'firstLower':
            return text.replace(/(^|[\s-_]+)([a-zA-Z])([a-zA-Z]*)/g, (_, sep, first, rest) => {
                return sep + first.toLowerCase() + rest.toUpperCase();
            })
        case 'Camel':
            return text.split(/[\s-_]+/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('');
        case 'camel':
            return text.split(/[\s-_]+/).map((word, index) => {
                if (index === 0) return word.toLowerCase();
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            }).join('');
        case 'snake':
            return text.split(/[\s-_]+/).map(word => word.toLowerCase()).join('_');
        default:
            return text;
    }
}
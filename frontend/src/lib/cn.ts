/**
 * Tiny class-name joiner — filters out falsy values so conditional classes
 * read cleanly: cn('base', isActive && 'active', disabled && 'opacity-50').
 * No dependency; we don't need full tailwind-merge for our usage.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

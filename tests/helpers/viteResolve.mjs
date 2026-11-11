// Test-only module hooks so Node can load src/lib files the way Vite does: extensionless relative imports get .js/.jsx added,
// and the browser Supabase client (src/lib/supabase.js, which needs Vite's env) is replaced by an empty stub.
// Use: import { register } from 'node:module'; register('./helpers/viteResolve.mjs', import.meta.url)   (before importing src files)
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if (/(^|\/)supabase(\.js)?$/.test(specifier) && specifier.startsWith('.') && context.parentURL?.includes('/src/')) {
    return { url: 'data:text/javascript,export const supabase = {}', shortCircuit: true }
  }
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.startsWith('file:')) {
    for (const ext of ['.js', '.jsx']) {
      const url = new URL(specifier + ext, context.parentURL)
      if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
    }
  }
  return nextResolve(specifier, context)
}

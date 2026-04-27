import type { WebSearchProvider, WebSearchResult, SearchOptions } from './types'
import { exaProvider } from './providers/exa'

export type { WebSearchResult, SearchOptions }

const PROVIDERS: Record<string, WebSearchProvider> = {
  exa: exaProvider,
}

export function getWebSearchProvider(id: string): WebSearchProvider | null {
  return PROVIDERS[id] ?? null
}

export function listWebSearchProviders(): Array<{ id: string; name: string }> {
  return Object.values(PROVIDERS).map(p => ({ id: p.id, name: p.name }))
}

export async function performSearch(
  providerId: string,
  apiKey: string,
  query: string,
  options: SearchOptions = {},
): Promise<WebSearchResult[]> {
  const provider = PROVIDERS[providerId]
  if (!provider) throw new Error(`Unknown web search provider: ${providerId}`)
  return provider.search(query, apiKey, options)
}

export function formatSearchResultsForContext(results: WebSearchResult[], query: string): string {
  if (results.length === 0) return ''
  const lines = results.map((r, i) =>
    `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.snippet}`,
  )
  return `[联网搜索结果 / Web Search Results for: "${query}"]\n\n${lines.join('\n\n')}\n\n---\n请参考以上搜索结果回答用户的问题。/ Please use the above search results to answer the user's question.`
}

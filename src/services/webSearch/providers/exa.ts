import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import type { WebSearchProvider, WebSearchResult, SearchOptions } from '../types'

export interface ExaSearchOptions extends SearchOptions {
  searchType?: 'auto' | 'fast' | 'deep'
}

interface ExaHighlight {
  text?: string
  score?: number
}

interface ExaResult {
  title?: string
  url?: string
  publishedDate?: string
  highlights?: ExaHighlight[] | string[]
  text?: string
}

interface ExaResponse {
  results?: ExaResult[]
}

export const exaProvider: WebSearchProvider = {
  id: 'exa',
  name: 'Exa',

  async search(query: string, apiKey: string, options: ExaSearchOptions = {}): Promise<WebSearchResult[]> {
    const { numResults = 5, searchType = 'auto' } = options

    const resp = await tauriFetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        type: searchType,
        numResults,
        contents: {
          highlights: { maxCharacters: 800 },
        },
      }),
    })

    if (!resp.ok) {
      throw new Error(`Exa API error ${resp.status}`)
    }

    const data = await resp.json() as ExaResponse
    return (data.results ?? []).map(r => {
      const hlArr = r.highlights ?? []
      const snippet = hlArr.length > 0
        ? (typeof hlArr[0] === 'string' ? hlArr[0] : (hlArr[0] as ExaHighlight).text ?? '')
        : (r.text?.slice(0, 400) ?? '')
      return {
        title: r.title ?? '',
        url: r.url ?? '',
        snippet,
        publishedDate: r.publishedDate,
      }
    })
  },
}

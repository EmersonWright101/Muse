export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  publishedDate?: string
}

export interface SearchOptions {
  numResults?: number
  [key: string]: unknown
}

export interface WebSearchProvider {
  readonly id: string
  readonly name: string
  search(query: string, apiKey: string, options: SearchOptions): Promise<WebSearchResult[]>
}

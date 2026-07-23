import { readFile } from 'node:fs/promises'
import { render, screen } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'

vi.mock('../src/components/Chart', () => ({
  Chart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}))

class WorkerMock {
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage() {}
  terminate() {}
}

globalThis.Worker = WorkerMock as unknown as typeof Worker

describe('App', () => {
  beforeEach(() => {
    window.location.hash = '#/'
    vi.restoreAllMocks()
  })

  it('shows the immediate bundled-SPY comparison and local-only promise', async () => {
    const [prices, rates] = await Promise.all([
      readFile('public/data/spy.json', 'utf8'),
      readFile('public/data/treasury-3m.json', 'utf8'),
    ])
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(prices))
      .mockResolvedValueOnce(new Response(rates))
    render(<HashRouter><App /></HashRouter>)
    expect(await screen.findByRole('heading', { name: /finished ahead/ }, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.getByText('All calculations run locally in your browser.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy share link' })).toBeEnabled()
  }, 15_000)

  it('renders the methodology route with provenance and advice disclosures', () => {
    window.location.hash = '#/methodology'
    render(<HashRouter><App /></HashRouter>)
    expect(screen.getByRole('heading', { name: 'The rules behind every result.' })).toBeInTheDocument()
    expect(screen.getByText('Educational only—not investment advice.')).toBeInTheDocument()
    expect(screen.getByText(/selection and survivorship bias/i)).toBeInTheDocument()
  })
})

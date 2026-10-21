// Lot EP (EP2): the invite link is origin + "/#earn?ref=CODE", nothing else.
import { describe, expect, it } from 'vitest'
import { inviteLink } from './inviteLink'

describe('inviteLink', () => {
  it('builds the production link from the origin only', () => {
    expect(inviteLink('https://stellar.getdig.ai', 'PQMUUPW7')).toBe('https://stellar.getdig.ai/#earn?ref=PQMUUPW7')
  })

  it('works for the local dev origin and tolerates a trailing slash', () => {
    expect(inviteLink('http://localhost:5173', 'ABCDEFGH')).toBe('http://localhost:5173/#earn?ref=ABCDEFGH')
    expect(inviteLink('http://localhost:5173/', 'ABCDEFGH')).toBe('http://localhost:5173/#earn?ref=ABCDEFGH')
  })

  it('never carries a pathname: only the origin is used', () => {
    // A caller passing a full URL by mistake would be wrong; the function takes an origin.
    const link = inviteLink('https://stellar.getdig.ai', 'ABCDEFGH')
    expect(new URL(link).pathname).toBe('/')
    expect(new URL(link).hash).toBe('#earn?ref=ABCDEFGH')
  })
})

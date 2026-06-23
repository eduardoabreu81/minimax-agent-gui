// ContextProvider.test.jsx — covers the modal state hook.
//
// The provider is a thin wrapper around useState; the only real
// assertion worth making is that useContextModal() throws if used
// outside the provider (so devs catch mis-mounts in tests). The
// full modal flow is covered by the integration tests in
// OnboardingWizard + IncompleteContextBanner.

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ContextModalProvider, useContextModal } from './ContextProvider.jsx'

describe('ContextModalProvider', () => {
  it('throws if useContextModal is called outside the provider', () => {
    // Suppress React's error boundary noise for the expected throw.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useContextModal())).toThrow(
      /must be used within a ContextModalProvider/,
    )
    errSpy.mockRestore()
  })

  it('starts closed by default', () => {
    const { result } = renderHook(() => useContextModal(), {
      wrapper: ContextModalProvider,
    })
    expect(result.current.open).toBe(false)
  })

  it('openModal flips open to true', () => {
    const { result } = renderHook(() => useContextModal(), {
      wrapper: ContextModalProvider,
    })
    act(() => result.current.openModal())
    expect(result.current.open).toBe(true)
  })

  it('closeModal flips open back to false and clears wizardAlso', () => {
    const { result } = renderHook(() => useContextModal(), {
      wrapper: ContextModalProvider,
    })
    act(() => result.current.openModalAndWizard())
    expect(result.current.open).toBe(true)
    expect(result.current.wizardAlso).toBe(true)
    act(() => result.current.closeModal())
    expect(result.current.open).toBe(false)
    expect(result.current.wizardAlso).toBe(false)
  })

  it('openModalAndWizard sets both flags', () => {
    const { result } = renderHook(() => useContextModal(), {
      wrapper: ContextModalProvider,
    })
    act(() => result.current.openModalAndWizard())
    expect(result.current.open).toBe(true)
    expect(result.current.wizardAlso).toBe(true)
  })
})

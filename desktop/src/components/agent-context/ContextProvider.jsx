// ContextProvider — global state for the "Context" modal.
//
// The modal bundles 2 things the user used to navigate to via the
// Settings panel rail (About You + Agent context) into a single
// fullscreen overlay. It also has a "Re-run onboarding" action.
//
// Components that want to OPEN the modal call `useContextModal()`:
//   const { open, openWizard } = useContextModal()
//   <button onClick={open}>Open</button>
//
// Components that want to RENDER the modal consume nothing — the
// provider mounts the modal in the App tree, similar to
// <Onboarding /> and <IncompleteContextBanner />.
//
// Why a separate provider instead of local state in each caller?
// Because the same modal can be opened from the rail (Settings),
// from the command palette, from the banner, and from any future
// trigger (e.g. a keyboard shortcut). A provider gives one source
// of truth and a single instance of the modal.

import { createContext, useCallback, useContext, useState } from 'react'

const ContextModalContext = createContext(null)

export function ContextModalProvider({ children }) {
  const [open, setOpen] = useState(false)
  // When true, the modal also opens the OnboardingWizard overlay.
  // The wizard has its own close behaviour, so we expose a separate
  // flag rather than coupling the two components.
  const [wizardAlso, setWizardAlso] = useState(false)

  const openModal = useCallback(() => {
    setOpen(true)
    setWizardAlso(false)
  }, [])

  const closeModal = useCallback(() => {
    setOpen(false)
    setWizardAlso(false)
  }, [])

  const openModalAndWizard = useCallback(() => {
    setOpen(true)
    setWizardAlso(true)
  }, [])

  return (
    <ContextModalContext.Provider
      value={{ open, openModal, closeModal, wizardAlso, openModalAndWizard }}
    >
      {children}
    </ContextModalContext.Provider>
  )
}

export function useContextModal() {
  const ctx = useContext(ContextModalContext)
  if (!ctx) {
    // Outside the provider — fail loud so the dev catches it in tests.
    throw new Error('useContextModal must be used within a ContextModalProvider')
  }
  return ctx
}

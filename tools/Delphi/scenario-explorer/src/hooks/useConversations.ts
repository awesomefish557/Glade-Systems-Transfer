import { useCallback, useRef, useState } from 'react'
import {
  createEmptyScenario,
  loadScenariosVault,
  persistScenariosVault,
  pickMostRecentId,
  sortedScenarioList,
  type ScenarioDraft,
  type ScenariosVault,
  upsertCurrentScenario,
} from '../lib/scenarioStorage'

/**
 * Multi-scenario vault: list, switch, create, delete. Hydrate chat + canvas when `vault.currentId` changes.
 */
export function useConversations(draftRef: React.MutableRefObject<ScenarioDraft>) {
  const [vault, setVault] = useState<ScenariosVault>(() => loadScenariosVault())
  const vaultRef = useRef(vault)
  vaultRef.current = vault

  const selectScenario = useCallback(
    (id: string) => {
      if (id === vaultRef.current.currentId) return
      setVault((prev) => {
        if (id === prev.currentId) return prev
        const flushed = upsertCurrentScenario(prev, draftRef.current)
        const target = flushed.conversations[id]
        if (!target) return prev
        const next = { ...flushed, currentId: id }
        persistScenariosVault(next)
        return next
      })
    },
    [draftRef],
  )

  const newScenario = useCallback(() => {
    setVault((prev) => {
      const flushed = upsertCurrentScenario(prev, draftRef.current)
      const nid = crypto.randomUUID()
      const empty = createEmptyScenario(nid)
      const next: ScenariosVault = {
        currentId: nid,
        conversations: { ...flushed.conversations, [nid]: empty },
      }
      persistScenariosVault(next)
      return next
    })
  }, [draftRef])

  const deleteScenario = useCallback(
    (id: string) => {
      setVault((prev) => {
        const flushed = upsertCurrentScenario(prev, draftRef.current)
        const conversations = { ...flushed.conversations }
        delete conversations[id]

        if (Object.keys(conversations).length === 0) {
          const nid = crypto.randomUUID()
          const empty = createEmptyScenario(nid)
          const next: ScenariosVault = { currentId: nid, conversations: { [nid]: empty } }
          persistScenariosVault(next)
          return next
        }

        const wasCurrent = id === flushed.currentId
        const newCurrent = wasCurrent ? pickMostRecentId(conversations) : flushed.currentId
        const next: ScenariosVault = { currentId: newCurrent, conversations }
        persistScenariosVault(next)
        return next
      })
    },
    [draftRef],
  )

  const debouncedSave = useCallback(() => {
    setVault((prev) => {
      const next = upsertCurrentScenario(prev, draftRef.current)
      persistScenariosVault(next)
      return next
    })
  }, [draftRef])

  const renameScenario = useCallback(
    (id: string, title: string) => {
      const t = title.trim()
      if (!t) return
      setVault((prev) => {
        const flushed = upsertCurrentScenario(prev, draftRef.current)
        const s = flushed.conversations[id]
        if (!s) return prev
        const next: ScenariosVault = {
          ...flushed,
          conversations: {
            ...flushed.conversations,
            [id]: { ...s, title: t, updatedAt: Date.now() },
          },
        }
        persistScenariosVault(next)
        return next
      })
    },
    [draftRef],
  )

  return {
    vault,
    vaultRef,
    selectScenario,
    newScenario,
    deleteScenario,
    renameScenario,
    debouncedSave,
    scenarioList: sortedScenarioList(vault),
  }
}

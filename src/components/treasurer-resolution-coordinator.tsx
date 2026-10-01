"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";

export type TreasurerResolutionAction = "verify" | "reject";

type TreasurerResolutionState = {
  activeAction: TreasurerResolutionAction | null;
  completedBy: TreasurerResolutionAction | null;
  begin: (action: TreasurerResolutionAction) => boolean;
  end: (action: TreasurerResolutionAction) => void;
  markComplete: (action: TreasurerResolutionAction) => void;
};

const TreasurerResolutionContext = createContext<TreasurerResolutionState | null>(null);

export function TreasurerResolutionCoordinator({ children }: { children: ReactNode }) {
  const activeRef = useRef<TreasurerResolutionAction | null>(null);
  const completedRef = useRef<TreasurerResolutionAction | null>(null);
  const [activeAction, setActiveAction] = useState<TreasurerResolutionAction | null>(null);
  const [completedBy, setCompletedBy] = useState<TreasurerResolutionAction | null>(null);

  function begin(action: TreasurerResolutionAction) {
    if (activeRef.current !== null || completedRef.current !== null) return false;
    activeRef.current = action;
    setActiveAction(action);
    return true;
  }

  function end(action: TreasurerResolutionAction) {
    if (activeRef.current !== action) return;
    activeRef.current = null;
    setActiveAction(null);
  }

  function markComplete(action: TreasurerResolutionAction) {
    completedRef.current = action;
    setCompletedBy(action);
  }

  return (
    <TreasurerResolutionContext.Provider value={{ activeAction, completedBy, begin, end, markComplete }}>
      {children}
    </TreasurerResolutionContext.Provider>
  );
}

export function useTreasurerResolutionCoordinator() {
  const state = useContext(TreasurerResolutionContext);
  if (!state) throw new Error("Treasurer resolution actions require a shared coordinator.");
  return state;
}

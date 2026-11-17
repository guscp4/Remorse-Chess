import type { Piece } from "../engine/types";

export interface StatusVisual {
  key: string;
  label: string;
  color: string;
  desc: string;
}

export const STATUS_LEGEND: StatusVisual[] = [
  {
    key: "devastated",
    label: "Devastated",
    color: "var(--c-devastated)",
    desc: "Não se pode mexer. Um bispo aliado tem de chegar a uma casa adjacente em 3 turnos, senão a peça sai do jogo (bispos recuperam sozinhos).",
  },
  {
    key: "guiltridden",
    label: "Guilt Ridden",
    color: "var(--c-guiltridden)",
    desc: "Move-se normalmente mas não pode capturar nem dar xeque. Um bispo aliado adjacente absolve-a (volta ao normal no turno seguinte).",
  },
  {
    key: "unbothered",
    label: "Unbothered",
    color: "var(--c-unbothered)",
    desc: "Nada acontece — a peça fica marcada mas comporta-se sempre normalmente.",
  },
  {
    key: "psychopath",
    label: "Psychopath",
    color: "var(--c-psychopath)",
    desc: "Ganha um movimento extra após capturar (1x por turno).",
  },
  {
    key: "bloodlust",
    label: "Bloodlust",
    color: "var(--c-bloodlust)",
    desc: "Só se pode mexer para capturar — mesmo peças da própria equipa.",
  },
];

/** Small persistent corner marker showing the piece's permanently locked category. */
export function cornerBadge(piece: Piece): StatusVisual | null {
  if (piece.locked === "none") return null;
  if (piece.locked === "unbothered") return STATUS_LEGEND.find((s) => s.key === "unbothered")!;
  if (piece.locked === "psychopath") return null; // shown as the big badge instead
  // devastated / guiltridden: show corner marker only while currently "normal"
  // (the big badge takes over while the episode is active).
  if (piece.active !== "normal") return null;
  return STATUS_LEGEND.find((s) => s.key === piece.locked) ?? null;
}

/** The prominent badge shown over the piece for its current, urgent condition. */
export function mainBadge(piece: Piece): { visual: StatusVisual; count?: number } | null {
  if (piece.isBloodlust) {
    return { visual: STATUS_LEGEND.find((s) => s.key === "bloodlust")! };
  }
  if (piece.locked === "psychopath") {
    return { visual: STATUS_LEGEND.find((s) => s.key === "psychopath")! };
  }
  if (piece.active === "devastated") {
    return {
      visual: STATUS_LEGEND.find((s) => s.key === "devastated")!,
      count: piece.devastatedTurnsLeft ?? undefined,
    };
  }
  if (piece.active === "guiltridden") {
    return { visual: STATUS_LEGEND.find((s) => s.key === "guiltridden")! };
  }
  return null;
}

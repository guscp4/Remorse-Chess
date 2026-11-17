import { squareToAlgebraic } from "../engine/board";
import type { Move } from "../engine/types";

const PIECE_LETTER: Record<string, string> = {
  P: "",
  N: "C",
  B: "B",
  R: "T",
  Q: "D",
  K: "R",
};

export function formatMove(move: Move): string {
  if (move.isCastle) {
    return move.isCastle === "kingside" ? "O-O" : "O-O-O";
  }
  const letter = PIECE_LETTER[move.piece.type];
  const capture = move.captured || move.isEnPassant ? "x" : "-";
  const promo = move.promotion ? `=${PIECE_LETTER[move.promotion] || move.promotion}` : "";
  return `${letter}${squareToAlgebraic(move.from)}${capture}${squareToAlgebraic(move.to)}${promo}`;
}

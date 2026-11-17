export type Color = "w" | "b";

export type PieceType = "P" | "N" | "B" | "R" | "Q" | "K";

/**
 * The permanent "category" a piece is locked into the first time it captures
 * and the die is rolled. "none" = has never captured yet, die not rolled.
 * Once set, this never changes for the rest of the game (per RemorseChess rules).
 */
export type LockedCategory =
  | "none"
  | "devastated"
  | "guiltridden"
  | "unbothered"
  | "psychopath";

/**
 * The piece's current, in-the-moment condition. Distinct from LockedCategory:
 * a piece can be locked into "devastated" but currently "normal" (already
 * saved/recovered), until it captures again and re-enters the episode.
 */
export type ActiveCondition = "normal" | "devastated" | "guiltridden";

export interface Piece {
  id: string;
  type: PieceType;
  color: Color;
  locked: LockedCategory;
  active: ActiveCondition;

  // --- Devastated episode state (only meaningful while active === "devastated") ---
  devastatedTurnsLeft: number | null; // counts down each of the owner's own turns

  // --- Guilt Ridden episode state (only meaningful while active === "guiltridden") ---
  guiltAbsolutionPending: boolean; // a friendly bishop has landed adjacent; cured at the start of the owner's next turn
  guiltBishopTurnsLeft: number | null; // bishops self-cure: counts down from 2, only used when the Guilt Ridden piece itself is a bishop

  // --- Psychopath / Bloodlust state (permanent once locked === "psychopath") ---
  isBloodlust: boolean;
  capturesSincePsychopath: number;
  usedExtraMoveThisTurn: boolean; // reset at the start of every owner turn
}

export interface Square {
  row: number; // 0..7, 0 = rank 8 (top, black back rank) when rendered, but logically 0 = rank 1
  col: number; // 0..7, 0 = file a
}

export type BoardCell = Piece | null;

export type Board = BoardCell[][]; // board[row][col]

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6;

export interface Move {
  from: Square;
  to: Square;
  piece: Piece;
  captured?: Piece;
  isEnPassant?: boolean;
  isCastle?: "kingside" | "queenside";
  promotion?: PieceType;
  isExtraMove?: boolean; // true if this move was the Psychopath bonus move
}

export interface PendingPromotion {
  from: Square;
  to: Square;
}

export type GameStatus =
  | "playing"
  | "checkmate"
  | "stalemate"
  | "draw";

export interface DiceRollResult {
  piece: Piece;
  face: DieFace | null; // null when the category was re-applied without a fresh roll
  category: LockedCategory; // the category this roll assigned/re-applied
  wasFirstRoll: boolean;
}

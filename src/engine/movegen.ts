import {
  cloneBoard,
  findKing,
  getPiece,
  inBounds,
  isAdjacent,
  sameSquare,
  setPiece,
} from "./board";
import type { Board, Color, Move, Piece, PieceType, Square } from "./types";

export interface CastlingRights {
  w: { kingside: boolean; queenside: boolean };
  b: { kingside: boolean; queenside: boolean };
}

export function initialCastlingRights(): CastlingRights {
  return {
    w: { kingside: true, queenside: true },
    b: { kingside: true, queenside: true },
  };
}

function otherColor(c: Color): Color {
  return c === "w" ? "b" : "w";
}

/** How a piece's occupancy rules are filtered, derived from its RemorseChess state. */
type MoveMode = "normal" | "guiltridden" | "bloodlust";

function moveModeOf(piece: Piece): MoveMode {
  if (piece.isBloodlust) return "bloodlust";
  if (piece.active === "guiltridden") return "guiltridden";
  return "normal";
}

/**
 * Whether `piece` (moving) is allowed to land on a square whose occupant is `occupant`
 * (null = empty). This is the core RemorseChess movement filter.
 */
function destinationAllowed(
  mode: MoveMode,
  piece: Piece,
  occupant: Piece | null
): boolean {
  if (occupant === null) {
    // Empty square: fine for normal/guiltridden, forbidden for bloodlust (must capture).
    return mode !== "bloodlust";
  }
  if (occupant.type === "K") {
    // A king is never a capturable destination — friend or foe, Bloodlust included.
    // Kings only ever leave the board via checkmate ending the game or the Devastated
    // elimination timer, never by being landed on directly.
    return false;
  }
  if (occupant.color === piece.color) {
    // Friendly-occupied square: only a Bloodlust piece may "capture" it.
    return mode === "bloodlust";
  }
  // Enemy-occupied square: a normal capture. Guilt Ridden pieces cannot capture at all.
  return mode !== "guiltridden";
}

const KNIGHT_OFFSETS = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_OFFSETS = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const QUEEN_DIRS = [...BISHOP_DIRS, ...ROOK_DIRS];

function stepMoves(
  board: Board,
  from: Square,
  piece: Piece,
  offsets: number[][]
): Square[] {
  const mode = moveModeOf(piece);
  const out: Square[] = [];
  for (const [dr, dc] of offsets) {
    const to: Square = { row: from.row + dr, col: from.col + dc };
    if (!inBounds(to)) continue;
    const occupant = getPiece(board, to);
    if (destinationAllowed(mode, piece, occupant)) out.push(to);
  }
  return out;
}

function slideMoves(
  board: Board,
  from: Square,
  piece: Piece,
  dirs: number[][]
): Square[] {
  const mode = moveModeOf(piece);
  const out: Square[] = [];
  for (const [dr, dc] of dirs) {
    let r = from.row + dr;
    let c = from.col + dc;
    while (inBounds({ row: r, col: c })) {
      const to = { row: r, col: c };
      const occupant = getPiece(board, to);
      if (occupant === null) {
        if (mode !== "bloodlust") out.push(to);
      } else {
        if (destinationAllowed(mode, piece, occupant)) out.push(to);
        break; // sliding always stops at the first occupied square, either way
      }
      r += dr;
      c += dc;
    }
  }
  return out;
}

export interface PseudoMoveOptions {
  enPassantTarget: Square | null;
  castlingRights: CastlingRights;
}

/** Pseudo-legal moves for one piece: respects RemorseChess occupancy rules but NOT king safety. */
export function pseudoMovesForPiece(
  board: Board,
  from: Square,
  options: PseudoMoveOptions
): Move[] {
  const piece = getPiece(board, from);
  if (!piece) return [];
  if (piece.active === "devastated") return []; // frozen solid

  const mode = moveModeOf(piece);
  const moves: Move[] = [];

  const addSimple = (to: Square, extra: Partial<Move> = {}) => {
    const captured = getPiece(board, to) ?? undefined;
    moves.push({ from, to, piece, captured, ...extra });
  };

  switch (piece.type) {
    case "N": {
      for (const to of stepMoves(board, from, piece, KNIGHT_OFFSETS)) addSimple(to);
      break;
    }
    case "B": {
      for (const to of slideMoves(board, from, piece, BISHOP_DIRS)) addSimple(to);
      break;
    }
    case "R": {
      for (const to of slideMoves(board, from, piece, ROOK_DIRS)) addSimple(to);
      break;
    }
    case "Q": {
      for (const to of slideMoves(board, from, piece, QUEEN_DIRS)) addSimple(to);
      break;
    }
    case "K": {
      for (const to of stepMoves(board, from, piece, KING_OFFSETS)) addSimple(to);
      if (mode !== "bloodlust") {
        addCastlingMoves(board, from, piece, options.castlingRights, moves);
      }
      break;
    }
    case "P": {
      addPawnMoves(board, from, piece, mode, options.enPassantTarget, moves);
      break;
    }
  }

  return moves;
}

function addPawnMoves(
  board: Board,
  from: Square,
  piece: Piece,
  mode: MoveMode,
  enPassantTarget: Square | null,
  out: Move[]
) {
  const dir = piece.color === "w" ? 1 : -1;
  const startRow = piece.color === "w" ? 1 : 6;
  const promoRow = piece.color === "w" ? 7 : 0;

  const pushPromoAware = (to: Square, extra: Partial<Move> = {}) => {
    const captured = getPiece(board, to) ?? undefined;
    if (to.row === promoRow) {
      for (const promo of ["Q", "R", "B", "N"] as PieceType[]) {
        out.push({ from, to, piece, captured, promotion: promo, ...extra });
      }
    } else {
      out.push({ from, to, piece, captured, ...extra });
    }
  };

  // Forward moves (never a capture) — forbidden in Bloodlust mode.
  if (mode !== "bloodlust") {
    const one: Square = { row: from.row + dir, col: from.col };
    if (inBounds(one) && getPiece(board, one) === null) {
      pushPromoAware(one);
      if (from.row === startRow) {
        const two: Square = { row: from.row + 2 * dir, col: from.col };
        if (inBounds(two) && getPiece(board, two) === null) {
          pushPromoAware(two);
        }
      }
    }
  }

  // Diagonal moves — always a capture (or en passant). Forbidden for Guilt Ridden pieces.
  if (mode !== "guiltridden") {
    for (const dc of [-1, 1]) {
      const to: Square = { row: from.row + dir, col: from.col + dc };
      if (!inBounds(to)) continue;
      const occupant = getPiece(board, to);
      if (occupant !== null) {
        if (destinationAllowed(mode, piece, occupant)) pushPromoAware(to);
      } else if (
        mode !== "bloodlust" &&
        enPassantTarget &&
        sameSquare(to, enPassantTarget)
      ) {
        // En passant only ever captures an enemy pawn — never friendly — so it's
        // unavailable in Bloodlust mode (which requires an actual occupied destination).
        const capturedSq: Square = { row: from.row, col: to.col };
        const captured = getPiece(board, capturedSq) ?? undefined;
        out.push({ from, to, piece, captured, isEnPassant: true });
      }
    }
  }
}

function addCastlingMoves(
  board: Board,
  from: Square,
  king: Piece,
  rights: CastlingRights,
  out: Move[]
) {
  const color = king.color;
  const row = color === "w" ? 0 : 7;
  if (from.row !== row || from.col !== 4) return;
  const side = rights[color];

  const emptyBetween = (cols: number[]) =>
    cols.every((c) => getPiece(board, { row, col: c }) === null);

  const rookAt = (col: number, type: PieceType = "R") => {
    const p = getPiece(board, { row, col });
    return p && p.type === type && p.color === color;
  };

  const squaresSafe = (cols: number[]) =>
    cols.every((c) => !isSquareAttacked(board, { row, col: c }, otherColor(color)));

  if (side.kingside && rookAt(7) && emptyBetween([5, 6]) && squaresSafe([4, 5, 6])) {
    out.push({
      from,
      to: { row, col: 6 },
      piece: king,
      isCastle: "kingside",
    });
  }
  if (
    side.queenside &&
    rookAt(0) &&
    emptyBetween([1, 2, 3]) &&
    squaresSafe([4, 3, 2])
  ) {
    out.push({
      from,
      to: { row, col: 2 },
      piece: king,
      isCastle: "queenside",
    });
  }
}

/**
 * Is `square` attacked by any piece of `byColor`? Guilt Ridden pieces never give
 * check, per RemorseChess rules, so they are excluded entirely from this scan.
 */
export function isSquareAttacked(
  board: Board,
  square: Square,
  byColor: Color
): boolean {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const p = board[row][col];
      if (!p || p.color !== byColor) continue;
      if (p.active === "guiltridden") continue;
      if (p.active === "devastated") {
        // A frozen piece still threatens squares from where it stands.
      }
      if (attacksSquare(board, { row, col }, p, square)) return true;
    }
  }
  return false;
}

function attacksSquare(
  board: Board,
  from: Square,
  piece: Piece,
  target: Square
): boolean {
  switch (piece.type) {
    case "N":
      return KNIGHT_OFFSETS.some(
        ([dr, dc]) => from.row + dr === target.row && from.col + dc === target.col
      );
    case "K":
      return KING_OFFSETS.some(
        ([dr, dc]) => from.row + dr === target.row && from.col + dc === target.col
      );
    case "P": {
      const dir = piece.color === "w" ? 1 : -1;
      return (
        from.row + dir === target.row &&
        (from.col + 1 === target.col || from.col - 1 === target.col)
      );
    }
    case "B":
      return slideAttacks(board, from, BISHOP_DIRS, target);
    case "R":
      return slideAttacks(board, from, ROOK_DIRS, target);
    case "Q":
      return slideAttacks(board, from, QUEEN_DIRS, target);
    default:
      return false;
  }
}

function slideAttacks(
  board: Board,
  from: Square,
  dirs: number[][],
  target: Square
): boolean {
  for (const [dr, dc] of dirs) {
    let r = from.row + dr;
    let c = from.col + dc;
    while (inBounds({ row: r, col: c })) {
      if (r === target.row && c === target.col) return true;
      if (board[r][c] !== null) break; // blocked, this ray stops here
      r += dr;
      c += dc;
    }
  }
  return false;
}

/** Applies `move` to a cloned board and returns it, without touching RemorseChess state machinery. */
export function applyMoveToBoard(board: Board, move: Move): Board {
  const next = cloneBoard(board);
  const movingPiece = { ...move.piece };

  setPiece(next, move.from, null);

  if (move.isEnPassant) {
    const capturedSq: Square = { row: move.from.row, col: move.to.col };
    setPiece(next, capturedSq, null);
  }

  if (move.isCastle) {
    const row = move.from.row;
    if (move.isCastle === "kingside") {
      const rook = getPiece(next, { row, col: 7 });
      setPiece(next, { row, col: 7 }, null);
      setPiece(next, { row, col: 5 }, rook);
    } else {
      const rook = getPiece(next, { row, col: 0 });
      setPiece(next, { row, col: 0 }, null);
      setPiece(next, { row, col: 3 }, rook);
    }
  }

  if (move.promotion) {
    const promoted = { ...movingPiece, type: move.promotion };
    // A Guilt Ridden pawn promoting to a bishop is absolved on the spot; any other
    // promotion keeps carrying the Guilt Ridden condition on the new piece.
    if (promoted.active === "guiltridden" && move.promotion === "B") {
      promoted.active = "normal";
      promoted.guiltAbsolutionPending = false;
      promoted.guiltBishopTurnsLeft = null;
    }
    setPiece(next, move.to, promoted);
  } else {
    setPiece(next, move.to, movingPiece);
  }

  return next;
}

/** Legal moves for one piece: pseudo-legal, minus any that leave its own king in check. */
export function legalMovesForPiece(
  board: Board,
  from: Square,
  options: PseudoMoveOptions
): Move[] {
  const piece = getPiece(board, from);
  if (!piece) return [];
  const pseudo = pseudoMovesForPiece(board, from, options);
  return pseudo.filter((move) => {
    const next = applyMoveToBoard(board, move);
    const kingSq = findKing(next, piece.color);
    if (!kingSq) return false; // a move that removes your own king can never be legal
    return !isSquareAttacked(next, kingSq, otherColor(piece.color));
  });
}

/** All legal moves for `color`, optionally restricted to a single piece (Psychopath extra move). */
export function allLegalMoves(
  board: Board,
  color: Color,
  options: PseudoMoveOptions,
  restrictToPieceId?: string
): Move[] {
  const moves: Move[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const p = board[row][col];
      if (!p || p.color !== color) continue;
      if (restrictToPieceId && p.id !== restrictToPieceId) continue;
      moves.push(...legalMovesForPiece(board, { row, col }, options));
    }
  }
  return moves;
}

export function isInCheck(board: Board, color: Color): boolean {
  const kingSq = findKing(board, color);
  if (!kingSq) return false;
  return isSquareAttacked(board, kingSq, otherColor(color));
}

export { otherColor, isAdjacent };

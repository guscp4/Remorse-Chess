import type { Board, Color, Piece, PieceType, Square } from "./types";

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `p${idCounter}`;
}

export function makePiece(type: PieceType, color: Color): Piece {
  return {
    id: nextId(),
    type,
    color,
    locked: "none",
    active: "normal",
    devastatedTurnsLeft: null,
    guiltAbsolutionPending: false,
    guiltBishopTurnsLeft: null,
    isBloodlust: false,
    capturesSincePsychopath: 0,
    usedExtraMoveThisTurn: false,
  };
}

/** Row 0 = rank 1 (white back rank), row 7 = rank 8 (black back rank). */
export function createInitialBoard(): Board {
  const board: Board = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => null as Piece | null)
  );

  const backRank: PieceType[] = ["R", "N", "B", "Q", "K", "B", "N", "R"];

  for (let col = 0; col < 8; col++) {
    board[0][col] = makePiece(backRank[col], "w");
    board[1][col] = makePiece("P", "w");
    board[6][col] = makePiece("P", "b");
    board[7][col] = makePiece(backRank[col], "b");
  }

  return board;
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

export function inBounds(sq: Square): boolean {
  return sq.row >= 0 && sq.row < 8 && sq.col >= 0 && sq.col < 8;
}

export function sameSquare(a: Square, b: Square): boolean {
  return a.row === b.row && a.col === b.col;
}

export function isAdjacent(a: Square, b: Square): boolean {
  return (
    Math.abs(a.row - b.row) <= 1 &&
    Math.abs(a.col - b.col) <= 1 &&
    !sameSquare(a, b)
  );
}

export function getPiece(board: Board, sq: Square): Piece | null {
  return board[sq.row][sq.col];
}

export function setPiece(board: Board, sq: Square, piece: Piece | null): void {
  board[sq.row][sq.col] = piece;
}

export function findKing(board: Board, color: Color): Square | null {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const p = board[row][col];
      if (p && p.type === "K" && p.color === color) return { row, col };
    }
  }
  return null;
}

export function findSquareOf(board: Board, pieceId: string): Square | null {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const p = board[row][col];
      if (p && p.id === pieceId) return { row, col };
    }
  }
  return null;
}

const FILES = "abcdefgh";

export function squareToAlgebraic(sq: Square): string {
  return `${FILES[sq.col]}${sq.row + 1}`;
}

export function algebraicToSquare(s: string): Square {
  const col = FILES.indexOf(s[0]);
  const row = parseInt(s[1], 10) - 1;
  return { row, col };
}

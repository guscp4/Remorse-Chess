import { cloneBoard, findSquareOf, getPiece, isAdjacent, setPiece } from "./board";
import {
  allLegalMoves,
  applyMoveToBoard,
  initialCastlingRights,
  isInCheck,
  legalMovesForPiece,
  otherColor,
  type CastlingRights,
} from "./movegen";
import { createInitialBoard } from "./board";
import type {
  Board,
  Color,
  DiceRollResult,
  DieFace,
  GameStatus,
  LockedCategory,
  Move,
  Piece,
  Square,
} from "./types";

export interface MoveResult {
  move: Move;
  diceRoll: DiceRollResult | null;
  /** True when this move captured a piece that has never rolled before — the UI must
   *  call rollPendingDice() (after the player confirms) before the turn can continue. */
  pendingDiceRoll: boolean;
  eliminated: Piece[];
  extraMovePending: boolean;
  status: GameStatus;
  winner: Color | null;
  inCheck: Color | null;
  messages: string[];
}

export interface DiceResolutionResult {
  diceRoll: DiceRollResult;
  eliminated: Piece[];
  extraMovePending: boolean;
  status: GameStatus;
  winner: Color | null;
  inCheck: Color | null;
  messages: string[];
}

export const PIECE_VALUE: Record<string, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };

function rollD6(): DieFace {
  return (Math.floor(Math.random() * 6) + 1) as DieFace;
}

function categoryForRoll(face: DieFace): LockedCategory {
  if (face === 1) return "devastated";
  if (face === 2 || face === 3) return "guiltridden";
  if (face === 4 || face === 5) return "unbothered";
  return "psychopath";
}

export class Game {
  board: Board;
  turn: Color = "w";
  castlingRights: CastlingRights = initialCastlingRights();
  enPassantTarget: Square | null = null;
  status: GameStatus = "playing";
  winner: Color | null = null;
  moveHistory: Move[] = [];
  pendingExtraMovePieceId: string | null = null;
  /** Set right after a capture by a piece that has never rolled before; cleared once rollPendingDice() runs. */
  pendingDiceRollPieceId: string | null = null;
  /** Pieces captured so far, keyed by the color that captured them. */
  capturedBy: Record<Color, Piece[]> = { w: [], b: [] };

  constructor() {
    this.board = createInitialBoard();
  }

  getLegalMovesFrom(sq: Square): Move[] {
    if (this.pendingDiceRollPieceId) return [];
    const piece = getPiece(this.board, sq);
    if (!piece || piece.color !== this.turn) return [];
    if (this.pendingExtraMovePieceId && piece.id !== this.pendingExtraMovePieceId) {
      return [];
    }
    return legalMovesForPiece(this.board, sq, {
      enPassantTarget: this.enPassantTarget,
      castlingRights: this.castlingRights,
    });
  }

  getAllLegalMoves(color: Color = this.turn): Move[] {
    return allLegalMoves(
      this.board,
      color,
      { enPassantTarget: this.enPassantTarget, castlingRights: this.castlingRights },
      this.pendingExtraMovePieceId ?? undefined
    );
  }

  capturedPoints(color: Color): number {
    return this.capturedBy[color].reduce((sum, p) => sum + (PIECE_VALUE[p.type] ?? 0), 0);
  }

  /** Executes a move that was produced by getLegalMovesFrom/getAllLegalMoves. */
  makeMove(move: Move): MoveResult {
    const messages: string[] = [];
    const mover = move.piece.color;
    const eliminated: Piece[] = [];
    let diceRoll: DiceRollResult | null = null;
    let pendingDiceRoll = false;

    this.board = applyMoveToBoard(this.board, move);
    this.moveHistory.push(move);
    this.updateCastlingRightsAfterMove(move);
    this.updateEnPassantTarget(move);

    const movedPieceSquare = move.to;
    const movedPiece = getPiece(this.board, movedPieceSquare)!;

    const capturedPiece = move.captured ?? null;
    if (capturedPiece) {
      this.capturedBy[mover].push(capturedPiece);
    }

    const didCapture = !!capturedPiece;
    if (didCapture) {
      if (movedPiece.locked === "none") {
        // A fresh capture: hold off on rolling until the player confirms in the UI.
        this.pendingDiceRollPieceId = movedPiece.id;
        pendingDiceRoll = true;
        messages.push("Captura! Lança o dado para saber o que acontece à peça.");
      } else {
        diceRoll = this.resolveCapture(movedPiece, messages);
      }
    }

    // Reactive bishop-adjacency cures (only non-bishop targets; bishops self-cure on a timer).
    // This never depends on the capturing piece's own (possibly still-pending) status.
    if (movedPiece.type === "B") {
      this.applyBishopComfort(movedPiece, messages);
    }

    let extraMovePending = false;
    if (!pendingDiceRoll) {
      extraMovePending = this.grantExtraMoveIfEligible(movedPiece, movedPieceSquare, messages);
      if (!extraMovePending) {
        this.pendingExtraMovePieceId = null;
        this.endTurnAndAdvance(mover, eliminated, messages);
      }
    }

    const inCheckColor: Color | null =
      this.status === "playing" && isInCheck(this.board, this.turn) ? this.turn : null;

    return {
      move,
      diceRoll,
      pendingDiceRoll,
      eliminated,
      extraMovePending,
      status: this.status,
      winner: this.winner,
      inCheck: inCheckColor,
      messages,
    };
  }

  /** Called once the player presses "Lançar" on a pending first-time capture roll. */
  rollPendingDice(): DiceResolutionResult {
    const pieceId = this.pendingDiceRollPieceId;
    if (!pieceId) {
      throw new Error("No dice roll is pending.");
    }
    const sq = findSquareOf(this.board, pieceId);
    if (!sq) throw new Error("Pending piece not found on board.");
    const piece = getPiece(this.board, sq)!;
    const messages: string[] = [];
    const eliminated: Piece[] = [];

    const diceRoll = this.resolveCapture(piece, messages);
    this.pendingDiceRollPieceId = null;

    const mover = piece.color;
    const extraMovePending = this.grantExtraMoveIfEligible(piece, sq, messages);
    if (!extraMovePending) {
      this.pendingExtraMovePieceId = null;
      this.endTurnAndAdvance(mover, eliminated, messages);
    }

    const inCheckColor: Color | null =
      this.status === "playing" && isInCheck(this.board, this.turn) ? this.turn : null;

    return {
      diceRoll,
      eliminated,
      extraMovePending,
      status: this.status,
      winner: this.winner,
      inCheck: inCheckColor,
      messages,
    };
  }

  /** Grants the Psychopath bonus move, if eligible and the piece has a legal follow-up. */
  private grantExtraMoveIfEligible(piece: Piece, square: Square, messages: string[]): boolean {
    if (piece.locked !== "psychopath" || piece.usedExtraMoveThisTurn) return false;
    piece.usedExtraMoveThisTurn = true;
    const followUp = legalMovesForPiece(this.board, square, {
      enPassantTarget: this.enPassantTarget,
      castlingRights: this.castlingRights,
    });
    if (followUp.length === 0) return false;
    this.pendingExtraMovePieceId = piece.id;
    messages.push("Movimento extra do Psychopath!");
    return true;
  }

  private resolveCapture(piece: Piece, messages: string[]): DiceRollResult {
    const wasFirstRoll = piece.locked === "none";
    let face: DieFace | null;
    let category: LockedCategory;

    if (wasFirstRoll) {
      face = rollD6();
      category = categoryForRoll(face);
      piece.locked = category;
    } else {
      category = piece.locked;
      face = null; // no real roll happened; re-applying the locked category
    }

    switch (category) {
      case "devastated":
        piece.active = "devastated";
        piece.devastatedTurnsLeft = 3;
        messages.push(wasFirstRoll ? "Dado: 1 — a peça ficou Devastated!" : "A peça voltou a ficar Devastated.");
        break;
      case "guiltridden":
        piece.active = "guiltridden";
        piece.guiltAbsolutionPending = false;
        if (piece.type === "B") piece.guiltBishopTurnsLeft = 2;
        messages.push(
          wasFirstRoll ? "Dado: 2/3 — a peça ficou Guilt Ridden!" : "A peça voltou a ficar Guilt Ridden."
        );
        break;
      case "unbothered":
        if (wasFirstRoll) messages.push("Dado: 4/5 — a peça fica Unbothered, nada muda.");
        break;
      case "psychopath":
        piece.capturesSincePsychopath += 1;
        if (piece.capturesSincePsychopath >= 3) {
          piece.isBloodlust = true;
          messages.push("A peça entrou em Bloodlust!");
        }
        messages.push(wasFirstRoll ? "Dado: 6 — a peça ficou Psychopath!" : "Captura de Psychopath.");
        break;
    }

    return { piece: { ...piece }, face, category, wasFirstRoll };
  }

  /** Any OTHER bishop of the same color landing adjacent cures a Devastated/Guilt Ridden ally (bishops excluded: they self-cure). */
  private applyBishopComfort(bishop: Piece, messages: string[]) {
    const bishopSq = findSquareOf(this.board, bishop.id);
    if (!bishopSq) return;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const p = this.board[row][col];
        if (!p || p.color !== bishop.color || p.id === bishop.id || p.type === "B") continue;
        if (!isAdjacent(bishopSq, { row, col })) continue;
        if (p.active === "devastated") {
          p.active = "normal";
          p.devastatedTurnsLeft = null;
          messages.push("Um bispo consolou uma peça Devastated — voltou ao normal.");
        } else if (p.active === "guiltridden" && !p.guiltAbsolutionPending) {
          p.guiltAbsolutionPending = true;
          messages.push("Um bispo absolveu uma peça Guilt Ridden — normaliza no próximo turno dessa equipa.");
        }
      }
    }
  }

  private endTurnAndAdvance(mover: Color, eliminated: Piece[], messages: string[]) {
    const next = otherColor(mover);
    this.turn = next;
    this.beginTurnBookkeeping(next, eliminated, messages);

    if (this.status !== "playing") return; // a king was just eliminated

    const legal = this.getAllLegalMoves(next);
    const inCheck = isInCheck(this.board, next);
    if (legal.length === 0) {
      if (inCheck) {
        this.status = "checkmate";
        this.winner = mover;
        messages.push("Xeque-mate!");
      } else {
        this.status = "stalemate";
        messages.push("Empate por afogamento (stalemate).");
      }
    }
  }

  private beginTurnBookkeeping(color: Color, eliminated: Piece[], messages: string[]) {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const p = this.board[row][col];
        if (!p || p.color !== color) continue;
        p.usedExtraMoveThisTurn = false;

        if (p.active === "devastated" && p.type === "B") {
          p.devastatedTurnsLeft = (p.devastatedTurnsLeft ?? 1) - 1;
          if (p.devastatedTurnsLeft <= 0) {
            p.active = "normal";
            p.devastatedTurnsLeft = null;
            messages.push("Um bispo Devastated recuperou sozinho.");
          }
        } else if (p.active === "devastated") {
          p.devastatedTurnsLeft = (p.devastatedTurnsLeft ?? 1) - 1;
          if (p.devastatedTurnsLeft <= 0) {
            this.eliminatePiece({ row, col }, messages);
            eliminated.push(p);
          }
        } else if (p.active === "guiltridden" && p.type === "B") {
          p.guiltBishopTurnsLeft = (p.guiltBishopTurnsLeft ?? 1) - 1;
          if (p.guiltBishopTurnsLeft <= 0) {
            p.active = "normal";
            p.guiltBishopTurnsLeft = null;
            messages.push("Um bispo Guilt Ridden voltou ao normal sozinho.");
          }
        } else if (p.active === "guiltridden" && p.guiltAbsolutionPending) {
          p.active = "normal";
          p.guiltAbsolutionPending = false;
          messages.push("Uma peça Guilt Ridden absolvida voltou ao normal.");
        }
      }
    }
  }

  private eliminatePiece(sq: Square, messages: string[]) {
    const p = getPiece(this.board, sq);
    if (!p) return;
    setPiece(this.board, sq, null);
    messages.push(
      `${pieceLabel(p)} Devastated não foi salva a tempo e saiu do jogo.`
    );
    if (p.type === "K") {
      this.status = "checkmate";
      this.winner = otherColor(p.color);
      messages.push("O rei foi eliminado! Fim de jogo.");
    }
  }

  private updateCastlingRightsAfterMove(move: Move) {
    const { from, piece } = move;
    if (piece.type === "K") {
      this.castlingRights[piece.color].kingside = false;
      this.castlingRights[piece.color].queenside = false;
    }
    if (piece.type === "R") {
      const backRow = piece.color === "w" ? 0 : 7;
      if (from.row === backRow && from.col === 0) {
        this.castlingRights[piece.color].queenside = false;
      }
      if (from.row === backRow && from.col === 7) {
        this.castlingRights[piece.color].kingside = false;
      }
    }
    // A captured rook on its home corner also revokes the opponent's right (handled
    // implicitly in movegen.addCastlingMoves by checking the rook is still physically there).
  }

  private updateEnPassantTarget(move: Move) {
    if (
      move.piece.type === "P" &&
      Math.abs(move.to.row - move.from.row) === 2
    ) {
      this.enPassantTarget = {
        row: (move.to.row + move.from.row) / 2,
        col: move.from.col,
      };
    } else {
      this.enPassantTarget = null;
    }
  }
}

function pieceLabel(p: Piece): string {
  const names: Record<string, string> = {
    P: "O peão",
    N: "O cavalo",
    B: "O bispo",
    R: "A torre",
    Q: "A dama",
    K: "O rei",
  };
  return names[p.type] ?? "A peça";
}

export { cloneBoard };

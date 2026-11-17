import "./style.css";
import { Game, PIECE_VALUE } from "./engine/game";
import { getPiece, sameSquare, squareToAlgebraic } from "./engine/board";
import { isInCheck } from "./engine/movegen";
import type { Color, DiceRollResult, Move, Piece, PieceType, Square } from "./engine/types";
import { cornerBadge, mainBadge, STATUS_LEGEND } from "./ui/status";
import { formatMove } from "./ui/notation";

// Both colors use the same solid (filled) glyph shapes — only the fill/outline
// CSS colors differ — so White pieces render filled instead of hollow-outline.
const SOLID_GLYPH: Record<PieceType, string> = {
  K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟",
};
const GLYPH: Record<Color, Record<PieceType, string>> = { w: SOLID_GLYPH, b: SOLID_GLYPH };

const PROMO_LABEL: Record<string, string> = { Q: "Dama", R: "Torre", B: "Bispo", N: "Cavalo" };

type DiceStage = "prompt" | "rolling" | "result" | null;

let game = new Game();
let selected: Square | null = null;
let legalTargets: Move[] = [];
let pendingPromotion: { moves: Move[] } | null = null;
let diceStage: DiceStage = null;
let diceRollData: DiceRollResult | null = null;
let logEntries: { text: string; kind: "move" | "info" }[] = [];

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="main-col">
    <h1><span class="remorse">Remorse</span>Chess</h1>
    <p class="subtitle">Humano vs. humano, no mesmo dispositivo</p>
    <div id="status-bar" class="status-bar"></div>
    <div id="captures-top" class="captures-row"></div>
    <div id="board" class="board"></div>
    <div id="captures-bottom" class="captures-row"></div>
    <div style="margin-top:14px; display:flex; gap:10px;">
      <button id="new-game" class="secondary">Novo Jogo</button>
    </div>
  </div>
  <div class="side-col">
    <details class="panel" id="legend-panel" open>
      <summary><h2>Estados das Peças</h2></summary>
    </details>
    <div class="panel" id="log-panel">
      <h2>Registo</h2>
      <div class="log" id="log"></div>
    </div>
  </div>
`;

const boardEl = document.getElementById("board")!;
const statusBarEl = document.getElementById("status-bar")!;
const legendPanel = document.getElementById("legend-panel")!;
const logEl = document.getElementById("log")!;
const capturesTopEl = document.getElementById("captures-top")!;
const capturesBottomEl = document.getElementById("captures-bottom")!;

legendPanel.innerHTML += STATUS_LEGEND.map(
  (s) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${s.color}"></div>
      <div><b style="color:${s.color}">${s.label}</b><span class="desc">${s.desc}</span></div>
    </div>`
).join("");

document.getElementById("new-game")!.addEventListener("click", () => {
  game = new Game();
  selected = null;
  legalTargets = [];
  pendingPromotion = null;
  diceStage = null;
  diceRollData = null;
  logEntries = [];
  render();
});

function squareFromCellEl(el: HTMLElement): Square {
  return { row: parseInt(el.dataset.row!, 10), col: parseInt(el.dataset.col!, 10) };
}

boardEl.addEventListener("click", (e) => {
  const cell = (e.target as HTMLElement).closest<HTMLElement>(".square");
  if (!cell) return;
  onSquareClick(squareFromCellEl(cell));
});

function onSquareClick(sq: Square) {
  if (game.status !== "playing") return;
  if (diceStage || pendingPromotion) return;

  if (selected) {
    const matches = legalTargets.filter((m) => sameSquare(m.to, sq));
    if (matches.length > 0) {
      if (matches.length > 1) {
        pendingPromotion = { moves: matches };
        render();
        return;
      }
      playMove(matches[0]);
      return;
    }
  }

  const piece = getPiece(game.board, sq);
  const restrictTo = game.pendingExtraMovePieceId;
  if (piece && piece.color === game.turn && (!restrictTo || piece.id === restrictTo)) {
    selected = sq;
    legalTargets = game.getLegalMovesFrom(sq);
  } else {
    selected = null;
    legalTargets = [];
  }
  render();
}

function playMove(move: Move) {
  const result = game.makeMove(move);
  logEntries.push({ text: formatMove(move), kind: "move" });
  for (const m of result.messages) logEntries.push({ text: m, kind: "info" });

  selected = null;
  legalTargets = [];
  pendingPromotion = null;

  if (result.pendingDiceRoll) {
    diceStage = "prompt";
  }
  render();
}

function choosePromotion(type: PieceType) {
  if (!pendingPromotion) return;
  const move = pendingPromotion.moves.find((m) => m.promotion === type);
  pendingPromotion = null;
  if (move) playMove(move);
  else render();
}

function startDiceRoll() {
  diceStage = "rolling";
  render();
  window.setTimeout(() => {
    const result = game.rollPendingDice();
    for (const m of result.messages) logEntries.push({ text: m, kind: "info" });
    diceRollData = result.diceRoll;
    diceStage = "result";
    render();
  }, 650);
}

function dismissDiceModal() {
  diceStage = null;
  diceRollData = null;
  render();
}

function render() {
  renderStatusBar();
  renderBoard();
  renderCaptures();
  renderLog();
  renderOverlays();
}

function renderStatusBar() {
  let html = "";
  if (game.status === "checkmate") {
    const winnerLabel = game.winner === "w" ? "Brancas" : "Pretas";
    html += `<div class="game-over-banner">Xeque-mate! Vencem as ${winnerLabel}.</div>`;
  } else if (game.status === "stalemate") {
    html += `<div class="game-over-banner">Empate por afogamento.</div>`;
  } else {
    const turnLabel = game.turn === "w" ? "Brancas" : "Pretas";
    html += `<span class="turn-chip ${game.turn}">Vez: ${turnLabel}</span>`;
    if (isInCheck(game.board, game.turn)) {
      html += `<span class="check-flag">Xeque!</span>`;
    }
    if (game.pendingExtraMovePieceId) {
      html += `<span class="extra-move-banner">Movimento extra do Psychopath — joga outra vez com a mesma peça!</span>`;
    }
  }
  statusBarEl.innerHTML = html;
}

function renderBoard() {
  boardEl.classList.toggle("flipped", game.turn === "b");

  const kingInCheckSq =
    game.status === "playing" && isInCheck(game.board, game.turn)
      ? findKingSquare(game.turn)
      : null;

  let html = "";
  for (let displayRow = 7; displayRow >= 0; displayRow--) {
    for (let col = 0; col < 8; col++) {
      const sq: Square = { row: displayRow, col };
      const piece = getPiece(game.board, sq);
      const isLight = (displayRow + col) % 2 === 0;
      const classes = ["square", isLight ? "light" : "dark"];
      if (selected && sameSquare(selected, sq)) classes.push("selected");
      const targetMove = legalTargets.find((m) => sameSquare(m.to, sq));
      if (targetMove) classes.push(targetMove.captured || targetMove.isEnPassant ? "target-capture" : "target");
      if (kingInCheckSq && sameSquare(kingInCheckSq, sq)) classes.push("in-check");

      let inner = "";
      if (piece) {
        const glyph = GLYPH[piece.color][piece.type];
        const big = mainBadge(piece);
        const corner = cornerBadge(piece);
        let ring = "";
        if (piece.isBloodlust) ring = "bloodlust";
        else if (piece.locked === "psychopath") ring = "psychopath";
        else if (piece.active === "devastated") ring = "devastated";
        else if (piece.active === "guiltridden") ring = "guiltridden";

        inner += `<span class="piece-glyph ${piece.color === "w" ? "white" : "black"}">${glyph}</span>`;
        if (ring) inner += `<span class="status-ring ${ring}"></span>`;
        if (big) {
          inner += `<span class="badge-dot main" title="${big.visual.label}" style="background:${big.visual.color}">${
            big.count !== undefined ? `<span class="count">${big.count}</span>` : ""
          }</span>`;
        }
        if (corner) {
          inner += `<span class="badge-dot corner" title="${corner.label}" style="background:${corner.color}"></span>`;
        }
      }

      html += `<div class="${classes.join(" ")}" data-row="${sq.row}" data-col="${sq.col}" title="${squareToAlgebraic(sq)}">${inner}</div>`;
    }
  }
  boardEl.innerHTML = html;
}

function findKingSquare(color: Color): Square | null {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const p = getPiece(game.board, { row, col });
      if (p && p.type === "K" && p.color === color) return { row, col };
    }
  }
  return null;
}

function renderCaptures() {
  // Pieces Black has captured (from White) sit above the board; White's captures sit below —
  // each row shows small glyphs of the captured pieces plus the leader's point advantage.
  const whitePts = game.capturedPoints("w");
  const blackPts = game.capturedPoints("b");
  const diff = whitePts - blackPts;

  capturesTopEl.innerHTML = capturesRowHtml(game.capturedBy.b, diff < 0 ? -diff : null);
  capturesBottomEl.innerHTML = capturesRowHtml(game.capturedBy.w, diff > 0 ? diff : null);
}

function capturesRowHtml(captured: Piece[], advantage: number | null): string {
  const order: PieceType[] = ["Q", "R", "B", "N", "P"];
  const sorted = [...captured].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const icons = sorted
    .map((p) => `<span class="capture-icon ${p.color === "w" ? "white" : "black"}">${GLYPH[p.color][p.type]}</span>`)
    .join("");
  const adv = advantage ? `<span class="capture-advantage">+${advantage}</span>` : "";
  return `${icons}${adv}`;
}

function renderLog() {
  logEl.innerHTML = logEntries
    .map((e) => `<div class="entry ${e.kind}">${e.kind === "move" ? "▸ " : ""}${e.text}</div>`)
    .join("");
  logEl.scrollTop = logEl.scrollHeight;
}

function renderOverlays() {
  document.querySelectorAll(".overlay").forEach((el) => el.remove());

  if (diceStage) {
    const overlay = document.createElement("div");
    overlay.className = "overlay";

    if (diceStage === "prompt") {
      overlay.innerHTML = `
        <div class="dice-modal">
          <div>Captura! Que destino espera esta peça?</div>
          <div class="die-face idle">🎲</div>
          <button id="dice-roll-btn">Lançar o dado</button>
        </div>
      `;
      document.body.appendChild(overlay);
      document.getElementById("dice-roll-btn")!.addEventListener("click", startDiceRoll);
    } else if (diceStage === "rolling") {
      overlay.innerHTML = `
        <div class="dice-modal">
          <div>A lançar o dado...</div>
          <div class="die-face spinning">🎲</div>
        </div>
      `;
      document.body.appendChild(overlay);
    } else if (diceStage === "result" && diceRollData) {
      const legend = STATUS_LEGEND.find((s) => s.key === diceRollData!.category)!;
      overlay.innerHTML = `
        <div class="dice-modal">
          <div>Dado de captura</div>
          <div class="die-face">${diceRollData.face ? diceFaceGlyph(diceRollData.face) : "🎲"}</div>
          <div class="dice-result-title" style="color:${legend.color}"><span class="legend-dot" style="background:${legend.color}"></span> ${legend.label}</div>
          <div class="dice-result-desc">${legend.desc}</div>
          <button id="dice-ok">Continuar</button>
        </div>
      `;
      document.body.appendChild(overlay);
      document.getElementById("dice-ok")!.addEventListener("click", dismissDiceModal);
    }
    return;
  }

  if (pendingPromotion) {
    const color = pendingPromotion.moves[0].piece.color;
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="promo-modal">
        <div>Promover peão para:</div>
        <div class="promo-options">
          ${(["Q", "R", "B", "N"] as PieceType[])
            .map(
              (t) =>
                `<button data-type="${t}" class="secondary promo-${t}">${GLYPH[color][t]}<div style="font-size:11px">${PROMO_LABEL[t]}</div></button>`
            )
            .join("")}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll("button[data-type]").forEach((btn) => {
      btn.addEventListener("click", () => choosePromotion((btn as HTMLElement).dataset.type as PieceType));
    });
  }
}

function diceFaceGlyph(face: number): string {
  const faces = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  return faces[face] ?? "🎲";
}

render();

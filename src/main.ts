import "./style.css";
import { Game, PIECE_VALUE } from "./engine/game";
import { getPiece, sameSquare, squareToAlgebraic } from "./engine/board";
import { isInCheck } from "./engine/movegen";
import type { Color, DieFace, DiceRollResult, Move, Piece, PieceType, Square } from "./engine/types";
import { cornerBadge, mainBadge, STATUS_LEGEND } from "./ui/status";
import { formatMove } from "./ui/notation";
import { OnlineSession, roomLinkFor, type NetMessage, type OnlineRole } from "./net/online";

// Both colors use the same solid (filled) glyph shapes — only the fill/outline
// CSS colors differ — so White pieces render filled instead of hollow-outline.
// The trailing U+FE0E forces TEXT presentation: without it, some mobile browsers
// (iOS/Android) render these chess symbols with their own fixed-color emoji-style
// glyph instead of plain text, which ignores our CSS color/outline entirely and
// makes white and black pieces look identical — this only shows up on phones
// because desktop font stacks already default to text presentation for them.
const SOLID_GLYPH: Record<PieceType, string> = {
  K: "♚︎", Q: "♛︎", R: "♜︎", B: "♝︎", N: "♞︎", P: "♟︎",
};
const GLYPH: Record<Color, Record<PieceType, string>> = { w: SOLID_GLYPH, b: SOLID_GLYPH };

const PROMO_LABEL: Record<string, string> = { Q: "Dama", R: "Torre", B: "Bispo", N: "Cavalo" };

const RULES_HTML = `
  <p>RemorseChess é xadrez normal — as peças movem-se e capturam como seria de esperar, com roque, en passant e promoção incluídos — mas com uma mecânica extra: <b>sempre que uma peça captura outra, lança-se um dado de 6 faces</b> para decidir o que lhe acontece a seguir.</p>

  <h4>O dado de captura</h4>
  <ul>
    <li><span class="rules-dot" style="background:var(--c-devastated)"></span><b>1 — Devastated:</b> a peça fica congelada e não se pode mexer. Um bispo da mesma equipa tem de chegar a uma casa adjacente a ela dentro de 3 turnos, senão a peça sai do jogo. Se a própria peça Devastated for um bispo, não precisa de ajuda — recupera sozinha ao fim de 3 turnos.</li>
    <li><span class="rules-dot" style="background:var(--c-guiltridden)"></span><b>2 ou 3 — Guilt Ridden:</b> a peça continua a mover-se normalmente, mas não pode capturar nem dar xeque. Um bispo da mesma equipa tem de chegar a uma casa adjacente a ela; a peça volta ao normal no turno seguinte. Um bispo Guilt Ridden recupera sozinho, sem ajuda, dois turnos depois. Um peão Guilt Ridden pode promover — a peça promovida mantém o estado, a não ser que promova a bispo, caso em que fica logo normal.</li>
    <li><span class="rules-dot" style="background:var(--c-unbothered)"></span><b>4 ou 5 — Unbothered:</b> não acontece nada — a peça fica só marcada para referência futura, mas joga sempre normalmente.</li>
    <li><span class="rules-dot" style="background:var(--c-psychopath)"></span><b>6 — Psychopath:</b> a peça ganha um movimento extra sempre que captura (no máximo uma vez por turno). Depois de somar 3 capturas desde que se tornou Psychopath, entra em <b style="color:var(--c-bloodlust)">Bloodlust</b>: a partir daí só se pode mover para capturar — mesmo peças da própria equipa.</li>
  </ul>

  <h4>Uma regra importante</h4>
  <p>Depois de uma peça ganhar um estado, esse estado é permanente até ao fim do jogo. Se a peça for "curada" (por um bispo, ou ao promover a bispo) e voltar a capturar mais tarde, o dado <b>não</b> é lançado outra vez — aplica-se automaticamente o mesmo estado de antes.</p>

  <h4>Identificar os estados no tabuleiro</h4>
  <p>Cada peça com um estado tem um círculo colorido: <b>grande e destacado</b> quando o estado está ativo neste momento, <b>pequeno e discreto</b> no canto quando a peça já tem um estado atribuído mas não está ativo agora. As cores correspondem à legenda "Estados das Peças" ao lado do tabuleiro.</p>

  <h4>Formas de jogar</h4>
  <p><b>Mesmo dispositivo:</b> os dois jogadores jogam alternadamente no mesmo ecrã — em telemóvel, o tabuleiro vira automaticamente a cada turno para quem está a jogar.</p>
  <p><b>Online:</b> um jogador cria uma sala em "Jogar Online" e envia o link ao adversário; cada um joga depois a partir do seu próprio dispositivo.</p>
`;

type DiceStage = "prompt" | "rolling" | "result" | "waiting" | null;
type OnlineStatus = "idle" | "hosting-wait" | "joining" | "connected" | "error";

interface OnlineState {
  session: OnlineSession;
  role: OnlineRole;
  myColor: Color;
}

let game = new Game();
let selected: Square | null = null;
let legalTargets: Move[] = [];
let pendingPromotion: { moves: Move[] } | null = null;
let diceStage: DiceStage = null;
let diceRollData: DiceRollResult | null = null;
let logEntries: { text: string; kind: "move" | "info" }[] = [];

let online: OnlineState | null = null;
let onlineStatus: OnlineStatus = "idle";
let onlineError: string | null = null;
let roomCode: string | null = null;
let rulesOpen = false;

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="main-col">
    <h1><span class="remorse">Remorse</span>Chess</h1>
    <p class="subtitle">Humano vs. humano, no mesmo dispositivo ou online</p>
    <div id="status-bar" class="status-bar"></div>
    <div id="captures-top" class="captures-row"></div>
    <div id="board" class="board"></div>
    <div id="captures-bottom" class="captures-row"></div>
    <div style="margin-top:14px; display:flex; gap:10px;">
      <button id="new-game" class="secondary">Novo Jogo</button>
      <button id="rules-btn" class="secondary">Regras</button>
    </div>
  </div>
  <div class="side-col">
    <div class="panel" id="online-panel">
      <h2>Jogar Online</h2>
      <div id="online-content"></div>
    </div>
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
const onlineContentEl = document.getElementById("online-content")!;

legendPanel.innerHTML += STATUS_LEGEND.map(
  (s) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${s.color}"></div>
      <div><b style="color:${s.color}">${s.label}</b><span class="desc">${s.desc}</span></div>
    </div>`
).join("");

document.getElementById("new-game")!.addEventListener("click", () => {
  if (online && onlineStatus === "connected") {
    online.session.send({ type: "newGame" });
  }
  resetGame();
});

document.getElementById("rules-btn")!.addEventListener("click", () => {
  rulesOpen = true;
  render();
});

function resetGame() {
  game = new Game();
  selected = null;
  legalTargets = [];
  pendingPromotion = null;
  diceStage = null;
  diceRollData = null;
  logEntries = [];
  render();
}

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
  if (diceStage || pendingPromotion || rulesOpen) return;
  if (online && onlineStatus !== "connected") return;
  if (online && game.turn !== online.myColor) return;

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

/** A move the LOCAL player just chose (click or promotion pick) — relayed to the peer, if any. */
function playMove(move: Move) {
  if (online && onlineStatus === "connected") {
    online.session.send({ type: "move", from: move.from, to: move.to, promotion: move.promotion });
  }
  commitMove(move, true);
}

/** The same move, as replayed from a message the peer sent us. */
function applyIncomingMove(move: Move) {
  commitMove(move, false);
}

function commitMove(move: Move, isLocal: boolean) {
  const result = game.makeMove(move);
  logEntries.push({ text: formatMove(move), kind: "move" });
  for (const m of result.messages) logEntries.push({ text: m, kind: "info" });

  selected = null;
  legalTargets = [];
  pendingPromotion = null;

  if (result.pendingDiceRoll) {
    diceStage = isLocal ? "prompt" : "waiting";
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

/** Rolls the pending capture die. `forcedFace` replays a roll the peer already made. */
function runDiceRoll(forcedFace?: DieFace) {
  diceStage = "rolling";
  render();
  window.setTimeout(() => {
    const result = game.rollPendingDice(forcedFace);
    for (const m of result.messages) logEntries.push({ text: m, kind: "info" });
    diceRollData = result.diceRoll;
    diceStage = "result";
    if (forcedFace === undefined && online && onlineStatus === "connected" && result.diceRoll.face) {
      online.session.send({ type: "diceRoll", face: result.diceRoll.face });
    }
    render();
  }, 650);
}

function dismissDiceModal() {
  diceStage = null;
  diceRollData = null;
  render();
}

function handleNetMessage(msg: NetMessage) {
  if (msg.type === "move") {
    const candidates = game.getLegalMovesFrom(msg.from);
    const move = candidates.find(
      (m) => sameSquare(m.to, msg.to) && (m.promotion ?? null) === (msg.promotion ?? null)
    );
    if (move) applyIncomingMove(move);
    return;
  }
  if (msg.type === "diceRoll") {
    if (game.pendingDiceRollPieceId) runDiceRoll(msg.face);
    return;
  }
  if (msg.type === "newGame") {
    resetGame();
    return;
  }
}

// ---------------------------------------------------------------------------
// Online: create/join a room over a direct WebRTC connection (PeerJS).
// ---------------------------------------------------------------------------

async function startHosting() {
  resetGame();
  onlineStatus = "hosting-wait";
  roomCode = null;
  onlineError = null;
  renderOnlinePanel();

  const session = new OnlineSession();
  online = { session, role: "host", myColor: "w" };
  session.onMessage = handleNetMessage;
  session.onConnected = () => {
    onlineStatus = "connected";
    resetGame();
  };
  session.onDisconnected = () => {
    onlineStatus = "error";
    onlineError = "O adversário desconectou-se.";
    renderOnlinePanel();
  };
  session.onError = (message) => {
    onlineStatus = "error";
    onlineError = message;
    renderOnlinePanel();
  };

  try {
    roomCode = await session.host();
    renderOnlinePanel();
  } catch (e) {
    onlineStatus = "error";
    onlineError = e instanceof Error ? e.message : "Erro ao criar a sala.";
    online = null;
    renderOnlinePanel();
  }
}

async function joinOnline(code: string) {
  resetGame();
  onlineStatus = "joining";
  onlineError = null;
  renderOnlinePanel();

  const session = new OnlineSession();
  online = { session, role: "joiner", myColor: "b" };
  session.onMessage = handleNetMessage;
  session.onConnected = () => {
    onlineStatus = "connected";
    resetGame();
  };
  session.onDisconnected = () => {
    onlineStatus = "error";
    onlineError = "O adversário desconectou-se.";
    renderOnlinePanel();
  };
  session.onError = (message) => {
    onlineStatus = "error";
    onlineError = message;
    renderOnlinePanel();
  };

  try {
    await session.join(code);
  } catch (e) {
    onlineStatus = "error";
    onlineError = e instanceof Error ? e.message : "Erro ao ligar à sala.";
    online = null;
    renderOnlinePanel();
  }
}

function leaveOnline() {
  online?.session.close();
  online = null;
  onlineStatus = "idle";
  onlineError = null;
  roomCode = null;
  const url = new URL(window.location.href);
  url.search = "";
  window.history.replaceState({}, "", url.toString());
  resetGame();
  renderOnlinePanel();
}

async function copyRoomLink() {
  if (!roomCode) return;
  const link = roomLinkFor(roomCode);
  const btn = document.getElementById("copy-link-btn");
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    const input = document.getElementById("room-link-input") as HTMLInputElement | null;
    input?.select();
    document.execCommand("copy");
  }
  if (btn) {
    const old = btn.textContent;
    btn.textContent = "Copiado!";
    window.setTimeout(() => {
      btn.textContent = old;
    }, 1500);
  }
}

function renderOnlinePanel() {
  if (onlineStatus === "idle") {
    onlineContentEl.innerHTML = `
      <p class="online-desc">Cria uma sala e envia o link a um amigo para jogarem em dispositivos diferentes.</p>
      <button id="host-btn">Criar Sala</button>
    `;
    document.getElementById("host-btn")!.addEventListener("click", startHosting);
  } else if (onlineStatus === "hosting-wait") {
    if (roomCode) {
      const link = roomLinkFor(roomCode);
      onlineContentEl.innerHTML = `
        <p class="online-desc">Envia este link ao teu adversário:</p>
        <div class="room-link-row">
          <input id="room-link-input" type="text" readonly value="${link}">
          <button id="copy-link-btn" class="secondary">Copiar</button>
        </div>
        <p class="online-status-waiting">A aguardar que o adversário entre na sala...</p>
      `;
      document.getElementById("copy-link-btn")!.addEventListener("click", copyRoomLink);
    } else {
      onlineContentEl.innerHTML = `<p class="online-desc">A criar a sala...</p>`;
    }
  } else if (onlineStatus === "joining") {
    onlineContentEl.innerHTML = `<p class="online-desc">A ligar à sala...</p>`;
  } else if (onlineStatus === "connected" && online) {
    const colorLabel = online.myColor === "w" ? "Brancas" : "Pretas";
    onlineContentEl.innerHTML = `
      <p class="online-connected">🟢 Ligado — a jogar como <b>${colorLabel}</b></p>
      <button id="leave-btn" class="secondary">Sair da Sala</button>
    `;
    document.getElementById("leave-btn")!.addEventListener("click", leaveOnline);
  } else if (onlineStatus === "error") {
    onlineContentEl.innerHTML = `
      <p class="online-error">${onlineError ?? "Ocorreu um erro."}</p>
      <button id="retry-btn" class="secondary">Tentar novamente</button>
    `;
    document.getElementById("retry-btn")!.addEventListener("click", () => {
      onlineStatus = "idle";
      onlineError = null;
      online = null;
      renderOnlinePanel();
    });
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  renderStatusBar();
  renderBoard();
  renderCaptures();
  renderLog();
  renderOnlinePanel();
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
  const flip = online ? online.myColor === "b" : game.turn === "b";
  boardEl.classList.toggle("flipped", flip);

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

  if (rulesOpen) {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="rules-modal">
        <div class="rules-header">
          <h3>Como jogar RemorseChess</h3>
          <button id="rules-close" class="secondary rules-close-btn" aria-label="Fechar">✕</button>
        </div>
        <div class="rules-content">${RULES_HTML}</div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("rules-close")!.addEventListener("click", () => {
      rulesOpen = false;
      render();
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        rulesOpen = false;
        render();
      }
    });
    return;
  }

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
      document.getElementById("dice-roll-btn")!.addEventListener("click", () => runDiceRoll());
    } else if (diceStage === "waiting") {
      overlay.innerHTML = `
        <div class="dice-modal">
          <div>Captura! O adversário vai lançar o dado...</div>
          <div class="die-face idle">🎲</div>
        </div>
      `;
      document.body.appendChild(overlay);
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

const initialRoomParam = new URLSearchParams(window.location.search).get("room");
if (initialRoomParam) {
  joinOnline(initialRoomParam.toUpperCase());
}

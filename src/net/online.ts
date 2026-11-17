import Peer, { type DataConnection } from "peerjs";
import type { Color, DieFace, PieceType, Square } from "../engine/types";

export type NetMessage =
  | { type: "move"; from: Square; to: Square; promotion?: PieceType }
  | { type: "diceRoll"; face: DieFace }
  | { type: "newGame" };

export type OnlineRole = "host" | "joiner";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion

function randomRoomCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export function roomLinkFor(code: string): string {
  const url = new URL(window.location.href);
  url.search = `?room=${code}`;
  return url.toString();
}

export class OnlineSession {
  peer: Peer | null = null;
  conn: DataConnection | null = null;
  role: OnlineRole | null = null;
  roomCode: string | null = null;

  onConnected: () => void = () => {};
  onMessage: (msg: NetMessage) => void = () => {};
  onDisconnected: () => void = () => {};
  onError: (message: string) => void = () => {};

  get myColor(): Color {
    return this.role === "host" ? "w" : "b";
  }

  /** Creates a room and waits for an opponent to join. Resolves with the shareable room code. */
  host(): Promise<string> {
    this.role = "host";
    return new Promise((resolve, reject) => {
      const attempt = (triesLeft: number) => {
        const code = randomRoomCode();
        const peer = new Peer(`remorsechess-${code}`);
        this.peer = peer;

        peer.on("open", () => {
          this.roomCode = code;
          resolve(code);
        });

        peer.on("connection", (conn) => {
          this.conn = conn;
          this.wireConnection(conn);
        });

        peer.on("error", (err: any) => {
          if (err?.type === "unavailable-id" && triesLeft > 0) {
            peer.destroy();
            attempt(triesLeft - 1);
          } else if (!this.roomCode) {
            reject(new Error("Não foi possível criar a sala. Tenta novamente."));
          } else {
            this.onError("Ligação perdida: " + (err?.type ?? "erro desconhecido"));
          }
        });
      };
      attempt(5);
    });
  }

  /** Joins an existing room by its code. */
  join(code: string): Promise<void> {
    this.role = "joiner";
    this.roomCode = code;
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      this.peer = peer;
      let settled = false;

      peer.on("open", () => {
        const conn = peer.connect(`remorsechess-${code}`, { reliable: true });
        this.conn = conn;

        conn.on("open", () => {
          settled = true;
          this.wireConnection(conn);
          resolve();
        });
        conn.on("error", () => {
          if (!settled) {
            settled = true;
            reject(new Error("Não foi possível ligar a essa sala. Verifica o link."));
          }
        });
      });

      peer.on("error", (err: any) => {
        if (!settled) {
          settled = true;
          reject(new Error("Não foi possível ligar a essa sala. Verifica o link."));
        } else {
          this.onError("Ligação perdida: " + (err?.type ?? "erro desconhecido"));
        }
      });
    });
  }

  private wireConnection(conn: DataConnection) {
    conn.on("data", (data) => {
      try {
        const msg = data as NetMessage;
        if (msg && typeof msg === "object" && "type" in msg) {
          this.onMessage(msg);
        }
      } catch {
        // ignore malformed messages
      }
    });
    conn.on("close", () => this.onDisconnected());
    conn.on("error", () => this.onDisconnected());
    this.onConnected();
  }

  send(msg: NetMessage) {
    this.conn?.send(msg);
  }

  close() {
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
  }
}

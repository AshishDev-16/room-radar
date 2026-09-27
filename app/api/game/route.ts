import { env } from "cloudflare:workers";
import { QUESTIONS } from "@/lib/questions";

type Phase = "lobby" | "playing" | "reveal" | "finished";
type Player = { id: string; token: string; name: string; score: number; doubleAvailable: boolean };
type Submission = { option: number; doubled: boolean; points: number };
type Room = {
  code: string; phase: Phase; hostId: string; players: Player[]; round: number;
  totalRounds: number; questionIds: number[]; submissions: Record<string, Submission>;
  createdAt: string; updatedAt: string;
};
type Row = { state: string; version: number };

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function cleanName(value: unknown) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 18);
}
function cleanCode(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}
function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}
function randomQuestions(count: number) {
  const ids = QUESTIONS.map((_, index) => index);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, count);
}
function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
async function readRoom(code: string) {
  const row = await env.DB.prepare("SELECT state, version FROM rooms WHERE code = ?").bind(code).first<Row>();
  return row ? { room: JSON.parse(row.state) as Room, version: row.version } : null;
}
async function mutateRoom(code: string, change: (room: Room) => void) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readRoom(code);
    if (!current) throw new Error("ROOM_NOT_FOUND");
    change(current.room);
    current.room.updatedAt = new Date().toISOString();
    const result = await env.DB.prepare(
      "UPDATE rooms SET state = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?"
    ).bind(JSON.stringify(current.room), current.room.updatedAt, code, current.version).run();
    if ((result.meta.changes ?? 0) === 1) return current.room;
  }
  throw new Error("ROOM_BUSY");
}
function playerFor(room: Room, token: string) {
  return room.players.find((player) => player.token === token);
}
function view(room: Room, token: string) {
  const me = playerFor(room, token);
  if (!me) throw new Error("PLAYER_NOT_FOUND");
  const hotSeat = room.players[room.round % Math.max(room.players.length, 1)];
  const questionId = room.questionIds[room.round];
  const question = questionId === undefined ? null : QUESTIONS[questionId];
  const actual = hotSeat ? room.submissions[hotSeat.id]?.option : undefined;
  const reveal = room.phase === "reveal" || room.phase === "finished" ? {
    actualOption: actual,
    picks: room.players.map((player) => ({
      playerId: player.id,
      option: room.submissions[player.id]?.option,
      doubled: room.submissions[player.id]?.doubled ?? false,
      points: room.submissions[player.id]?.points ?? 0,
      correct: player.id === hotSeat?.id ? true : room.submissions[player.id]?.option === actual,
    })),
  } : null;
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    totalRounds: room.totalRounds,
    question,
    hotSeat: hotSeat ? { id: hotSeat.id, name: hotSeat.name } : null,
    role: hotSeat?.id === me.id ? "hot-seat" : "predictor",
    me: { id: me.id, name: me.name, score: me.score, doubleAvailable: me.doubleAvailable, isHost: me.id === room.hostId },
    players: room.players.map(({ id, name, score }) => ({ id, name, score })),
    submitted: Boolean(room.submissions[me.id]),
    submittedCount: Object.keys(room.submissions).length,
    reveal,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = cleanCode(url.searchParams.get("code"));
    const token = String(url.searchParams.get("token") ?? "");
    const current = await readRoom(code);
    if (!current) return fail("That room does not exist.", 404);
    return Response.json({ game: view(current.room, token) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "PLAYER_NOT_FOUND") return fail("Your player session is no longer in this room.", 401);
    return fail("The room is temporarily unavailable.", 500);
  }
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; }
  catch { return fail("Invalid request."); }
  const action = String(payload.action ?? "");
  const name = cleanName(payload.name);
  const token = String(payload.token ?? "").slice(0, 80);

  try {
    if (action === "create") {
      if (!name) return fail("Enter a display name.");
      if (!token) return fail("Player token is required.");
      for (let attempt = 0; attempt < 12; attempt++) {
        const code = randomCode();
        const now = new Date().toISOString();
        const player: Player = { id: crypto.randomUUID(), token, name, score: 0, doubleAvailable: true };
        const room: Room = { code, phase: "lobby", hostId: player.id, players: [player], round: 0, totalRounds: 8, questionIds: [], submissions: {}, createdAt: now, updatedAt: now };
        const result = await env.DB.prepare("INSERT OR IGNORE INTO rooms (code, state, version, updated_at) VALUES (?, ?, 1, ?)")
          .bind(code, JSON.stringify(room), now).run();
        if ((result.meta.changes ?? 0) === 1) return Response.json({ game: view(room, token) }, { status: 201 });
      }
      return fail("Could not create a room. Try again.", 503);
    }

    const code = cleanCode(payload.code);
    if (action === "join") {
      if (!name) return fail("Enter a display name.");
      if (!token || code.length !== 5) return fail("Enter a valid room code.");
      const room = await mutateRoom(code, (draft) => {
        const existing = playerFor(draft, token);
        if (existing) return;
        if (draft.phase !== "lobby") throw new Error("GAME_STARTED");
        if (draft.players.length >= 8) throw new Error("ROOM_FULL");
        if (draft.players.some((player) => player.name.toLowerCase() === name.toLowerCase())) throw new Error("NAME_TAKEN");
        draft.players.push({ id: crypto.randomUUID(), token, name, score: 0, doubleAvailable: true });
      });
      return Response.json({ game: view(room, token) });
    }

    const room = await mutateRoom(code, (draft) => {
      const me = playerFor(draft, token);
      if (!me) throw new Error("PLAYER_NOT_FOUND");
      if (action === "start") {
        if (draft.hostId !== me.id) throw new Error("HOST_ONLY");
        if (draft.phase !== "lobby") throw new Error("BAD_PHASE");
        if (draft.players.length < 2) throw new Error("NEED_PLAYERS");
        draft.totalRounds = Math.max(8, draft.players.length);
        draft.questionIds = randomQuestions(draft.totalRounds);
        draft.round = 0; draft.submissions = {}; draft.phase = "playing";
      } else if (action === "submit") {
        if (draft.phase !== "playing") throw new Error("BAD_PHASE");
        if (draft.submissions[me.id]) throw new Error("ALREADY_SUBMITTED");
        const option = Number(payload.option);
        if (!Number.isInteger(option) || option < 0 || option > 3) throw new Error("BAD_OPTION");
        const hotSeat = draft.players[draft.round % draft.players.length];
        const doubled = Boolean(payload.doubled) && me.id !== hotSeat.id && me.doubleAvailable;
        draft.submissions[me.id] = { option, doubled, points: 0 };
        if (doubled) me.doubleAvailable = false;
        if (Object.keys(draft.submissions).length === draft.players.length) {
          const actual = draft.submissions[hotSeat.id].option;
          for (const player of draft.players) {
            if (player.id === hotSeat.id) continue;
            const pick = draft.submissions[player.id];
            if (pick.option === actual) {
              pick.points = pick.doubled ? 4 : 2;
              player.score += pick.points;
            }
          }
          draft.phase = "reveal";
        }
      } else if (action === "next") {
        if (draft.hostId !== me.id) throw new Error("HOST_ONLY");
        if (draft.phase !== "reveal") throw new Error("BAD_PHASE");
        if (draft.round + 1 >= draft.totalRounds) draft.phase = "finished";
        else { draft.round += 1; draft.submissions = {}; draft.phase = "playing"; }
      } else if (action === "replay") {
        if (draft.hostId !== me.id) throw new Error("HOST_ONLY");
        if (draft.phase !== "finished") throw new Error("BAD_PHASE");
        draft.players.forEach((player) => { player.score = 0; player.doubleAvailable = true; });
        draft.questionIds = randomQuestions(draft.totalRounds);
        draft.round = 0; draft.submissions = {}; draft.phase = "playing";
      } else {
        throw new Error("BAD_ACTION");
      }
    });
    return Response.json({ game: view(room, token) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const messages: Record<string, [string, number]> = {
      ROOM_NOT_FOUND: ["That room does not exist.", 404], ROOM_BUSY: ["The room is busy. Try again.", 409],
      GAME_STARTED: ["That game has already started.", 409], ROOM_FULL: ["That room is full.", 409],
      NAME_TAKEN: ["That name is already in the room.", 409], PLAYER_NOT_FOUND: ["Your player session is invalid.", 401],
      HOST_ONLY: ["Only the host can do that.", 403], NEED_PLAYERS: ["At least two players are needed.", 409],
      BAD_PHASE: ["That action is not available right now.", 409], ALREADY_SUBMITTED: ["Your answer is already locked.", 409],
      BAD_OPTION: ["Choose one of the four answers.", 400], BAD_ACTION: ["Unknown game action.", 400],
    };
    const known = messages[code];
    return known ? fail(known[0], known[1]) : fail("The game hit a temporary problem.", 500);
  }
}

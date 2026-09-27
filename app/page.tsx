"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Award, Check, Copy, Crown, HeartHandshake, Radio, RotateCcw, ShieldQuestion, Sparkles, Users, Zap } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";

type Player = { id: string; name: string; score: number };
type Pick = { playerId: string; option?: number; doubled: boolean; points: number; correct: boolean };
type Game = {
  code: string; phase: "lobby" | "playing" | "reveal" | "finished"; round: number; totalRounds: number;
  pack: "mixed" | "everyday" | "chaos" | "close";
  question: { prompt: string; options: string[] } | null; hotSeat: { id: string; name: string } | null;
  role: "hot-seat" | "predictor"; me: Player & { doubleAvailable: boolean; isHost: boolean };
  players: Player[]; submitted: boolean; submittedCount: number;
  reveal: { actualOption?: number; picks: Pick[] } | null;
  strongestConnection: { reader?: string; target?: string; hits: number } | null;
  awards: { mindReader?: string; boldestSignal?: string; mostMysterious?: string } | null;
  hostInactive: boolean;
};
type Session = { code: string; token: string };
type ApiResult = { game?: Game; error?: string };

const SESSION_KEY = "room-radar-session";
const optionLetters = ["A", "B", "C", "D"];
const packOptions = [
  { id: "mixed", name: "Mixed Signals", note: "A little bit of everything" },
  { id: "everyday", name: "Everyday Radar", note: "Easy, fast, and friendly" },
  { id: "chaos", name: "Chaos Mode", note: "Stranger choices, louder debates" },
  { id: "close", name: "Close Friends", note: "Taste, habits, and personality" },
] as const;

function Logo() {
  return (
    <div className="flex items-center gap-3 font-black tracking-[-0.03em]">
      <span className="grid size-10 place-items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-cyan-300 shadow-[0_0_30px_rgba(34,211,238,.16)]">
        <Radio className="size-5" />
      </span>
      <span className="text-lg">ROOM RADAR</span>
    </div>
  );
}

function Rules() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="rounded-full border border-white/12 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-white/30 hover:text-white">How to play</button>
      </DialogTrigger>
      <DialogContent className="border-white/15 bg-[#0c1924] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black">Read your friends. Score points.</DialogTitle>
          <DialogDescription className="text-slate-400">Every round puts one player in the Hot Seat.</DialogDescription>
        </DialogHeader>
        <ol className="grid gap-4 text-sm leading-6 text-slate-200">
          <li className="flex gap-3"><b className="text-cyan-300">01</b><span>The Hot Seat secretly picks their real answer. Everyone else predicts it.</span></li>
          <li className="flex gap-3"><b className="text-cyan-300">02</b><span>When everyone locks in, all choices reveal together. A correct read earns 2 points.</span></li>
          <li className="flex gap-3"><b className="text-lime-300">03</b><span>Use your one Double Down to make a correct prediction worth 4 points.</span></li>
        </ol>
      </DialogContent>
    </Dialog>
  );
}

export default function Home() {
  const [mode, setMode] = useState<"home" | "create" | "join">("home");
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [doubleDown, setDoubleDown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");

  const fetchGame = useCallback(async (active: Session, quiet = false) => {
    try {
      const response = await fetch(`/api/game?code=${active.code}&token=${encodeURIComponent(active.token)}`, { cache: "no-store" });
      const data = await response.json() as ApiResult;
      if (!response.ok || !data.game) throw new Error(data.error || "Could not refresh the room.");
      setGame(data.game);
      setError("");
    } catch (caught) {
      if (!quiet) setError(caught instanceof Error ? caught.message : "Could not refresh the room.");
    }
  }, []);

  useEffect(() => {
    setBaseUrl(`${window.location.origin}${window.location.pathname}`);
    const params = new URLSearchParams(window.location.search);
    const sharedCode = (params.get("room") || "").toUpperCase().slice(0, 5);
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        const active = JSON.parse(saved) as Session;
        if (!sharedCode || active.code === sharedCode) { setSession(active); void fetchGame(active); return; }
      } catch { localStorage.removeItem(SESSION_KEY); }
    }
    if (sharedCode) { setRoomCode(sharedCode); setMode("join"); }
  }, [fetchGame]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => void fetchGame(session, true), 900);
    return () => window.clearInterval(timer);
  }, [session, fetchGame]);

  useEffect(() => {
    setSelected(null);
    setDoubleDown(false);
  }, [game?.round, game?.phase]);

  const call = useCallback(async (payload: Record<string, unknown>, active = session) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/game", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as ApiResult;
      if (!response.ok || !data.game) throw new Error(data.error || "Something went wrong.");
      setGame(data.game);
      if (active) { setSession(active); localStorage.setItem(SESSION_KEY, JSON.stringify(active)); }
      return data.game;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      throw caught;
    } finally { setBusy(false); }
  }, [session]);

  async function enter(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError("Enter a display name."); return; }
    const token = crypto.randomUUID();
    const code = roomCode.trim().toUpperCase();
    try {
      const result = await call({ action: mode, name, code, token }, null);
      const active = { code: result.code, token };
      setSession(active);
      localStorage.setItem(SESSION_KEY, JSON.stringify(active));
      window.history.replaceState({}, "", `?room=${result.code}`);
    } catch { /* visible error already set */ }
  }

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!session) return;
    try { await call({ action, code: session.code, token: session.token, ...extra }); }
    catch { /* visible error already set */ }
  }

  async function copyInvite() {
    if (!game) return;
    await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?room=${game.code}`);
    setCopied(true); window.setTimeout(() => setCopied(false), 1600);
  }

  function leave() {
    if (session) void fetch("/api/game", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "leave", code: session.code, token: session.token }) });
    localStorage.removeItem(SESSION_KEY);
    window.history.replaceState({}, "", window.location.pathname);
    setSession(null); setGame(null); setMode("home"); setError("");
  }

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool || !session) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({
        name: "read_room_state", title: "Read Room Radar state",
        description: "Read the current Room Radar round, players, and this player's status.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => { await fetchGame(session); return { phase: game?.phase, round: game ? game.round + 1 : null, roomCode: session.code }; },
      }, { signal: lifecycle.signal });
      await context.registerTool({
        name: "submit_room_radar_choice", title: "Submit Room Radar choice",
        description: "Lock this player's answer for the current round.",
        inputSchema: { type: "object", properties: { option: { type: "integer", minimum: 0, maximum: 3 }, doubleDown: { type: "boolean" } }, required: ["option"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: unknown) => {
          const value = input as { option?: number; doubleDown?: boolean };
          if (!Number.isInteger(value.option) || value.option! < 0 || value.option! > 3) throw new Error("option must be an integer from 0 to 3");
          const updated = await call({ action: "submit", code: session.code, token: session.token, option: value.option, doubled: Boolean(value.doubleDown) });
          return { submitted: updated.submitted, phase: updated.phase };
        },
      }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, [session, game?.phase, game?.round, call, fetchGame]);

  if (!game) {
    return (
      <main className="min-h-dvh overflow-hidden bg-[#071018] text-white">
        <div className="radar-grid min-h-dvh">
          <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8"><Logo /><Rules /></header>
          <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 pb-10 pt-8 sm:px-8 lg:grid-cols-[1.08fr_.92fr] lg:pb-20 lg:pt-14">
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[.18em] text-lime-300">
                <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_12px_#bef264]" /> Live social game · 2–8 players
              </div>
              <h1 className="max-w-2xl text-5xl font-black leading-[.94] tracking-[-0.06em] sm:text-7xl">How well do you<span className="block text-cyan-300">read the room?</span></h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">Predict your friends’ choices, reveal everyone at once, and spend your one Double Down when you’re absolutely sure.</p>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-slate-400">
                <span className="flex items-center gap-2"><Users className="size-4 text-cyan-300" /> No accounts</span>
                <span className="flex items-center gap-2"><Zap className="size-4 text-lime-300" /> Eight quick rounds</span>
              </div>
            </div>
            <div className="relative mx-auto w-full max-w-md">
              <div aria-hidden="true" className="radar-orbit absolute -inset-12 hidden rounded-full border border-cyan-300/10 sm:block" />
              <div className="relative rounded-[2rem] border border-white/12 bg-[#0c1924]/95 p-5 shadow-[0_30px_100px_rgba(0,0,0,.45)] backdrop-blur sm:p-7">
                <div className="mb-6 flex items-center justify-between">
                  <div><p className="text-xs font-bold uppercase tracking-[.18em] text-cyan-300">Game terminal</p><h2 className="mt-1 text-2xl font-extrabold tracking-tight">Ready to play?</h2></div>
                  <div className="grid size-14 place-items-center rounded-full border border-cyan-300/25 bg-cyan-300/8"><div className="size-3 rounded-full bg-cyan-300 shadow-[0_0_22px_#22d3ee]" /></div>
                </div>
                {mode === "home" ? (
                  <div className="grid gap-3">
                    <Button onClick={() => setMode("create")} className="h-14 rounded-2xl bg-cyan-300 text-base font-black text-[#061017] hover:bg-cyan-200">Create a room</Button>
                    <Button onClick={() => setMode("join")} variant="outline" className="h-14 rounded-2xl border-white/15 bg-white/5 text-base font-bold text-white hover:bg-white/10 hover:text-white">Join with a code</Button>
                  </div>
                ) : (
                  <form className="grid gap-3" onSubmit={enter}>
                    <label className="text-sm font-bold text-slate-200" htmlFor="name">Your display name</label>
                    <Input id="name" autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={18} placeholder="e.g. Ashish" className="h-13 rounded-2xl border-white/15 bg-[#071018] px-4 text-base text-white placeholder:text-slate-600" />
                    {mode === "join" && <Input aria-label="Room code" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={5} placeholder="ROOM CODE" className="h-13 rounded-2xl border-white/15 bg-[#071018] px-4 text-center font-mono text-lg font-black uppercase tracking-[.25em] text-white placeholder:text-slate-600" />}
                    {error && <p role="alert" className="rounded-xl bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-300">{error}</p>}
                    <Button disabled={busy} className="mt-2 h-14 rounded-2xl bg-lime-300 text-base font-black text-[#101708] hover:bg-lime-200">{busy ? "Connecting…" : mode === "create" ? "Create room" : "Join room"}</Button>
                    <button type="button" onClick={() => { setMode("home"); setError(""); }} className="py-2 text-sm font-semibold text-slate-400 hover:text-white">Back</button>
                  </form>
                )}
                <p className="mt-6 text-center text-xs leading-5 text-slate-500">Works on any phone or laptop. No download needed.</p>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const standings = [...game.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const hotSeatPick = game.reveal?.picks.find((pick) => pick.playerId === game.hotSeat?.id);
  const progress = ((game.round + (game.phase === "reveal" || game.phase === "finished" ? 1 : 0)) / game.totalRounds) * 100;

  return (
    <main className="radar-grid min-h-dvh bg-[#071018] text-white">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Logo />
        <div className="flex items-center gap-2"><Rules /><button onClick={leave} className="hidden rounded-full px-3 py-2 text-sm font-semibold text-slate-500 hover:text-white sm:block">Leave</button></div>
      </header>
      <div className="mx-auto w-full max-w-6xl px-5 pb-10 sm:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[.035] px-4 py-3">
          <div className="flex items-center gap-3"><span className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">Room</span><button onClick={copyInvite} className="flex items-center gap-2 font-mono text-lg font-black tracking-[.18em] text-cyan-300">{game.code}{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</button></div>
          <div className="flex items-center gap-5 text-sm font-bold"><span className="text-slate-400">{game.players.length}/8 players</span>{game.phase !== "lobby" && <span className="text-lime-300">{game.me.score} pts</span>}</div>
        </div>
        {error && <p role="alert" className="mb-5 rounded-xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-300">{error}</p>}
        {!game.me.isHost && game.hostInactive && <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/[.08] px-4 py-3"><span className="text-sm font-bold text-amber-100">The host appears to be offline. Keep the room moving?</span><Button disabled={busy} onClick={() => act("take-host")} className="h-10 rounded-xl bg-amber-300 font-black text-[#1a1204] hover:bg-amber-200">Become host</Button></div>}

        {game.phase === "lobby" && (
          <section className="grid gap-6 lg:grid-cols-[1fr_.78fr]">
            <div className="rounded-[2rem] border border-white/12 bg-[#0c1924]/95 p-6 sm:p-9">
              <p className="text-xs font-bold uppercase tracking-[.18em] text-cyan-300">Waiting room</p>
              <h1 className="mt-2 text-4xl font-black tracking-[-.045em] sm:text-5xl">Bring the room online.</h1>
              <p className="mt-3 max-w-xl text-slate-400">Share the code or invite link. The host can launch as soon as two players are here.</p>
              <button onClick={copyInvite} className="mt-7 flex w-full items-center justify-between gap-4 rounded-2xl border border-dashed border-cyan-300/30 bg-cyan-300/[.06] p-5 text-left">
                <span><span className="block text-xs font-bold uppercase tracking-[.15em] text-slate-500">Invite code</span><span className="mt-1 block font-mono text-3xl font-black tracking-[.25em] text-cyan-300">{game.code}</span></span>
                <span className="grid size-[82px] place-items-center rounded-xl bg-white p-2">{baseUrl && <QRCodeSVG value={`${baseUrl}?room=${game.code}`} size={66} bgColor="#ffffff" fgColor="#071018" level="M" />}</span>
              </button>
              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between"><p className="text-xs font-black uppercase tracking-[.15em] text-slate-500">Question pack</p>{!game.me.isHost && <span className="text-xs text-slate-600">Host chooses</span>}</div>
                <RadioGroup value={game.pack} onValueChange={(pack) => void act("set-pack", { pack })} disabled={!game.me.isHost || busy} className="grid gap-2 sm:grid-cols-2">
                  {packOptions.map((pack) => <label key={pack.id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${game.pack === pack.id ? "border-cyan-300/40 bg-cyan-300/[.08]" : "border-white/8 bg-white/[.025]"}`}><RadioGroupItem value={pack.id} className="mt-1 border-white/20 text-cyan-300" /><span><b className="block text-sm">{pack.name}</b><span className="text-xs leading-5 text-slate-500">{pack.note}</span></span></label>)}
                </RadioGroup>
              </div>
              {game.me.isHost ? <Button disabled={busy || game.players.length < 2} onClick={() => act("start")} className="mt-5 h-14 w-full rounded-2xl bg-lime-300 text-base font-black text-[#111908] hover:bg-lime-200">{game.players.length < 2 ? "Waiting for one more player…" : "Start the game"}</Button> : <div className="mt-5 rounded-2xl bg-white/5 px-4 py-4 text-center text-sm font-bold text-slate-400">Waiting for the host to start…</div>}
            </div>
            <div className="rounded-[2rem] border border-white/12 bg-[#0c1924]/80 p-6">
              <h2 className="flex items-center gap-2 text-lg font-black"><Users className="size-5 text-cyan-300" /> Players online</h2>
              <div className="mt-5 grid gap-3">{game.players.map((player, index) => <div key={player.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[.035] px-4 py-3"><span className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-white/8 text-sm font-black text-cyan-300">{player.name.slice(0, 1).toUpperCase()}</span><b>{player.name}{player.id === game.me.id && <span className="ml-2 text-xs font-semibold text-slate-500">you</span>}</b></span>{index === 0 && <Crown className="size-4 text-lime-300" />}</div>)}</div>
            </div>
          </section>
        )}

        {(game.phase === "playing" || game.phase === "reveal") && game.question && (
          <section>
            <div className="mb-5 flex items-center gap-4"><span className="whitespace-nowrap text-xs font-black uppercase tracking-[.16em] text-slate-400">Round {game.round + 1} / {game.totalRounds}</span><Progress value={progress} className="h-1.5 bg-white/10 [&>div]:bg-cyan-300" /></div>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-[2rem] border border-white/12 bg-[#0c1924]/95 p-5 sm:p-8">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <span className={`rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-[.15em] ${game.role === "hot-seat" ? "bg-lime-300 text-[#111908]" : "bg-cyan-300/10 text-cyan-300"}`}>{game.role === "hot-seat" ? "You’re in the Hot Seat" : `Predict ${game.hotSeat?.name}`}</span>
                  <span className="text-xs font-bold text-slate-500">{game.submittedCount}/{game.players.length} locked</span>
                </div>
                <h1 className="max-w-3xl text-3xl font-black leading-tight tracking-[-.04em] sm:text-5xl">{game.question.prompt}</h1>
                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  {game.question.options.map((option, index) => {
                    const isActual = game.phase === "reveal" && index === game.reveal?.actualOption;
                    const myPick = game.reveal?.picks.find((pick) => pick.playerId === game.me.id);
                    const isMine = game.phase === "reveal" && index === myPick?.option;
                    return <button key={option} disabled={game.submitted || game.phase === "reveal"} onClick={() => setSelected(index)} className={`group min-h-24 rounded-2xl border p-4 text-left transition ${isActual ? "border-lime-300 bg-lime-300/15" : isMine ? "border-cyan-300 bg-cyan-300/10" : selected === index ? "border-cyan-300 bg-cyan-300/10" : "border-white/10 bg-white/[.035] hover:border-white/25 hover:bg-white/[.06]"} disabled:cursor-default`}>
                      <span className="flex items-start gap-3"><b className={`grid size-8 shrink-0 place-items-center rounded-full text-xs ${isActual ? "bg-lime-300 text-[#111908]" : "bg-white/8 text-cyan-300"}`}>{optionLetters[index]}</b><span className="pt-1 text-base font-bold leading-6">{option}</span></span>
                    </button>;
                  })}
                </div>
                {game.phase === "playing" && !game.submitted && (
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                    {game.role === "predictor" && <label className={`flex min-h-14 flex-1 items-center justify-between rounded-2xl border px-4 ${game.me.doubleAvailable ? "border-lime-300/25 bg-lime-300/[.06]" : "border-white/8 bg-white/[.025] opacity-50"}`}><span><b className="block text-sm text-lime-300">Double Down</b><span className="text-xs text-slate-500">One use · correct answer = 4 pts</span></span><Switch checked={doubleDown} onCheckedChange={setDoubleDown} disabled={!game.me.doubleAvailable} /></label>}
                    <Button disabled={busy || selected === null} onClick={() => act("submit", { option: selected, doubled: doubleDown })} className="h-14 rounded-2xl bg-cyan-300 px-8 text-base font-black text-[#071018] hover:bg-cyan-200">Lock answer</Button>
                  </div>
                )}
                {game.phase === "playing" && game.submitted && <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/[.07] px-5 py-4 text-center font-bold text-cyan-200">Answer locked. Scanning the room…</div>}
                {game.phase === "reveal" && (
                  <div className="reveal-panel mt-6 rounded-2xl border border-lime-300/20 bg-lime-300/[.07] p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.15em] text-lime-300">Signal revealed</p><p className="mt-1 font-bold"><span className="text-white">{game.hotSeat?.name}</span> picked {optionLetters[hotSeatPick?.option ?? 0]}</p></div>{game.reveal?.picks.find((pick) => pick.playerId === game.me.id)?.points ? <b className="text-2xl text-lime-300">+{game.reveal.picks.find((pick) => pick.playerId === game.me.id)?.points} pts</b> : game.role === "predictor" ? <b className="text-slate-400">No points</b> : null}</div>
                    {game.me.isHost ? <Button disabled={busy} onClick={() => act("next")} className="mt-4 h-12 w-full rounded-xl bg-lime-300 font-black text-[#111908] hover:bg-lime-200">{game.round + 1 === game.totalRounds ? "See final results" : "Next round"}</Button> : <p className="mt-4 text-center text-sm font-semibold text-slate-500">Waiting for the host…</p>}
                  </div>
                )}
              </div>
              <aside className="rounded-[2rem] border border-white/12 bg-[#0c1924]/80 p-5">
                <h2 className="text-sm font-black uppercase tracking-[.15em] text-slate-400">Live scores</h2>
                <div className="mt-4 grid gap-2">{standings.map((player, index) => { const pick = game.reveal?.picks.find((item) => item.playerId === player.id); return <div key={player.id} className="flex items-center justify-between rounded-xl bg-white/[.035] px-3 py-3"><span className="flex min-w-0 items-center gap-2"><span className="text-xs font-black text-slate-600">{index + 1}</span><b className="truncate text-sm">{player.name}</b>{pick?.doubled && <Sparkles className="size-3.5 text-lime-300" />}</span><span className="flex items-center gap-2"><b className="text-cyan-300">{player.score}</b>{game.phase === "reveal" && pick && player.id !== game.hotSeat?.id && <span className={`text-xs font-black ${pick.correct ? "text-lime-300" : "text-rose-300"}`}>{pick.correct ? "✓" : "×"}</span>}</span></div>; })}</div>
              </aside>
            </div>
          </section>
        )}

        {game.phase === "finished" && (
          <section className="mx-auto max-w-2xl rounded-[2rem] border border-white/12 bg-[#0c1924]/95 p-6 text-center sm:p-10">
            <div className="mx-auto grid size-16 place-items-center rounded-full bg-lime-300 text-[#111908] shadow-[0_0_45px_rgba(190,242,100,.2)]"><Crown className="size-8" /></div>
            <p className="mt-5 text-xs font-black uppercase tracking-[.2em] text-lime-300">Radar champion</p>
            <h1 className="mt-2 text-5xl font-black tracking-[-.05em]">{standings[0]?.name}</h1>
            <p className="mt-2 text-slate-400">The room has been read. Mostly.</p>
            <div className="mx-auto mt-7 grid max-w-lg gap-2">{standings.map((player, index) => <div key={player.id} className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left ${index === 0 ? "border-lime-300/25 bg-lime-300/[.07]" : "border-white/8 bg-white/[.03]"}`}><span className="flex items-center gap-3"><b className="w-5 text-slate-500">{index + 1}</b><b>{player.name}</b></span><strong className="text-cyan-300">{player.score} pts</strong></div>)}</div>
            <div className="mt-7 grid gap-3 text-left sm:grid-cols-3">
              <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[.055] p-4"><Award className="size-5 text-cyan-300" /><p className="mt-3 text-xs font-black uppercase tracking-[.13em] text-slate-500">Mind Reader</p><b className="mt-1 block">{game.awards?.mindReader}</b></div>
              <div className="rounded-2xl border border-lime-300/15 bg-lime-300/[.055] p-4"><Sparkles className="size-5 text-lime-300" /><p className="mt-3 text-xs font-black uppercase tracking-[.13em] text-slate-500">Boldest Signal</p><b className="mt-1 block">{game.awards?.boldestSignal}</b></div>
              <div className="rounded-2xl border border-fuchsia-300/15 bg-fuchsia-300/[.055] p-4"><ShieldQuestion className="size-5 text-fuchsia-300" /><p className="mt-3 text-xs font-black uppercase tracking-[.13em] text-slate-500">Most Mysterious</p><b className="mt-1 block">{game.awards?.mostMysterious}</b></div>
            </div>
            {game.strongestConnection && <div className="mt-3 flex items-center justify-center gap-3 rounded-2xl border border-white/8 bg-white/[.03] px-4 py-4 text-sm"><HeartHandshake className="size-5 text-cyan-300" /><span><b>{game.strongestConnection.reader}</b> read <b>{game.strongestConnection.target}</b> best · {game.strongestConnection.hits} correct</span></div>}
            {game.me.isHost ? <Button disabled={busy} onClick={() => act("replay")} className="mt-7 h-14 w-full rounded-2xl bg-cyan-300 text-base font-black text-[#071018] hover:bg-cyan-200"><RotateCcw className="mr-2 size-4" /> Play again</Button> : <div className="mt-7 rounded-2xl bg-white/5 px-4 py-4 text-sm font-bold text-slate-400">Waiting for the host to start another game…</div>}
            <button onClick={leave} className="mt-4 text-sm font-semibold text-slate-500 hover:text-white">Leave room</button>
          </section>
        )}
      </div>
    </main>
  );
}

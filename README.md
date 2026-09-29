# Room Radar

Room Radar is a live social prediction game for 2–8 players. One player enters the Hot Seat and chooses an honest answer; everyone else tries to read the room and predict what they picked.

There are no accounts or installs. Create a room, share its five-character code or QR invite, and play together from separate phones or laptops.

## How to play

1. Create a room and invite 1–7 other players.
2. Choose a question pack and start the game.
3. The player in the Hot Seat secretly selects their real answer.
4. Everyone else predicts that answer.
5. Correct predictions earn 2 points. Each player can use one Double Down for a possible 4 points.
6. After eight rounds, Room Radar reveals the leaderboard and playful group awards.

## Features

- Live room-based play for 2–8 people on separate devices
- Five-character room codes and QR-code invitations
- Four distinct packs: Mixed Signals, Everyday Radar, Chaos Mode, and Close Friends
- Rotating Hot Seat, private answers, synced reveals, and live scoring
- One strategic Double Down per player
- End-game awards including Mind Reader, Boldest Signal, and Most Mysterious
- Session recovery, graceful room exits, and host recovery if the original host disconnects
- Responsive interface designed for phones and laptops

## Technology

- React, TypeScript, Next.js, and Vinext
- Tailwind CSS for the interface
- Cloudflare D1 for shared room state
- QR-code invitations with `qrcode.react`
- ChatGPT Sites for hosting

The server keeps the Hot Seat answer hidden until the reveal phase. Versioned database updates and short polling keep each player's view synchronized while protecting concurrent room actions.

## Run locally

Use Node.js 22.13 or newer.

```bash
git clone https://github.com/AshishDev-16/room-radar.git
cd room-radar
npm install
npm run dev
```

Then open the local URL shown in the terminal. To test multiplayer behavior, join the same room in separate browser profiles or devices.

## Quality checks

```bash
npm run lint
npm run build
```

## Development transparency

Room Radar is a **vibe-coded, AI-assisted project**. Ashish Kadu defined the game concept, rules, multiplayer requirements, visual direction, testing scenarios, iteration priorities, and deployment decisions. AI coding tools helped generate and refine parts of the implementation.

This disclosure is intentional: the project demonstrates the ability to direct, test, improve, and ship an AI-built multiplayer experience. It is not a claim that every line was written by hand.

## Creator

Built and directed by [Ashish Kadu](https://github.com/AshishDev-16).

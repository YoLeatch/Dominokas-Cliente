# Dominokas Project - Instructional Context

Dominokas (formerly Deadworks) is a professional game launcher and match management system for **Deadlock (Citadel)**. It provides a seamless experience for players to organize matches, handle hero selection (Draft/Ban), and manage networking through automated tunnels and a discovery relay.

## Architecture Overview

The project is divided into three main layers:

### 1. Backend (Rust / Tauri v2)
*   **Lifecycle Management**: Detects Deadlock installation, patches `gameinfo.gi`, and manages the dedicated server process.
*   **Networking**: 
    *   `playit.rs`: Manages the `playit.exe` sidecar for automated TCP tunneling.
    *   `draft.rs`: A broadcast WebSocket server (port 27025) that relays state between clients.
    *   `relay.rs`: An embedded HTTP server (port 8080) for match code registration and resolution.
*   **Steam Integration**: Uses `steamworks` crate for identity and avatar retrieval.

### 2. Frontend (React 18 / Vite / TypeScript)
*   **Authoritative State**: Managed via `DraftContext.tsx`. All state changes originate from the Host and are synchronized via the WebSocket loopback.
*   **UI/UX**: Custom title bars, high-fidelity hero selection screens, and real-time server console monitoring.
*   **Routing**: State-driven navigation based on the current phase of the draft and user role.

### 3. Plugin Framework (C# / Deadworks API)
*   **In-Game Logic**: A managed bridge to the Source 2 engine.
*   **`DominokasDraft` Plugin**: Reads the `match_state.json` exported by the launcher to enforce bans, assign heroes, and manage player "freeze" states during the draft.

## Building and Running

### Development
```bash
# Run the complete application (Frontend + Rust Backend)
npm run tauri dev

# Run the Python Bot for draft testing
python play_draft.py [MATCH_CODE]
```

### Production Build
```bash
# Generate the Windows installer (.msi / .exe)
npm run tauri build

# Compile the C# Plugin
dotnet build deadworks-fork/managed/DominokasDraft/DominokasDraft.csproj -c Release
```

## Development Conventions

### Authoritative Network Model
*   **Rule**: Never call `setDraftState` directly in response to a user action.
*   **Flow**: User Action -> `sendMessage(ACTION)` -> Host processes action -> Host sends `STATE_UPDATE` -> Loopback -> `setDraftState`.
*   **Host Identification**: Always use the real `hostSteamId` for authority checks, never rely on ephemeral connection IDs.

### Asset Management
*   **Public Assets**: All static images (hero cards, icons) MUST be stored in `public/` (e.g., `public/img/`) to ensure accessibility in production builds.
*   **Referencing**: Reference these assets using root-absolute paths: `/img/hero_card.png`.

### Deployment to Game Server
*   The C# plugin expects `match_state.json` to be located in the `game/bin/win64/managed/` directory of the server.
*   The Launcher is configured to export this file automatically when the draft starts.

## Key File Manifest
*   `src/context/DraftContext.tsx`: The "brain" of the draft synchronization.
*   `src-tauri/src/playit.rs`: Tunnel management logic.
*   `deadworks-fork/managed/DominokasDraft/DraftPlugin.cs`: In-game enforcement of draft rules.
*   `src/utils/heroes.ts`: Metadata and image paths for the hero roster.

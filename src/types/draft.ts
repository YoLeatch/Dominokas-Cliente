export type DraftPhase = 'waiting' | 'ban' | 'pick' | 'complete' | 'match-in-progress';
export type HostRole = 'amber' | 'sapphire' | 'spectator';

export interface LogEntry {
  time: string;
  text: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'system' | 'cmd';
}

export interface PlayerSlot {
  steamId: string;
  name: string;
  hero: string | null;
  locked: boolean;
  isHost?: boolean;
  isCaptain?: boolean;
}

export interface MatchConfig {
  playersPerTeam: number;
  maxSpectators: number;
  map: string;
  bansEnabled: boolean;
  duplicateHeroes: boolean;
  captainMode: boolean;
}

export interface DraftState {
  config: MatchConfig;
  phase: DraftPhase;
  timeRemaining: number;
  amberTeam: PlayerSlot[];
  sapphireTeam: PlayerSlot[];
  spectators: PlayerSlot[];
  bannedHeroes: string[];
  currentTurnTeam: 'amber' | 'sapphire' | null;
  currentTurnPlayerId: string | null;
  matchCodes: {
    amber: string;
    sapphire: string;
    spectator: string;
  };
  playitAddress: string | null;
  hostSteamId: string;
  isPaused?: boolean;
}

export type WSMessage =
  | { type: 'JOIN_ROOM'; player: PlayerSlot; requestedRole?: HostRole }
  | { type: 'STATE_UPDATE'; state: DraftState }
  | { type: 'START_DRAFT'; steamId?: string; matchCode?: string; playitAddress?: string }
  | { type: 'SELECT_HERO'; steamId: string; team: 'amber' | 'sapphire'; heroId: string }
  | { type: 'LOCK_HERO'; steamId: string; team: 'amber' | 'sapphire'; heroId?: string }
  | { type: 'BAN_HERO'; steamId?: string; team?: 'amber' | 'sapphire'; heroId: string }
  | { type: 'SET_CAPTAIN'; steamId: string; team: 'amber' | 'sapphire' }
  | { type: 'PAUSE_DRAFT' }
  | { type: 'RESUME_DRAFT' }
  | { type: 'UNDO_DRAFT_ACTION' }
  | { type: 'RESTART_DRAFT' }
  | { type: 'START_MATCH'; steamId?: string }
  | { type: 'END_MATCH' }
  | { type: 'WORLD_MESSAGE'; text: string }
  | { type: 'HEARTBEAT' };

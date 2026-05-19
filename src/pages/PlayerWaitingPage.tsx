import React, { useEffect } from 'react';
import { useDraft } from '../context/DraftContext';
import { useSteamUser } from '../hooks/useSteamUser';
import { HeaderLogo } from '../components/common/HeaderLogo';
import { SteamAvatar } from '../components/common/SteamAvatar';
import '../styles/PlayerWaiting.css';
import '../styles/MatchCreated.css';

interface Props {
  onNavigate?: (page: string) => void;
}

const PlayerWaitingPage: React.FC<Props> = ({ onNavigate }) => {
  const { draftState, isConnected } = useDraft();
  const { user } = useSteamUser();

  // Transição automática quando o draft começar
  useEffect(() => {
    if (draftState?.phase && draftState.phase !== 'waiting') {
      if (onNavigate) {
        onNavigate('draft-screen');
      }
    }
  }, [draftState?.phase, onNavigate]);

  const actualSteamId = (user as any)?.steamId || user?.steam_id;
  const config = draftState?.config;
  const playersPerTeam = config?.playersPerTeam || 6;
  const totalSlots = playersPerTeam * 2;

  const amberPlayers = draftState?.amberTeam || [];
  const sapphirePlayers = draftState?.sapphireTeam || [];
  const spectators = draftState?.spectators || [];
  const allConnected = [...amberPlayers, ...sapphirePlayers, ...spectators];

  // Identifica o time real do jogador local
  const isInAmber = amberPlayers.some(p => p.steamId === actualSteamId);
  const isInSapphire = sapphirePlayers.some(p => p.steamId === actualSteamId);
  const isSpectator = spectators.some(p => p.steamId === actualSteamId);

  const teamInfo = isInAmber
    ? { label: '🟡 TIME ÂMBAR', className: 'amber' }
    : isInSapphire
      ? { label: '🔵 TIME SAFIRA', className: 'sapphire' }
      : isSpectator
        ? { label: '👁 ESPECTADOR', className: '' }
        : { label: 'AGUARDANDO ALOCAÇÃO...', className: '' };

  const playerName = user?.name || 'Jogador';
  const bansEnabled = config?.bansEnabled ?? true;
  const mapName = config?.map || 'street_test';

  return (
    <div className="screen" style={{ gap: '3vh' }}>
      <HeaderLogo />
      <div className="waiting-card">
        {/* Status de conexão */}
        <div className="status-badge">
          <div className={isConnected ? 'status-dot-green' : 'status-dot-red'} />
          <span className={isConnected ? 'status-text-green' : 'status-text-red'}>
            {isConnected ? 'Conectado à sala' : 'Desconectado'}
          </span>
        </div>

        {/* Info do jogador */}
        <div className="player-info-center">
          <span className="player-name-lg">{playerName}</span>
          <span className={`team-badge ${teamInfo.className}`}>{teamInfo.label}</span>
        </div>

        <div className="divider" />

        {/* Config da sala */}
        <div className="room-info">
          <div className="room-row">
            <span className="room-label">Servidor</span>
            <span className={`room-value ${isConnected ? 'highlight' : ''}`}>
              {isConnected ? 'Conectado via WebSocket' : 'Sem conexão'}
            </span>
          </div>
          <div className="room-row">
            <span className="room-label">Draft com banimentos</span>
            <span className="room-value">{bansEnabled ? 'Sim (4 bans)' : 'Não'}</span>
          </div>
          <div className="room-row">
            <span className="room-label">Jogadores por time</span>
            <span className="room-value">{playersPerTeam}</span>
          </div>
          <div className="room-row">
            <span className="room-label">Mapa</span>
            <span className="room-value">{mapName}</span>
          </div>
        </div>

        <div className="divider" />

        {/* Barra de progresso */}
        <div className="progress-section">
          <div className="progress-bar-bg">
            <div
              className="progress-bar-fill"
              style={{ width: `${(allConnected.length / totalSlots) * 100}%` }}
            />
          </div>
          <span className="progress-text">
            {allConnected.length} / {totalSlots} conectados
          </span>
        </div>

        {/* Grid de times separados */}
        <div className="teams-waiting-section">
          {/* Time Âmbar */}
          <div className="team-waiting-column">
            <span className="team-waiting-title amber">ÂMBAR ({amberPlayers.length}/{playersPerTeam})</span>
            {amberPlayers.map((player, i) => (
              <div key={i} className={`player-slot-sm ${player.steamId === actualSteamId ? 'is-me' : ''}`}>
                <SteamAvatar steamId={player.steamId} className="slot-avatar-sm connected" />
                <span className="slot-icon">✅</span>
                <span className="slot-name-sm connected">{player.name}</span>
              </div>
            ))}
            {Array.from({ length: Math.max(0, playersPerTeam - amberPlayers.length) }).map((_, i) => (
              <div key={`wa-${i}`} className="player-slot-sm">
                <div className="slot-avatar-sm waiting" />
                <span className="slot-icon">⌛</span>
                <span className="slot-name-sm waiting">Aguardando...</span>
              </div>
            ))}
          </div>

          {/* Time Safira */}
          <div className="team-waiting-column">
            <span className="team-waiting-title sapphire">SAFIRA ({sapphirePlayers.length}/{playersPerTeam})</span>
            {sapphirePlayers.map((player, i) => (
              <div key={i} className={`player-slot-sm ${player.steamId === actualSteamId ? 'is-me' : ''}`}>
                <SteamAvatar steamId={player.steamId} className="slot-avatar-sm connected" />
                <span className="slot-icon">✅</span>
                <span className="slot-name-sm connected">{player.name}</span>
              </div>
            ))}
            {Array.from({ length: Math.max(0, playersPerTeam - sapphirePlayers.length) }).map((_, i) => (
              <div key={`ws-${i}`} className="player-slot-sm">
                <div className="slot-avatar-sm waiting" />
                <span className="slot-icon">⌛</span>
                <span className="slot-name-sm waiting">Aguardando...</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <span className="waiting-message">Aguardando o provedor iniciar o draft...</span>
    </div>
  );
};

export default PlayerWaitingPage;

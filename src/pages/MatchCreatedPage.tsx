import React, { useState, useEffect } from 'react';
import { useDraft } from '../context/DraftContext';
import { invoke } from '@tauri-apps/api/core';
import { useSteamUser } from '../hooks/useSteamUser';
import { HeaderLogo } from '../components/common/HeaderLogo';
import { SteamAvatar } from '../components/common/SteamAvatar';
import '../styles/MatchCreated.css';

interface Props {
  onNavigate?: (page: string) => void;
}

const PlayerSlot: React.FC<{
  name: string;
  connected: boolean;
  isCaptain?: boolean;
  onSetCaptain?: () => void;
  canManage?: boolean;
  steamId?: string;
}> = ({ name, connected, isCaptain, onSetCaptain, canManage, steamId }) => (
  <div className={`player-slot ${isCaptain ? 'is-captain' : ''}`} onClick={canManage && connected ? onSetCaptain : undefined} style={{ cursor: canManage && connected ? 'pointer' : 'default' }}>
    {steamId ? (
      <SteamAvatar steamId={steamId} className={`slot-avatar ${connected ? 'connected' : 'waiting'}`} />
    ) : (
      <div className={`slot-avatar ${connected ? 'connected' : 'waiting'}`} />
    )}
    <span className="slot-icon">{isCaptain ? '👑' : (connected ? '✅' : '⌛')}</span>
    <span className={`slot-name ${connected ? 'connected' : 'waiting'}`}>{name}</span>
    {isCaptain && <span className="captain-label">CAPITÃO</span>}
  </div>
);

const MatchCreatedPage: React.FC<Props> = ({ onNavigate }) => {
  const { draftState, sendMessage, tunnelAddress, tunnelError, isConnected, isHost } = useDraft();
  const { user } = useSteamUser();

  const codes = draftState?.matchCodes || {
    amber: 'AMBR-WAIT',
    sapphire: 'SAPH-WAIT',
    spectator: 'SPEC-WAIT'
  };

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [lastAddress, setLastAddress] = useState<string>('');
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Carrega o último endereço salvo via invoke
    const loadLastAddr = async () => {
      try {
        const saved = await invoke<string>('get_last_address');
        if (saved) {
          setLastAddress(saved);
        }
      } catch (e) {
        console.warn("Falha ao carregar endereço salvo:", e);
      }
    };
    loadLastAddr();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const copyCode = (codeToCopy: string, id: string) => {
    // Agora copia apenas o código, o Launcher resolve o IP via Relay
    console.log("[Copy] Código copiado:", codeToCopy);

    navigator.clipboard.writeText(codeToCopy).then(() => {
      setCopiedId(id);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopiedId(null), 2000);
    }).catch(err => {
      console.error("[Copy] Erro ao copiar:", err);
      alert("Erro ao copiar! Tente selecionar o texto manualmente.");
    });
  };

  const config = draftState?.config || { playersPerTeam: 6, maxSpectators: 0, map: 'street_test', bansEnabled: true, duplicateHeroes: false };
  const amberTeam = draftState?.amberTeam || [];
  const sapphireTeam = draftState?.sapphireTeam || [];
  const spectators = draftState?.spectators || [];

  const totalConnected = amberTeam.length + sapphireTeam.length + spectators.length;
  const maxSlots = (config.playersPerTeam * 2) + config.maxSpectators;

  return (
    <div className="screen match-created-screen">
      <HeaderLogo />
      <div className="main-content">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span className="success-title">✅ Partida criada com sucesso!</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            {isHost && (
              <button
                onClick={() => onNavigate && onNavigate('server-console')}
                style={{
                  background: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.4)',
                  color: '#60a5fa',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontFamily: "'Geist Mono', monospace",
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(59, 130, 246, 0.2)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(59, 130, 246, 0.1)';
                }}
              >
                ⚙ CONSOLE
              </button>
            )}
            {isHost && (
              <button
                onClick={() => onNavigate && onNavigate('match-config')}
                style={{
                  background: 'transparent',
                  border: '1px solid #2a3550',
                  color: '#64748b',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontFamily: "'Geist Mono', monospace",
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#f0b90b';
                  (e.currentTarget as HTMLButtonElement).style.color = '#f0b90b';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#2a3550';
                  (e.currentTarget as HTMLButtonElement).style.color = '#64748b';
                }}
              >
                ← Configs
              </button>
            )}
          </div>
        </div>

        <div className="tunnel-info-box" style={{
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '12px',
          background: 'rgba(30, 41, 59, 0.4)',
          border: '1px solid rgba(51, 65, 85, 0.5)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
            <div className="tunnel-status-indicator active"></div>
            <span className="tunnel-text">Relay Server Ativo em: <span className="tunnel-address">dominokas-list.playit.plus</span></span>
          </div>
        </div>

        <div className="codes-row">
          <div className="team-code-card amber">
            <div className="team-info">
              <span className="team-label amber">🟡 Time Âmbar</span>
              <span className="team-code">{codes.amber}</span>
            </div>
            <button className="btn-copy" onClick={() => copyCode(codes.amber, 'amber')}>
              {copiedId === 'amber' ? '✅ Copiado!' : '📋 Copiar'}
            </button>
          </div>
          <div className="team-code-card sapphire">
            <div className="team-info">
              <span className="team-label sapphire">🔵 Time Safira</span>
              <span className="team-code">{codes.sapphire}</span>
            </div>
            <button className="btn-copy" onClick={() => copyCode(codes.sapphire, 'sapphire')}>
              {copiedId === 'sapphire' ? '✅ Copiado!' : '📋 Copiar'}
            </button>
          </div>
          {config.maxSpectators > 0 && (
            <div className="team-code-card spectator">
              <div className="team-info">
                <span className="team-label spectator">👁 Espectadores</span>
                <span className="team-code">{codes.spectator}</span>
              </div>
              <button className="btn-copy" onClick={() => copyCode(codes.spectator, 'spectator')}>
                {copiedId === 'spectator' ? '✅ Copiado!' : '📋 Copiar'}
              </button>
            </div>
          )}
        </div>

        <span className="instruction">Envie cada código de acesso para os respectivos jogadores.</span>

        <div className="progress-section">
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${(totalConnected / maxSlots) * 100}%` }} />
          </div>
          <span className="progress-text">{totalConnected} / {maxSlots} conectados</span>
        </div>

        <div className="teams-section">
          <div className="team-panel amber">
            <div className="panel-header">
              <span className="panel-title amber">TIME ÂMBAR</span>
              <span className="slots-count">{amberTeam.length}/{config.playersPerTeam}</span>
            </div>
            <div className="slots-container">
              {amberTeam.map((p, i) => (
                <PlayerSlot
                  key={`a-${i}`}
                  name={p.name}
                  connected={true}
                  isCaptain={p.isCaptain}
                  canManage={isHost}
                  steamId={p.steamId}
                  onSetCaptain={() => sendMessage({ type: 'SET_CAPTAIN', steamId: p.steamId, team: 'amber' })}
                />
              ))}
              {Array.from({ length: config.playersPerTeam - amberTeam.length }).map((_, i) => (
                <PlayerSlot key={`wa-${i}`} name="Aguardando..." connected={false} />
              ))}
            </div>
          </div>

          <div className="team-panel sapphire">
            <div className="panel-header">
              <span className="panel-title sapphire">TIME SAFIRA</span>
              <span className="slots-count">{sapphireTeam.length}/{config.playersPerTeam}</span>
            </div>
            <div className="slots-container">
              {sapphireTeam.map((p, i) => (
                <PlayerSlot
                  key={`s-${i}`}
                  name={p.name}
                  connected={true}
                  isCaptain={p.isCaptain}
                  canManage={isHost}
                  steamId={p.steamId}
                  onSetCaptain={() => sendMessage({ type: 'SET_CAPTAIN', steamId: p.steamId, team: 'sapphire' })}
                />
              ))}
              {Array.from({ length: config.playersPerTeam - sapphireTeam.length }).map((_, i) => (
                <PlayerSlot key={`ws-${i}`} name="Aguardando..." connected={false} />
              ))}
            </div>
          </div>

          {(config.maxSpectators > 0 || spectators.length > 0) && (
            <div className="team-panel spectator">
              <div className="panel-header">
                <span className="panel-title spectator">ESPECTADORES</span>
                <span className="slots-count">{spectators.length}/{config.maxSpectators}</span>
              </div>
              <div className="slots-container">
                {spectators.map((p, i) => (
                  <PlayerSlot key={`sp-${i}`} name={p.name} connected={true} steamId={p.steamId} />
                ))}
                {Array.from({ length: config.maxSpectators - spectators.length }).map((_, i) => (
                  <PlayerSlot key={`wsp-${i}`} name="Aguardando..." connected={false} />
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          className={`btn-start ${amberTeam.length > 0 || sapphireTeam.length > 0 ? 'ready' : ''}`}
          onClick={() => {
            if (amberTeam.length === 0 && sapphireTeam.length === 0) {
              alert('É necessário ter pelo menos 1 jogador em um dos times para iniciar.');
              return;
            }
            const actualSteamId = (user as any)?.steamId || user?.steam_id;

            sendMessage({
              type: 'START_DRAFT',
              steamId: actualSteamId,
              matchCode: codes.amber,
              playitAddress: tunnelAddress || draftState?.playitAddress || ''
            });
            if (onNavigate) {
              onNavigate('draft-screen');
            }
          }}
        >
          <span>▶ INICIAR DRAFT</span>
        </button>
      </div>
    </div>
  );
};

export default MatchCreatedPage;

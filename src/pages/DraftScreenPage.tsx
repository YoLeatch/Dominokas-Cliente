import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useDraft } from '../context/DraftContext';
import { useSteamUser } from '../hooks/useSteamUser';
import { HeaderLogo } from '../components/common/HeaderLogo';
import { HEROES } from '../utils/heroes';
import '../styles/DraftShared.css';

interface DraftScreenProps {
  onNavigate?: (page: string) => void;
}

export const DraftScreenPage: React.FC<DraftScreenProps> = ({ onNavigate }) => {
  const { draftState, sendMessage, isHost, setIsGameServerRunning } = useDraft();
  const { user } = useSteamUser();
  const [selectedHero, setSelectedHero] = useState<string | null>(null);

  React.useEffect(() => {
    if (draftState?.phase === 'match-in-progress') {
      if (onNavigate) {
        onNavigate('match-in-progress');
      }
    }
  }, [draftState?.phase, onNavigate]);

  const amberTeam = draftState?.amberTeam || [];
  const sapphireTeam = draftState?.sapphireTeam || [];
  const bannedHeroes = draftState?.bannedHeroes || [];
  const timeRemaining = draftState?.timeRemaining ?? 0;
  const phase = draftState?.phase || 'waiting';
  const config = draftState?.config;
  const playersPerTeam = config?.playersPerTeam || 6;

  const actualSteamId = (user as any)?.steamId || user?.steam_id;
  const isAmber = amberTeam.some(p => p.steamId === actualSteamId);
  const isSapphire = sapphireTeam.some(p => p.steamId === actualSteamId);
  const myTeam = isAmber ? 'amber' : isSapphire ? 'sapphire' : null;
  const mySlot = [...amberTeam, ...sapphireTeam].find(p => p.steamId === actualSteamId);

  const isCaptainMode = config?.captainMode || false;
  const isMyTurn = draftState?.currentTurnTeam === myTeam;
  const canIAction = isCaptainMode ? (mySlot?.isCaptain && isMyTurn) : (isMyTurn && (phase === 'ban' || !mySlot?.locked));

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSelectHero = (heroId: string, heroName: string) => {
    if (!user || !canIAction || phase === 'complete' || draftState.isPaused) return;
    setSelectedHero(heroName);
    // SELECT_HERO informa ao host que este jogador está olhando para um herói
    sendMessage({ type: 'SELECT_HERO', steamId: actualSteamId!, team: myTeam!, heroId: heroName });
  };

  const handleConfirmAction = () => {
    if (!user || !selectedHero || !canIAction) return;
    if (phase === 'ban') {
      sendMessage({ type: 'BAN_HERO', steamId: actualSteamId!, team: myTeam!, heroId: selectedHero });
      setSelectedHero(null);
    } else {
      sendMessage({ type: 'LOCK_HERO', steamId: actualSteamId!, team: myTeam! });
    }
  };

  const handleStartGameServer = async () => {
    try {
      // O Host inicia o servidor dedicado em C:\DeadlockSV
      await invoke('start_deadlock_server');
      setIsGameServerRunning(true);
      
      // Envia a mensagem de início para todos via WebSocket
      const actualSteamId = (user as any)?.steamId || user?.steam_id;
      sendMessage({ type: 'START_MATCH', steamId: actualSteamId });
    } catch (err) {
      console.error('Erro ao iniciar servidor:', err);
      alert('Falha ao iniciar o servidor de jogo: ' + err);
    }
  };

  const handleConnect = async () => {
    if (draftState?.playitAddress) {
      try {
        await invoke('connect_to_match', { addr: draftState.playitAddress });
      } catch (err) {
        console.error('Erro ao conectar:', err);
        alert('Erro ao conectar ao jogo: ' + err);
      }
    } else {
      alert('Endereço da partida não encontrado.');
    }
  };

  if (!draftState) {
    return (
      <div className="screen" style={{ color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Carregando Draft...
      </div>
    );
  }

  return (
    <div className="screen">
      <HeaderLogo />

      {/* Botão de Console para o Host */}
      {isHost && (
        <button
          onClick={() => onNavigate && onNavigate('server-console')}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            color: '#60a5fa',
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '11px',
            fontFamily: "'Geist Mono', monospace",
            fontWeight: 700,
            cursor: 'pointer',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'}
        >
          ⚙ CONSOLE
        </button>
      )}

      {/* Timer — idêntico ao BanScreenPage */}
      <div className="draft-timer-container">
        <span className="draft-timer-label">
          {draftState.isPaused 
            ? 'DRAFT PAUSADO'
            : phase === 'complete'
              ? 'Draft Finalizado'
              : phase === 'ban'
                ? 'Tempo Restante — Banimento'
                : 'Tempo Restante — Escolha'}
        </span>
        <span className="draft-map-info">
          MAPA: {draftState.config.map.toUpperCase()}
        </span>
        <span
          className="draft-timer-value"
          style={{ color: timeRemaining <= 10 ? 'var(--color-ban-red)' : 'var(--color-gold)' }}
        >
          {formatTime(timeRemaining)}
        </span>
      </div>

      <div className="draft-body">

        {/* ── Time Esquerdo (Âmbar) ── idêntico ao BanScreenPage */}
        <div className="team team-left">
          <div style={{ height: '8vh' }} />
          {[0, 1, 2, 3, 4, 5].slice(0, playersPerTeam).map((i) => {
            const p = amberTeam[i];
            const isCurrentTurn = draftState.currentTurnTeam === 'amber' && p && !p.locked;
            return (
              <div key={i} className="player-row">
                <div className={`player-avatar ${isCurrentTurn ? (phase === 'ban' ? 'selected-ban' : 'selected-pick') : ''}`}>
                  {p?.hero && HEROES.find(h => h.name === p.hero) && (
                    <img src={HEROES.find(h => h.name === p.hero)?.image} alt="hero" />
                  )}
                </div>
                <span
                  className="player-name-side"
                  style={{ color: p?.steamId === actualSteamId ? 'var(--color-gold)' : undefined }}
                >
                  {p ? `${p.name}${p.isCaptain ? ' 👑' : ''}` : 'Aguardando...'}
                </span>
              </div>
            );
          })}
        </div>

        {/* ── Centro ── idêntico ao BanScreenPage */}
        <div className="center">

          {/* Bans row: BAN_ORDER = ['amber', 'sapphire', 'amber', 'sapphire'] */}
          {/* Slots 0 e 2 são do Time Âmbar (Esquerda), Slots 1 e 3 são do Time Safira (Direita) */}
          <div className="bans-row">
            <div className="team-bans">
              {[0, 2].map((i) => {
                const h = bannedHeroes[i];
                const heroData = h ? HEROES.find(x => x.name === h) : null;
                return (
                  <div key={i} className={`ban-slot ${heroData ? 'filled' : ''}`}>
                    {heroData && (
                      <img
                        src={heroData.image}
                        alt="ban"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.4 }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="team-bans">
              {[1, 3].map((i) => {
                const h = bannedHeroes[i];
                const heroData = h ? HEROES.find(x => x.name === h) : null;
                return (
                  <div key={i} className={`ban-slot ${heroData ? 'filled' : ''}`}>
                    {heroData && (
                      <img
                        src={heroData.image}
                        alt="ban"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.4 }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Hero Grid — mesma estrutura [6 rows × 5 cols] */}
          <div className="hero-grid-container" style={{ display: 'flex', flexDirection: 'column', gap: '1vh' }}>
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div key={row} className="hero-grid">
                {[0, 1, 2, 3, 4].map((col) => {
                  const index = row * 5 + col;
                  const hero = HEROES[index];
                  if (!hero) return <div key={col} className="hero-cell" />;

                  const isBanned = bannedHeroes.includes(hero.name);
                  const pickedByAmber = amberTeam.find(p => p.hero === hero.name && p.locked);
                  const pickedBySapphire = sapphireTeam.find(p => p.hero === hero.name && p.locked);
                  const isPicked = !!(pickedByAmber || pickedBySapphire);
                  const isSelected = selectedHero === hero.name;
                  const isPickedByMyTeam = !!(myTeam === 'amber' ? pickedByAmber : pickedBySapphire);
                  
                  let canClick = false;
                  if (phase === 'ban') {
                    canClick = !isBanned;
                  } else if (phase === 'pick') {
                    if (config?.duplicateHeroes) {
                      canClick = !isBanned && !isPickedByMyTeam;
                    } else {
                      canClick = !isBanned && !isPicked;
                    }
                  }

                  // Se o draft acabou, nada é clicável
                  if (phase === 'complete') canClick = false;

                  return (
                    <div
                      key={col}
                      className={[
                        'hero-cell',
                        isBanned ? 'banned' : '',
                        isPicked ? 'picked' : '',
                        pickedByAmber ? 'amber' : '',
                        pickedBySapphire ? 'sapphire' : '',
                        isSelected ? 'active-pick' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => canClick && handleSelectHero(hero.id, hero.name)}
                      style={canClick && isPicked ? { cursor: 'pointer' } : {}}
                    >
                      <img 
                        src={hero.image} 
                        alt={hero.name} 
                        title={hero.name} 
                        style={canClick && isPicked ? { filter: 'none', opacity: 1 } : {}}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Label + Botão — idêntico ao BanScreenPage */}
          <span className="hero-name-center">
            {phase === 'complete'
              ? 'DRAFT FINALIZADO'
              : selectedHero
                ? selectedHero.toUpperCase()
                : isMyTurn
                  ? (phase === 'ban' ? 'SELECIONE UM HERÓI PARA BANIR' : 'ESCOLHA SEU HERÓI')
                  : 'AGUARDANDO TURNO...'}
          </span>

          {phase === 'complete' ? (
            isHost ? (
              <button 
                className="btn-confirm" 
                onClick={handleStartGameServer} 
                style={{ background: 'var(--color-gold)', color: 'black' }}
              >
                <span>INICIALIZAR PARTIDA</span>
              </button>
            ) : (
              <div className="waiting-match-start">
                <div className="waiting-spinner-small"></div>
                <span>AGUARDANDO INÍCIO PELO HOST...</span>
              </div>
            )
          ) : (
            <button
              className={phase === 'ban' ? 'btn-ban' : 'btn-confirm'}
              disabled={!selectedHero || !canIAction || draftState.isPaused}
              onClick={handleConfirmAction}
            >
              <span>{phase === 'ban' ? 'BANIR' : 'CONFIRMAR'}</span>
            </button>
          )}
        </div>

        {/* ── Time Direito (Safira) ── idêntico ao BanScreenPage */}
        <div className="team team-right">
          <div style={{ height: '8vh' }} />
          {[0, 1, 2, 3, 4, 5].slice(0, playersPerTeam).map((i) => {
            const p = sapphireTeam[i];
            const isCurrentTurn = draftState.currentTurnPlayerId === p?.steamId;
            return (
              <div key={i} className="player-row">
                <div className={`player-avatar ${isCurrentTurn ? (phase === 'ban' ? 'selected-ban' : 'selected-pick') : ''}`}>
                  {p?.hero && HEROES.find(h => h.name === p.hero) && (
                    <img src={HEROES.find(h => h.name === p.hero)?.image} alt="hero" />
                  )}
                </div>
                <span
                  className="player-name-side"
                  style={{ color: p?.steamId === actualSteamId ? 'var(--color-sapphire)' : undefined }}
                >
                  {p ? `${p.name}${p.isCaptain ? ' 👑' : ''}` : 'Aguardando...'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default DraftScreenPage;

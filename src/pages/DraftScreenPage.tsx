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
  const canIAction = myTeam !== null && (isCaptainMode ? (mySlot?.isCaptain && isMyTurn) : (isMyTurn && (phase === 'ban' || !mySlot?.locked)));

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSelectHero = (heroId: string, heroName: string) => {
    if (!user || !canIAction || phase === 'complete' || draftState.isPaused) return;
    setSelectedHero(heroId);
    // SELECT_HERO informa ao host que este jogador está olhando para um herói
    sendMessage({ type: 'SELECT_HERO', steamId: actualSteamId!, team: myTeam!, heroId: heroId });
  };

  const handleConfirmAction = () => {
    if (!user || !selectedHero || !canIAction) return;
    if (phase === 'ban') {
      sendMessage({ type: 'BAN_HERO', steamId: actualSteamId!, team: myTeam!, heroId: selectedHero });
      setSelectedHero(null);
    } else {
      sendMessage({ type: 'LOCK_HERO', steamId: actualSteamId!, team: myTeam!, heroId: selectedHero });
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
            const isCurrentTurn = draftState.currentTurnPlayerId === p?.steamId;
            return (
              <div key={i} className="player-row">
                <div className={`player-avatar ${isCurrentTurn ? (phase === 'ban' ? 'selected-ban' : 'selected-pick') : ''}`}>
                  {p?.hero && HEROES.find(h => h.id === p.hero) && (
                    <img src={HEROES.find(h => h.id === p.hero)?.image} alt="hero" />
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

          {/* Bans row: Renderiza bans por time real baseado no DRAFT_SEQUENCE */}
          {/* Sequência real: Turn 0=amber, Turn 1=sapphire, Turn 8=sapphire, Turn 9=amber */}
          <div className="bans-row">
            <div className="team-bans">
              {(() => {
                const BAN_SEQUENCE = [
                  { team: 'amber' },    // Turn 0
                  { team: 'sapphire' },  // Turn 1
                  { team: 'sapphire' },  // Turn 8
                  { team: 'amber' },     // Turn 9
                ];
                const amberBans = bannedHeroes
                  .map((h, i) => ({ hero: h, team: BAN_SEQUENCE[i]?.team }))
                  .filter(b => b.team === 'amber' && !b.hero.startsWith('SKIPPED_'));
                return [0, 1].map((i) => {
                  const entry = amberBans[i];
                  const heroData = entry ? HEROES.find(x => x.id === entry.hero) : null;
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
                });
              })()}
            </div>
            <div className="team-bans">
              {(() => {
                const BAN_SEQUENCE = [
                  { team: 'amber' },    // Turn 0
                  { team: 'sapphire' },  // Turn 1
                  { team: 'sapphire' },  // Turn 8
                  { team: 'amber' },     // Turn 9
                ];
                const sapphireBans = bannedHeroes
                  .map((h, i) => ({ hero: h, team: BAN_SEQUENCE[i]?.team }))
                  .filter(b => b.team === 'sapphire' && !b.hero.startsWith('SKIPPED_'));
                return [0, 1].map((i) => {
                  const entry = sapphireBans[i];
                  const heroData = entry ? HEROES.find(x => x.id === entry.hero) : null;
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
                });
              })()}
            </div>
          </div>

          {/* Hero Grid — Grade Rolável Dinâmica para todos os Heróis */}
          <div className="hero-grid-scrollable-container">
            <div className="hero-grid">
              {HEROES.map((hero) => {
                const isBanned = bannedHeroes.includes(hero.id);
                const pickedByAmber = amberTeam.find(p => p.hero === hero.id && p.locked);
                const pickedBySapphire = sapphireTeam.find(p => p.hero === hero.id && p.locked);
                const isPicked = !!(pickedByAmber || pickedBySapphire);
                const isSelected = selectedHero === hero.id;
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
                    key={hero.id}
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
          </div>

          {/* Label + Botão — idêntico ao BanScreenPage */}
          <span className="hero-name-center">
            {phase === 'complete'
              ? 'DRAFT FINALIZADO'
              : selectedHero
                ? (HEROES.find(h => h.id === selectedHero)?.name || selectedHero).toUpperCase()
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
                  {p?.hero && HEROES.find(h => h.id === p.hero) && (
                    <img src={HEROES.find(h => h.id === p.hero)?.image} alt="hero" />
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

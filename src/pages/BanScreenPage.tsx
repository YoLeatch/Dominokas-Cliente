import React, { useState } from 'react';
import { useDraft } from '../context/DraftContext';
import { useSteamUser } from '../hooks/useSteamUser';
import { HeaderLogo } from '../components/common/HeaderLogo';
import { HEROES } from '../utils/heroes';
import '../styles/DraftShared.css';

interface BanScreenProps {
  onNavigate?: (page: string) => void;
}

const BanScreenPage: React.FC<BanScreenProps> = ({ onNavigate }) => {
  const { draftState, sendMessage } = useDraft();
  const { user } = useSteamUser();
  const [selectedHero, setSelectedHero] = useState<string | null>(null);

  const amberTeam = draftState?.amberTeam || [];
  const sapphireTeam = draftState?.sapphireTeam || [];
  const bannedHeroes = draftState?.bannedHeroes || [];
  const timeRemaining = draftState?.timeRemaining ?? 30;
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
  const canIAction = isCaptainMode ? (mySlot?.isCaptain && isMyTurn) : (isMyTurn && !mySlot?.locked);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSelectHero = (heroName: string) => {
    if (!user || !canIAction || phase !== 'ban') return;
    setSelectedHero(heroName);
  };

  const handleBan = () => {
    if (!user || !selectedHero || !canIAction) return;
    sendMessage({
      type: 'BAN_HERO',
      steamId: actualSteamId!,
      team: myTeam!,
      heroId: selectedHero
    });
    setSelectedHero(null);
  };

  // Transição automática: quando a fase mudar para 'pick', navega para draft-screen
  React.useEffect(() => {
    if (phase === 'pick' && onNavigate) {
      onNavigate('draft-screen');
    }
  }, [phase, onNavigate]);

  if (!draftState) {
    return (
      <div className="screen" style={{ color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Carregando...
      </div>
    );
  }

  return (
    <div className="screen">
      <HeaderLogo />

      {/* Timer */}
      <div className="draft-timer-container">
        <span className="draft-timer-label">Tempo Restante — Banimento</span>
        <span
          className="draft-timer-value"
          style={{ color: timeRemaining <= 10 ? 'var(--color-ban-red)' : 'var(--color-gold)' }}
        >
          {formatTime(timeRemaining)}
        </span>
      </div>

      <div className="draft-body">
        {/* Time Esquerdo (Âmbar) */}
        <div className="team team-left">
          <div style={{ height: '8vh' }} />
          {[0, 1, 2, 3, 4, 5].slice(0, playersPerTeam).map((i) => {
            const p = amberTeam[i];
            const isCurrentTurn = draftState.currentTurnPlayerId === p?.steamId;
            return (
              <div key={i} className="player-row">
                <div className={`player-avatar ${isCurrentTurn ? 'selected-ban' : ''}`}>
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

        {/* Centro */}
        <div className="center">
          {/* Ban slots */}
          <div className="bans-row">
            <div className="team-bans">
              {[0, 1].map((i) => {
                const h = bannedHeroes[i];
                const heroData = h ? HEROES.find(x => x.id === h) : null;
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
              {[2, 3].map((i) => {
                const h = bannedHeroes[i];
                const heroData = h ? HEROES.find(x => x.id === h) : null;
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

          {/* Hero Grid — Grade Rolável Dinâmica para todos os Heróis */}
          <div className="hero-grid-scrollable-container">
            <div className="hero-grid">
              {HEROES.map((hero) => {
                const isBanned = bannedHeroes.includes(hero.id);
                const isSelected = selectedHero === hero.id;
                const canClick = !isBanned && phase === 'ban';

                return (
                  <div
                    key={hero.id}
                    className={[
                      'hero-cell',
                      isBanned ? 'banned' : '',
                      isSelected ? 'active-pick' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => canClick && handleSelectHero(hero.id)}
                    style={isSelected ? { borderColor: 'var(--color-ban-red)', backgroundColor: '#2a1520' } : undefined}
                  >
                    <img src={hero.image} alt={hero.name} title={hero.name} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Label + Botão */}
          <span className="hero-name-center">
            {selectedHero
              ? selectedHero.toUpperCase()
              : isMyTurn
                ? 'SELECIONE UM HERÓI PARA BANIR'
                : 'AGUARDANDO TURNO...'}
          </span>

          <button
            className="btn-ban"
            disabled={!selectedHero || !canIAction}
            onClick={handleBan}
          >
            <span>BANIR</span>
          </button>
        </div>

        {/* Time Direito (Safira) */}
        <div className="team team-right">
          <div style={{ height: '8vh' }} />
          {[0, 1, 2, 3, 4, 5].slice(0, playersPerTeam).map((i) => {
            const p = sapphireTeam[i];
            const isCurrentTurn = draftState.currentTurnPlayerId === p?.steamId;
            return (
              <div key={i} className="player-row">
                <div className={`player-avatar ${isCurrentTurn ? 'selected-ban' : ''}`}>
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

export default BanScreenPage;

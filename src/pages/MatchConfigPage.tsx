import React, { useState } from 'react';
import { useDraft } from '../context/DraftContext';
import { HeaderLogo } from '../components/common/HeaderLogo';
import '../styles/MatchConfig.css';

interface Props {
  onNavigate?: (page: string) => void;
}

const MatchConfigPage: React.FC<Props> = ({ onNavigate }) => {
  const { startHostServer, connectToRoom, updateMatchConfig, tunnelAddress, tunnelError, isHost, isConnected, draftState } = useDraft();
  
  const currentConfig = draftState?.config;

  const [playersPerTeam, setPlayersPerTeam] = useState(currentConfig?.playersPerTeam || 6);
  const [spectators, setSpectators] = useState(currentConfig?.maxSpectators || 0);
  const [bansEnabled, setBansEnabled] = useState(currentConfig?.bansEnabled ?? true);
  const [duplicateHeroes, setDuplicateHeroes] = useState(currentConfig?.duplicateHeroes ?? false);
  const [captainMode, setCaptainMode] = useState(currentConfig?.captainMode ?? false);
  const [hostRole, setHostRole] = useState<'amber' | 'sapphire' | 'spectator'>('amber'); 
  const [map, setMap] = useState(currentConfig?.map || 'street_test');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateMatch = async () => {
    setIsCreating(true);
    
    const finalSpectators = hostRole === 'spectator' ? Math.max(spectators, 1) : spectators;

    console.log("[MatchConfigPage] Processando configuração...");
    
    const config = {
      playersPerTeam,
      maxSpectators: finalSpectators,
      map,
      bansEnabled,
      duplicateHeroes,
      captainMode
    };

    try {
      if (isConnected && isHost) {
        // Apenas atualiza a partida existente (passa o novo time também)
        updateMatchConfig(config, hostRole);
      } else {
        // Cria uma partida nova do zero e aguarda o endereço final (Playit)
        const actualAddr = await startHostServer(config, hostRole);
        console.log("[MatchConfigPage] Servidor iniciado. Conectando via Playit:", actualAddr);
        
        // Host agora entra na própria sala via endereço do Playit, sem fallback local
        await connectToRoom(actualAddr, true, hostRole);
      }
    } catch (e) {
      console.error("Erro ao processar configuração:", e);
    } finally {
      setIsCreating(false);
      if (onNavigate) onNavigate('match-created');
    }
  };

  const handleHostRoleChange = (role: 'amber' | 'sapphire' | 'spectator') => {
    setHostRole(role);
    if (role === 'spectator' && spectators === 0) {
      setSpectators(1);
    }
  };

  const isServerRunning = isHost && isConnected;

  return (
    <div className="screen" style={{ gap: '3vh' }}>
      <HeaderLogo />
      <div className="config-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2vh' }}>
          <div className="config-title" style={{ margin: 0 }}>⚙ CONFIGURAR <span>PARTIDA</span></div>
          <button 
            className="option-btn" 
            style={{ 
              width: 'auto', 
              padding: '6px 12px', 
              fontSize: '10px', 
              border: '1px solid #1e293b',
              background: 'rgba(30, 41, 59, 0.3)'
            }}
            onClick={() => onNavigate?.('settings')}
          >
            SISTEMA ⚙
          </button>
        </div>

        <div className="config-grid">
          <div className="config-row">
            <span className="config-label">Minha Função</span>
            <div className="option-group">
              <button className={`option-btn ${hostRole === 'amber' ? 'active' : ''}`} onClick={() => handleHostRoleChange('amber')}>Time Âmbar</button>
              <button className={`option-btn ${hostRole === 'sapphire' ? 'active' : ''}`} onClick={() => handleHostRoleChange('sapphire')}>Time Safira</button>
              <button className={`option-btn ${hostRole === 'spectator' ? 'active' : ''}`} onClick={() => handleHostRoleChange('spectator')}>Espectador</button>
            </div>
          </div>

          <div className="config-row">
            <span className="config-label">Jogadores por time</span>
            <div className="option-group">
              {[4, 5, 6].map(n => (
                <button key={n} className={`option-btn ${playersPerTeam === n ? 'active' : ''}`} onClick={() => setPlayersPerTeam(n)}>{n}</button>
              ))}
            </div>
          </div>

          <div className="config-row">
            <span className="config-label">Espectadores</span>
            <div className="option-group">
              {[0, 1, 2, 3].map(n => {
                const isDisabled = hostRole === 'spectator' && n === 0;
                return (
                  <button 
                    key={n} 
                    className={`option-btn ${spectators === n ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`} 
                    onClick={() => !isDisabled && setSpectators(n)}
                    style={{ opacity: isDisabled ? 0.3 : 1, cursor: isDisabled ? 'not-allowed' : 'pointer' }}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="config-row">
            <span className="config-label">Mapa</span>
            <select className="map-select" value={map} onChange={e => setMap(e.target.value)}>
              <option value="street_test">street_test</option>
              <option value="dl_streets">dl_streets</option>
            </select>
          </div>

          <div className="config-row">
            <span className="config-label">Draft com banimentos</span>
            <div className="option-group">
              <button className={`option-btn ${bansEnabled ? 'active' : ''}`} onClick={() => setBansEnabled(true)}>Sim</button>
              <button className={`option-btn ${!bansEnabled ? 'active' : ''}`} onClick={() => setBansEnabled(false)}>Não</button>
            </div>
          </div>

          <div className="config-row">
            <span className="config-label">Heróis duplicados</span>
            <div className="option-group">
              <button className={`option-btn ${duplicateHeroes ? 'active' : ''}`} onClick={() => setDuplicateHeroes(true)}>Sim</button>
              <button className={`option-btn ${!duplicateHeroes ? 'active' : ''}`} onClick={() => setDuplicateHeroes(false)}>Não</button>
            </div>
          </div>

          <div className="config-row">
            <span className="config-label">Modo Capitão</span>
            <div className="option-group">
              <button className={`option-btn ${captainMode ? 'active' : ''}`} onClick={() => setCaptainMode(true)}>Sim</button>
              <button className={`option-btn ${!captainMode ? 'active' : ''}`} onClick={() => setCaptainMode(false)}>Não</button>
            </div>
          </div>
        </div>

        <button className="btn-create" onClick={handleCreateMatch} disabled={isCreating} style={{ opacity: isCreating ? 0.7 : 1 }}>
          <span>{isCreating ? 'PROCESSANDO...' : (isServerRunning ? 'ATUALIZAR CONFIGURAÇÕES' : 'CRIAR PARTIDA')}</span>
        </button>

        <div className="tunnel-status">
          <div className="status-dot" style={{ 
            background: isCreating ? '#f59e0b' : (isServerRunning ? '#22c55e' : tunnelError ? '#ef4444' : '#64748b'),
            boxShadow: isServerRunning ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none'
          }} />
          <span className="status-text" style={{ color: tunnelError ? '#ef4444' : '' }}>
            {isCreating ? 'Preparando Servidor e Túnel...' : 
             tunnelError ? `Erro: ${tunnelError}` : 
             isServerRunning ? `Servidor Rodando: ${tunnelAddress}` : 
             'Aguardando Configuração'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default MatchConfigPage;

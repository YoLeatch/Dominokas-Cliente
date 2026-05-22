import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useDraft } from '../context/DraftContext';
import { useSteamUser } from '../hooks/useSteamUser';
import { HeaderLogo } from '../components/common/HeaderLogo';
import { HEROES } from '../utils/heroes';
import '../styles/MatchInProgress.css';

interface Props {
  onNavigate?: (page: string) => void;
}

export const MatchInProgressPage: React.FC<Props> = ({ onNavigate }) => {
  const { 
    draftState, 
    isHost, 
    serverLogs, 
    sendMessage, 
    sendWorldMessage 
  } = useDraft();
  const { user } = useSteamUser();

  const [activeTab, setActiveTab] = useState<'controls' | 'console'>('controls');
  const [chatText, setChatText] = useState('');
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const consoleEndRef = useRef<HTMLDivElement>(null);

  const amberTeam = draftState?.amberTeam || [];
  const sapphireTeam = draftState?.sapphireTeam || [];
  const playitAddress = draftState?.playitAddress || "";
  
  const actualSteamId = (user as any)?.steamId || user?.steam_id;

  // Redireciona de volta para a tela inicial/config caso a partida seja finalizada (retornando a phase waiting)
  useEffect(() => {
    if (draftState?.phase === 'waiting') {
      if (onNavigate) {
        onNavigate('enter-match');
      }
    }
  }, [draftState?.phase, onNavigate]);

  // Rola o console para o final sempre que novos logs chegam
  useEffect(() => {
    if (activeTab === 'console' && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [serverLogs, activeTab]);

  // Limpa o timeout ao desmontar
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleConnect = async () => {
    if (playitAddress) {
      try {
        await invoke('connect_to_match', { addr: playitAddress });
      } catch (err) {
        console.error('Erro ao conectar ao jogo:', err);
        alert('Erro ao conectar ao jogo: ' + err);
      }
    } else {
      alert('Endereço do servidor não disponível.');
    }
  };

  const handleCopy = () => {
    if (!playitAddress) return;
    const command = `connect ${playitAddress}`;
    navigator.clipboard.writeText(command);
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const handlePause = async () => {
    try {
      await invoke('send_server_command', { command: 'dominokas_pause' });
      alert('Comando de pausa enviado ao servidor.');
    } catch (err) {
      console.error('Erro ao pausar:', err);
      alert('Erro ao pausar: ' + err);
    }
  };

  const handleResume = async () => {
    try {
      await invoke('send_server_command', { command: 'dominokas_resume' });
      alert('Comando de retomada enviado ao servidor.');
    } catch (err) {
      console.error('Erro ao retomar:', err);
      alert('Erro ao retomar: ' + err);
    }
  };

  const handleForceStart = async () => {
    if (window.confirm('Tem certeza de que deseja forçar o início da partida? Todos os jogadores ausentes serão ignorados.')) {
      try {
        await invoke('send_server_command', { command: 'start_force' });
        alert('Comando de início forçado enviado ao servidor dedicado.');
      } catch (err) {
        console.error('Erro ao forçar início:', err);
        alert('Erro ao forçar início: ' + err);
      }
    }
  };

  const handleSendWorldMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    sendWorldMessage(chatText);
    setChatText('');
  };

  const handleEndMatch = async () => {
    if (window.confirm('Tem certeza de que deseja finalizar a partida? Isso encerrará o servidor dedicado.')) {
      try {
        sendMessage({ type: 'END_MATCH' });
      } catch (err) {
        console.error('Erro ao finalizar partida:', err);
        alert('Erro ao finalizar partida: ' + err);
      }
    }
  };

  const renderHeroCard = (player: any, teamClass: 'amber' | 'sapphire') => {
    const isMe = player.steamId === actualSteamId;
    const heroInfo = HEROES.find(h => h.id === player.hero);

    return (
      <div 
        key={player.steamId} 
        className={`match-hero-card ${teamClass} ${isMe ? 'is-me' : ''}`}
      >
        <div className="match-card-avatar">
          {heroInfo?.image ? (
            <img src={heroInfo.image} alt={player.hero || 'hero'} />
          ) : (
            <div style={{ width: '100%', height: '100%', background: 'rgba(255,255,255,0.03)' }} />
          )}
        </div>
        <div className="match-card-info">
          <div className="match-card-player">
            {player.name} {player.isCaptain && '👑'}
          </div>
          <div className="match-card-hero">
            {heroInfo ? heroInfo.name.toUpperCase() : 'SELECIONANDO...'}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="match-in-progress-screen">
      <HeaderLogo />

      <div className="match-grid">
        {/* Coluna Âmbar */}
        <div className="match-team-column">
          <span className="match-team-title amber">🟡 TIME ÂMBAR</span>
          {amberTeam.map(p => renderHeroCard(p, 'amber'))}
          {amberTeam.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: '12px', padding: '10px' }}>
              Nenhum jogador escalado
            </div>
          )}
        </div>

        {/* Painel Central */}
        <div className="match-center-panel">
          {/* Card Status da Conexão */}
          <div className="match-status-card">
            <div className="match-badge">
              <div className="match-badge-dot" />
              <span className="match-badge-text">PARTIDA EM ANDAMENTO</span>
            </div>

            <button className="btn-connect-match" onClick={handleConnect}>
              ⚡ CONECTAR AO SERVIDOR
            </button>

            <div className="auto-connect-hint">
              O Deadlock tentará se conectar automaticamente. Caso o seu jogo já esteja aberto e falhe ao conectar, abra o console do jogo (<strong>tecla F7</strong>) e digite o comando abaixo:
            </div>

            <div className="copy-address-group">
              <input 
                type="text" 
                className="copy-address-input" 
                value={`connect ${playitAddress}`} 
                readOnly 
                onClick={handleCopy}
              />
              <button className="btn-copy-address" onClick={handleCopy}>
                {copied ? 'COPIADO!' : 'COPIAR'}
              </button>
            </div>
          </div>

          {/* Painel do Host */}
          {isHost && (
            <div className="host-control-box">
              <div className="host-tabs">
                <button 
                  className={`host-tab-btn ${activeTab === 'controls' ? 'active' : ''}`}
                  onClick={() => setActiveTab('controls')}
                >
                  Controles
                </button>
                <button 
                  className={`host-tab-btn ${activeTab === 'console' ? 'active' : ''}`}
                  onClick={() => setActiveTab('console')}
                >
                  Console
                </button>
              </div>

              <div className="host-tab-content">
                {activeTab === 'controls' ? (
                  <div className="host-control-panel">
                    <div className="host-button-row">
                      <button className="host-btn-action" onClick={handlePause}>
                        PAUSAR PARTIDA
                      </button>
                      <button className="host-btn-action" onClick={handleResume}>
                        RETOMAR PARTIDA
                      </button>
                      <button className="host-btn-action" onClick={handleForceStart}>
                        FORÇAR INÍCIO
                      </button>
                    </div>

                    <form className="host-chat-row" onSubmit={handleSendWorldMessage}>
                      <input 
                        type="text" 
                        className="host-chat-input"
                        placeholder="Enviar mensagem global in-game..."
                        value={chatText}
                        onChange={e => setChatText(e.target.value)}
                      />
                      <button type="submit" className="btn-host-send">
                        ENVIAR
                      </button>
                    </form>

                    <button className="host-btn-danger" onClick={handleEndMatch}>
                      💥 FINALIZAR PARTIDA
                    </button>
                  </div>
                ) : (
                  <div className="host-console-panel">
                    {serverLogs.map((log, i) => (
                      <div key={i} className={`console-log-line ${log.type}`}>
                        [{log.time}] {log.text}
                      </div>
                    ))}
                    <div ref={consoleEndRef} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Coluna Safira */}
        <div className="match-team-column">
          <span className="match-team-title sapphire">🔵 TIME SAFIRA</span>
          {sapphireTeam.map(p => renderHeroCard(p, 'sapphire'))}
          {sapphireTeam.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: '12px', padding: '10px' }}>
              Nenhum jogador escalado
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MatchInProgressPage;

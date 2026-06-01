import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useDraft } from '../context/DraftContext';
import '../styles/ServerConsole.css';

interface LogEntry {
  time: string;
  text: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'system' | 'cmd' | 'plugin';
}

interface Props {
  onNavigate?: (page: string) => void;
}

const ServerConsolePage: React.FC<Props> = ({ onNavigate }) => {
  const { 
    draftState, 
    isConnected, 
    tunnelAddress, 
    disconnect, 
    sendMessage, 
    serverLogs, 
    addCommandLog, 
    clearLogs, 
    isGameServerRunning, 
    setIsGameServerRunning,
    sendWorldMessage 
  } = useDraft();
  const [cmdInput, setCmdInput] = useState('');
  const [pauseReason, setPauseReason] = useState('');
  const [worldMsg, setWorldMsg] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(Date.now());
  const [uptime, setUptime] = useState('00:00:00');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [serverLogs, autoScroll]);

  // Uptime counter
  useEffect(() => {
    const interval = setInterval(() => {
      const diff = Date.now() - startTimeRef.current;
      const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
      const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
      const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
      setUptime(`${h}:${m}:${s}`);
    }, 1000);
    return () => {
      clearInterval(interval);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const sendCommand = async () => {
    if (!cmdInput.trim()) return;
    
    // Envia o comando para o log persistente do contexto (eco local)
    addCommandLog(cmdInput);
    
    const cmd = cmdInput.toLowerCase().trim();
    
    // Comandos de controle local da UI
    if (cmd === 'clear' || cmd === 'cls') {
      clearLogs();
    } 
    // Comandos reais enviados para o processo do servidor de jogo
    else {
      try {
        await invoke('send_server_command', { command: cmdInput });
      } catch (e) {
        console.error("Falha ao enviar comando ao servidor:", e);
      }
    }
    
    setCmdInput('');
  };

  const totalPlayers = draftState.amberTeam.length + draftState.sapphireTeam.length + draftState.spectators.length;
  const draftStarted = draftState.phase !== 'waiting';

  const handleRestart = () => {
    if (!showRestartConfirm) {
      setShowRestartConfirm(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setShowRestartConfirm(false), 4000); 
    } else {
      sendMessage({ type: 'RESTART_DRAFT' });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setShowRestartConfirm(false);
    }
  };

  const handleBack = () => {
    if (!onNavigate || isGameServerRunning) return;
    if (draftStarted) {
      onNavigate('draft-screen');
    } else {
      onNavigate('match-created');
    }
  };

  return (
    <div className="screen console-screen">
      <div className="console-header">
        <div className="header-left">
          {!isGameServerRunning && (
            <button className="back-btn-console" onClick={handleBack}>
              ← VOLTAR PARA {draftStarted ? 'DRAFT' : 'LOBBY'}
            </button>
          )}
          <span className="header-title-console">⚙ Console do <span>Servidor</span></span>
        </div>
        <div className="server-status">
          <div className={`server-dot ${isConnected || isGameServerRunning ? 'active' : ''}`} />
          <span className="server-status-text">{isGameServerRunning ? 'Servidor de Jogo Ativo' : (isConnected ? 'Online' : 'Aguardando')}</span>
        </div>
      </div>

      <div className="quick-actions">
        {!isGameServerRunning && (
          <button className="action-btn success" onClick={handleBack}>
            {draftStarted ? '👥 Ver Partida' : '👥 Ver Lobby'}
          </button>
        )}
        {isGameServerRunning && (
          <>
            <span style={{ color: '#22c55e', fontSize: '10px', fontWeight: 700, padding: '6px 14px', background: 'rgba(34, 197, 94, 0.05)', borderRadius: '4px', border: '1px solid rgba(34, 197, 94, 0.1)' }}>🛡️ MODO SERVIDOR DEDICADO ATIVO</span>
            <button 
              className="action-btn primary" 
              onClick={() => {
                const addr = tunnelAddress || draftState.playitAddress;
                if (addr) {
                  invoke('connect_to_match', { addr });
                } else {
                  alert('Endereço do servidor não encontrado.');
                }
              }}
              style={{ background: 'rgba(240, 185, 11, 0.1)', borderColor: 'rgba(240, 185, 11, 0.4)', color: '#f0b90b' }}
            >
              🎮 ENTRAR NO JOGO (STEAM)
            </button>
          </>
        )}
        <div className="btn-divider" />
        
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <input 
            type="text" 
            placeholder="Motivo (opcional)..." 
            value={pauseReason}
            onChange={e => setPauseReason(e.target.value)}
            disabled={!draftStarted}
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid #334155', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', color: 'white', width: '120px', opacity: !draftStarted ? 0.5 : 1 }}
          />
          <button 
            className="action-btn warn" 
            onClick={() => {
              if (isGameServerRunning && pauseReason.trim()) {
                invoke('send_server_command', { command: `dominokas_pause ${pauseReason}` }).catch(console.error);
              }
              sendMessage({ type: 'PAUSE_DRAFT' });
              setPauseReason('');
            }}
            disabled={draftState.isPaused || !draftStarted || (draftState.phase === 'complete' && !isGameServerRunning)}
            style={draftState.isPaused || !draftStarted || (draftState.phase === 'complete' && !isGameServerRunning) ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
            ⏸ {isGameServerRunning ? 'Pausar Partida' : 'Pausar Draft'}
            </button>
            </div>

            <button 
            className="action-btn success" 
            onClick={() => sendMessage({ type: 'RESUME_DRAFT' })}
            disabled={!draftState.isPaused || !draftStarted}
            style={!draftState.isPaused || !draftStarted ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
            ▶ {isGameServerRunning ? 'Retomar Partida' : 'Retomar Draft'}
            </button>

        {!isGameServerRunning && (
          <>
            <div className="btn-divider" />
            <button 
              className="action-btn info" 
              onClick={() => sendMessage({ type: 'UNDO_DRAFT_ACTION' })}
              disabled={!draftStarted}
              style={!draftStarted ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
              title="Desfazer último ban ou pick"
            >
              ⏪ Retroceder Ação
            </button>
            <button 
              className="action-btn warn" 
              onClick={handleRestart}
              disabled={!draftStarted}
              style={{ 
                background: showRestartConfirm ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.1)', 
                borderColor: showRestartConfirm ? '#ef4444' : 'rgba(239, 68, 68, 0.3)', 
                opacity: !draftStarted ? 0.5 : 1, 
                cursor: !draftStarted ? 'not-allowed' : 'pointer',
                fontWeight: showRestartConfirm ? 800 : 400
              }}
            >
              {showRestartConfirm ? '⚠️ CLIQUE PARA CONFIRMAR REINICIO' : '🔄 Recomeçar Draft'}
            </button>
          </>
        )}

        <div className="btn-divider" />
        
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <input 
            type="text" 
            placeholder="Mensagem Mundial..." 
            value={worldMsg}
            onChange={e => setWorldMsg(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && worldMsg.trim() && draftStarted && (sendWorldMessage(worldMsg), setWorldMsg(''))}
            disabled={!draftStarted}
            style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid #1e3a8a', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', color: 'white', width: '180px', opacity: !draftStarted ? 0.5 : 1 }}
          />
          <button 
            className="action-btn primary" 
            disabled={!draftStarted}
            style={!draftStarted ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            onClick={() => {
              if (worldMsg.trim()) {
                sendWorldMessage(worldMsg);
                setWorldMsg('');
              }
            }}
          >
            📣 ENVIAR MSG
          </button>
        </div>

        <div className="btn-divider" />
        <button className="action-btn primary" onClick={() => setCmdInput('status')}>📊 Status Rede</button>
        <button className="action-btn primary" onClick={() => setCmdInput('players')}>👤 Listar Jogadores</button>
        <div className="btn-divider" />
        <button className="action-btn danger" onClick={async () => {
          if (confirm(`Deseja realmente encerrar a ${isGameServerRunning ? 'partida' : 'sessão'}?`)) {
            if (isGameServerRunning) {
              try {
                await invoke('stop_deadlock_server');
                setIsGameServerRunning(false);
              } catch (e) {
                console.error("Erro ao parar servidor de jogo:", e);
              }
            }
            disconnect();
            onNavigate && onNavigate('match-config');
          }
        }}>✕ {isGameServerRunning ? 'Encerrar Partida' : 'Encerrar Servidor'}</button>
      </div>

      <div className="info-bar">
        <div className="info-item">
          <span className="info-label-bar">Endereço:</span>
          <span className="info-value-bar highlight">{tunnelAddress || 'Iniciando...'}</span>
        </div>
        <div className="info-item">
          <span className="info-label-bar">Jogadores:</span>
          <span className="info-value-bar">{totalPlayers} / {draftState.config.playersPerTeam * 2}</span>
        </div>
        <div className="info-item">
          <span className="info-label-bar">Mapa:</span>
          <span className="info-value-bar">{draftState.config.map}</span>
        </div>
        <div className="info-item">
          <span className="info-label-bar">Uptime:</span>
          <span className="info-value-bar">{uptime}</span>
        </div>
      </div>

      <div className="terminal-container">
        <div className="terminal-toolbar">
          <div className="terminal-tab">
            <span className="tab-dot red" />
            <span className="tab-dot yellow" />
            <span className="tab-dot green" />
            <span className="terminal-title">{isGameServerRunning ? 'deadlock-game-server — live console' : 'dominokas-server — live logs'}</span>
          </div>
          <div className="terminal-actions">
            <button className="term-btn" onClick={clearLogs}>Limpar</button>
            <button 
              className={`term-btn ${autoScroll ? 'active' : ''}`} 
              onClick={() => setAutoScroll(!autoScroll)}
            >
              {autoScroll ? 'Auto-scroll: ON' : 'Auto-scroll: OFF'}
            </button>
          </div>
        </div>

        <div className="terminal-output" ref={terminalRef}>
          {serverLogs.length === 0 && (
            <span className="log-line system">Aguardando eventos do sistema...</span>
          )}
          {serverLogs.map((log, i) => (
            <span key={i} className={`log-line ${log.type}`}>
              <span className="timestamp">[{log.time}]</span> {log.text}
            </span>
          ))}
        </div>

        <div className="cmd-input-bar">
          <span className="cmd-prompt">❯</span>
          <input
            className="cmd-input"
            type="text"
            placeholder="Digite um comando (ex: status, players, help)..."
            spellCheck={false}
            value={cmdInput}
            onChange={(e) => setCmdInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendCommand()}
          />
          <button className="cmd-send" onClick={sendCommand}>ENVIAR</button>
        </div>
      </div>
    </div>
  );
};

export default ServerConsolePage;

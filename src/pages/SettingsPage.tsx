import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { HeaderLogo } from '../components/common/HeaderLogo';
import '../styles/MatchConfig.css';

interface Props {
  onBack: () => void;
}

const SettingsPage: React.FC<Props> = ({ onBack }) => {
  const [detectedDir, setDetectedDir] = useState<string>('Detectando...');
  const [currentDir, setCurrentDir] = useState<string>('Carregando...');
  const [playitAddr, setPlayitAddr] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'up-to-date' | 'error'>('idle');
  const [updateErrorMsg, setUpdateErrorMsg] = useState<string>('');

  useEffect(() => {
    refreshDirs();
    loadPlayitAddr();

    const handleStatus = (e: Event) => {
      const customEvent = e as CustomEvent;
      const status = customEvent.detail;
      if (status === 'up-to-date') {
        setUpdateStatus('up-to-date');
        setTimeout(() => setUpdateStatus('idle'), 4000);
      } else if (typeof status === 'string' && status.startsWith('error')) {
        setUpdateStatus('error');
        setUpdateErrorMsg(status.replace('error: ', ''));
        setTimeout(() => setUpdateStatus('idle'), 5000);
      }
    };

    window.addEventListener('manual-update-status', handleStatus);
    return () => {
      window.removeEventListener('manual-update-status', handleStatus);
    };
  }, []);

  const handleCheckUpdates = () => {
    setUpdateStatus('checking');
    window.dispatchEvent(new CustomEvent('trigger-manual-update-check'));
  };

  const loadPlayitAddr = async () => {
    try {
      const addr = await invoke<string>('get_playit_address');
      setPlayitAddr(addr);
    } catch (e) {
      console.error("Erro ao carregar endereço Playit:", e);
    }
  };

  const handleSavePlayitAddr = async () => {
    try {
      await invoke('save_playit_address', { address: playitAddr });
      setSaveStatus('Endereço salvo com sucesso!');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (e) {
      alert("Erro ao salvar endereço: " + e);
    }
  };

  const handleStartRelay = async () => {
    try {
      const res = await invoke<string>('start_relay_server');
      alert(res);
    } catch (e) {
      alert("Erro ao iniciar Relay: " + e);
    }
  };

  const refreshDirs = async () => {
    try {
      const detected = await invoke<string>('get_detected_game_dir').catch(e => "Não detectado (Steam fechada?)");
      setDetectedDir(detected);

      const current = await invoke<string>('get_game_dir');
      setCurrentDir(current);
      setError(null);
    } catch (err: any) {
      setError(err.toString());
    }
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Selecione a pasta RAIZ do Deadlock (contendo a pasta citadel)'
      });

      if (selected && typeof selected === 'string') {
        // O usuário pode selecionar a pasta 'game' ou a raiz 'Deadlock' ou 'DeadlockSV'
        // Precisamos garantir que o backend valide se existe a pasta 'citadel' lá dentro
        await invoke('set_game_dir', { path: selected });
        await refreshDirs();
      }
    } catch (err: any) {
      alert("Erro ao selecionar pasta: " + err);
    }
  };

  const handleReset = async () => {
    try {
      await invoke('reset_game_dir');
      await refreshDirs();
    } catch (err: any) {
      alert("Erro ao resetar: " + err);
    }
  };

  return (
    <div className="screen" style={{ gap: '3vh' }}>
      <style dangerouslySetInnerHTML={{__html: `
        .spinner-mini {
          width: 12px;
          height: 12px;
          border: 2px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top-color: #fff;
          animation: spin-mini 0.8s linear infinite;
          display: inline-block;
        }
        @keyframes spin-mini {
          to { transform: rotate(360deg); }
        }
      `}} />
      <HeaderLogo />
      <div className="config-card" style={{ maxWidth: '600px', width: '90%' }}>
        <div className="config-title">⚙ CONFIGURAÇÕES DO <span>SISTEMA</span></div>

        <div className="config-grid" style={{ gap: '4vh', marginTop: '2vh', display: 'flex', flexDirection: 'column' }}>
          
          {/* SESSÃO PLAYIT MANUAL */}
          <div className="config-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
            <span className="config-label">Endereço Playit Manual (Túnel)</span>
            
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input 
                type="text"
                className="code-input"
                placeholder="ex: summer-beach.ply.gg:51980"
                value={playitAddr}
                onChange={e => setPlayitAddr(e.target.value)}
                style={{ 
                  width: '100%', 
                  background: 'rgba(0,0,0,0.4)', 
                  padding: '12px', 
                  fontSize: '13px',
                  fontFamily: "'Geist Mono', monospace",
                  margin: 0
                }}
              />
              <button 
                className="option-btn" 
                style={{ width: '100%', padding: '10px', fontSize: '11px', background: 'rgba(34, 197, 94, 0.1)', borderColor: 'rgba(34, 197, 94, 0.3)' }}
                onClick={handleSavePlayitAddr}
              >
                💾 SALVAR ENDEREÇO PLAYIT
              </button>
              {saveStatus && <span style={{ fontSize: '11px', color: '#22c55e', textAlign: 'center', width: '100%' }}>{saveStatus}</span>}

              <button 
                className={`option-btn`}
                style={{ width: '100%', padding: '10px', fontSize: '11px', background: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.3)', marginTop: '8px' }}
                onClick={handleStartRelay}
              >
                🌐 INICIAR RELAY SERVER (MODO MESTRE)
              </button>
            </div>

            <div style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic' }}>
              * Use esta opção caso o Playit não retorne o endereço automaticamente.
            </div>
          </div>

          <div className="config-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
            <span className="config-label">Diretório do Deadlock / Servidor</span>

            <div style={{
              width: '100%',
              background: 'rgba(0,0,0,0.4)',
              padding: '15px',
              borderRadius: '8px',
              border: '1px solid #1e293b',
              fontSize: '12px',
              fontFamily: "'JetBrains Mono', monospace",
              wordBreak: 'break-all',
              color: '#cbd5e1',
              boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)'
            }}>
              {currentDir}
            </div>

            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button
                className="option-btn"
                style={{ flex: 1, padding: '12px', fontSize: '11px' }}
                onClick={handleSelectFolder}
              >
                📁 ALTERAR PASTA
              </button>
              <button
                className="option-btn"
                style={{ flex: 1, padding: '12px', fontSize: '11px' }}
                onClick={handleReset}
              >
                🔄 USAR PADRÃO STEAM
              </button>
            </div>
          </div>

          {/* ATUALIZAÇÃO DO APLICATIVO */}
          <div className="config-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
            <span className="config-label">Atualização do Dominokas</span>
            
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                className="option-btn"
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '11px',
                  background: updateStatus === 'checking' ? 'rgba(240, 185, 11, 0.05)' : 'rgba(240, 185, 11, 0.1)',
                  borderColor: updateStatus === 'checking' ? 'rgba(240, 185, 11, 0.2)' : 'rgba(240, 185, 11, 0.4)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: updateStatus === 'checking' ? 'not-allowed' : 'pointer'
                }}
                onClick={handleCheckUpdates}
                disabled={updateStatus === 'checking'}
              >
                {updateStatus === 'checking' ? (
                  <>
                    <span className="spinner-mini" /> BUSCANDO ATUALIZAÇÕES...
                  </>
                ) : (
                  '🚀 VERIFICAR SE HÁ ATUALIZAÇÕES'
                )}
              </button>

              {updateStatus === 'up-to-date' && (
                <div style={{
                  fontSize: '11px',
                  color: '#10b981',
                  textAlign: 'center',
                  background: 'rgba(16, 185, 129, 0.08)',
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(16, 185, 129, 0.2)',
                  fontFamily: "'Geist Mono', monospace"
                }}>
                  ✨ O Dominokas já está na versão mais recente!
                </div>
              )}

              {updateStatus === 'error' && (
                <div style={{
                  fontSize: '11px',
                  color: '#f43f5e',
                  textAlign: 'center',
                  background: 'rgba(244, 63, 94, 0.08)',
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(244, 63, 94, 0.2)',
                  fontFamily: "'Geist Mono', monospace"
                }}>
                  ⚠️ Erro ao buscar atualizações: {updateErrorMsg}
                </div>
              )}
            </div>
          </div>

          <div style={{
            fontSize: '12px',
            color: '#94a3b8',
            lineHeight: '1.6',
            background: 'rgba(30, 41, 59, 0.5)',
            padding: '12px',
            borderRadius: '6px',
            borderLeft: '3px solid #f0b90b'
          }}>
            <strong>Nota técnica:</strong> O Launcher salvará o arquivo <code style={{ color: '#f0b90b' }}>match_state.json</code> na pasta <code style={{ color: '#f0b90b' }}>citadel/cfg</code> deste diretório.
            <br />
            Para o <strong>DeadlockSV</strong>, selecione a pasta que contém a subpasta <strong>citadel</strong>.
          </div>

          {error && (
            <div style={{
              color: '#ef4444',
              fontSize: '13px',
              padding: '10px',
              background: 'rgba(239, 68, 68, 0.1)',
              borderRadius: '6px',
              border: '1px solid rgba(239, 68, 68, 0.2)'
            }}>
              ⚠️ {error}
            </div>
          )}
        </div>

        <button className="btn-create" onClick={onBack} style={{ marginTop: '2vh' }}>
          <span>VOLTAR</span>
        </button>
      </div>
    </div>
  );
};

export default SettingsPage;

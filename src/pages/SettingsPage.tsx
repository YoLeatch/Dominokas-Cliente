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
  
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    refreshDirs();
    loadPlayitAddr();

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

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
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => setSaveStatus(null), 3000);
    } catch (e) {
      alert("Erro ao salvar endereço: " + e);
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
            </div>

            <div style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic' }}>
              * Insira o endereço manual caso o Playit automático não consiga alocar uma porta ativa.
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

        <button className="btn-create" onClick={onBack} style={{ marginTop: '3vh' }}>
          <span>VOLTAR</span>
        </button>
      </div>
    </div>
  );
};

export default SettingsPage;

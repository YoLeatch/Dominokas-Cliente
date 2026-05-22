import React, { useState, useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { useDraft } from '../context/DraftContext';
import { HeaderLogo } from '../components/common/HeaderLogo';
import '../styles/EnterMatch.css';

type HostRole = 'amber' | 'sapphire' | 'spectator';

interface Props {
  onNavigate?: (page: string) => void;
}

const EnterMatchPage: React.FC<Props> = ({ onNavigate }) => {
  const [code, setCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const { connectToRoom, isConnected, user } = useDraft();
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Escuta se a conexão foi bem-sucedida pelo WebSocket
  useEffect(() => {
    if (isJoining && isConnected) {
      setIsJoining(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (onNavigate) onNavigate('player-waiting');
    }
  }, [isConnected, isJoining, onNavigate]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleJoinRoom = async () => {
    try {
      const update = await check();
      if (update) {
        window.dispatchEvent(new CustomEvent('trigger-manual-update-check'));
        alert('Uma atualização obrigatória está disponível (v' + update.version + '). Por favor, atualize o cliente antes de jogar.');
        return;
      }
    } catch (err) {
      console.error('[Update Check Error in handleJoinRoom]', err);
    }

    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode || trimmedCode.length < 4) {
      alert('Por favor, insira um código de partida válido.');
      return;
    }

    setIsJoining(true);
    
    let role: HostRole = 'amber';
    let ip = ''; 

    // Se o código contiver @, ainda suportamos por compatibilidade, mas o foco é o lookup
    if (trimmedCode.includes('@')) {
      const [codepart, addrPart] = trimmedCode.split('@', 2);
      ip = addrPart.toLowerCase();
      if (codepart.startsWith('AMBR')) role = 'amber';
      else if (codepart.startsWith('SAPH')) role = 'sapphire';
      else if (codepart.startsWith('SPEC')) role = 'spectator';
      sessionStorage.setItem('dominokas_match_code', codepart);
    } 
    // Se for um endereço direto
    else if (trimmedCode.includes('.') || trimmedCode.includes(':')) {
      ip = trimmedCode.toLowerCase();
      sessionStorage.setItem('dominokas_match_code', trimmedCode);
    } 
    // Lookup pelo código (Novo sistema)
    else {
      console.log(`[EnterMatch] Tentando lookup para o código: ${trimmedCode}`);
      try {
        const response = await fetch(`http://dominokas-list.playit.plus/lookup/${trimmedCode}`);
        if (response.ok) {
          const data = await response.json();
          ip = data.ip;
          if (trimmedCode.startsWith('AMBR')) role = 'amber';
          else if (trimmedCode.startsWith('SAPH')) role = 'sapphire';
          else if (trimmedCode.startsWith('SPEC')) role = 'spectator';
          console.log(`[Relay] IP resolvido: ${ip}`);
          sessionStorage.setItem('dominokas_match_code', trimmedCode);
        } else {
          alert('Código não encontrado ou servidor de relay offline.');
          setIsJoining(false);
          return;
        }
      } catch (e) {
        console.error("[Relay] Erro na consulta:", e);
        alert('Erro ao consultar o servidor de códigos.');
        setIsJoining(false);
        return;
      }
    }

    if (!ip) {
      alert('Endereço não encontrado.');
      setIsJoining(false);
      return;
    }

    console.log(`[EnterMatch] conectando em ip='${ip}' com role='${role}'`);
    connectToRoom(ip, false, role);

    // Timeout de segurança
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsJoining((currentlyJoining) => {
        if (currentlyJoining) {
          alert('Falha ao conectar. Verifique sua conexão.');
          sessionStorage.removeItem('dominokas_match_code');
          return false;
        }
        return currentlyJoining;
      });
    }, 5000);
  };

  const handleCreateRoom = async () => {
    try {
      const update = await check();
      if (update) {
        window.dispatchEvent(new CustomEvent('trigger-manual-update-check'));
        alert('Uma atualização obrigatória está disponível (v' + update.version + '). Por favor, atualize o cliente antes de jogar.');
        return;
      }
    } catch (err) {
      console.error('[Update Check Error in handleCreateRoom]', err);
    }

    if (!user) {
      alert('Perfil Steam não detectado. Por favor, certifique-se de que a Steam está aberta antes de criar uma sala como Host.');
      return;
    }

    const ALLOWED_IDS = ["1520598345", "355235505"];
    
    // Obter o SteamID64 bruto do usuário
    const steamId64Str = user.steam_id || '';
    
    // Obter o Account ID correspondente (SteamID32) convertendo BigInt de 64 bits para AccountID
    let accountIdStr = '';
    try {
      if (steamId64Str) {
        const id64 = BigInt(steamId64Str);
        // Constante base do SteamID64 (76561197960265728)
        const accountId = id64 - BigInt("76561197960265728");
        accountIdStr = accountId.toString();
      }
    } catch (e) {
      console.error("Erro ao converter SteamID:", e);
    }

    console.log(`[EnterMatch] Tentando criar sala. User SteamID64='${steamId64Str}', AccountID='${accountIdStr}'`);

    const isAllowed = 
      ALLOWED_IDS.includes(steamId64Str) || 
      ALLOWED_IDS.includes(accountIdStr);

    if (isAllowed) {
      if (onNavigate) onNavigate('match-config');
    } else {
      alert(`Seu ID Steam (${steamId64Str || 'Desconhecido'}) não possui permissão de administrador para hospedar partidas.`);
    }
  };

  return (
    <div className="screen enter-match-screen">
      <HeaderLogo />
      <div className="center-content">
        <span className="brand-title">DOMINOKAS <span>CLIENT</span></span>
        
        <span className="code-label">Insira o código da partida ou IP:</span>
        <input
          className="code-input"
          type="text"
          placeholder="XXXX-0000"
          maxLength={500}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
          spellCheck={false}
          disabled={isJoining}
          style={{ width: '100%', maxWidth: '500px' }}
        />
        <button 
          className="btn-enter" 
          onClick={handleJoinRoom}
          disabled={isJoining}
          style={{ opacity: isJoining ? 0.7 : 1 }}
        >
          <span>{isJoining ? 'CONECTANDO...' : 'ENTRAR'}</span>
        </button>
        <button 
          className="btn-enter" 
          style={{ marginTop: '10px', background: 'transparent', border: 'none', color: 'var(--color-gold)' }}
          onClick={handleCreateRoom}
        >
          <span>CRIAR SALA (HOST)</span>
        </button>
      </div>
    </div>
  );
};

export default EnterMatchPage;

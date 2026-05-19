import React, { useState, useEffect } from 'react';
import { useDraft } from '../context/DraftContext';
import { HeaderLogo } from '../components/common/HeaderLogo';
import '../styles/EnterMatch.css';

type HostRole = 'amber' | 'sapphire' | 'spectator';

interface Props {
  onNavigate?: (page: string) => void;
}

const EnterMatchPage: React.FC<Props> = ({ onNavigate }) => {
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const { connectToRoom, isConnected } = useDraft();

  // Escuta se a conexão foi bem-sucedida pelo WebSocket
  useEffect(() => {
    if (isJoining && isConnected) {
      setIsJoining(false);
      if (onNavigate) onNavigate('player-waiting');
    }
  }, [isConnected, isJoining, onNavigate]);

  const handleJoinRoom = async () => {
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
    } 
    // Se for um endereço direto
    else if (trimmedCode.includes('.') || trimmedCode.includes(':')) {
      ip = trimmedCode.toLowerCase();
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
    setTimeout(() => {
      setIsJoining((currentlyJoining) => {
        if (currentlyJoining) {
          alert('Falha ao conectar. Verifique sua conexão.');
          return false;
        }
        return currentlyJoining;
      });
    }, 5000);
  };

  const handleCreateRoom = () => {
    if (!showPassword) {
      setShowPassword(true);
      return;
    }
    
    if (password === 'noke@mee8128') {
      if (onNavigate) onNavigate('match-config');
    } else {
      alert('Senha de administrador incorreta!');
      setPassword('');
    }
  };

  return (
    <div className="screen enter-match-screen">
      <HeaderLogo />
      <div className="center-content">
        <span className="brand-title">DOMINOKAS <span>CLIENT</span></span>
        
        {!showPassword ? (
          <>
            <span className="code-label">Insira o código da partida ou IP:</span>
            <input
              className="code-input"
              type="text"
              placeholder="XXXX-0000"
              maxLength={500}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
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
          </>
        ) : (
          <>
            <span className="code-label" style={{ color: 'var(--color-gold)' }}>Senha de Administrador:</span>
            <input
              className="code-input"
              type="password"
              placeholder="••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="btn-enter" onClick={handleCreateRoom}>
              <span>AUTENTICAR</span>
            </button>
            <button 
              className="btn-enter secondary-btn" 
              style={{ marginTop: '10px', background: 'transparent', border: 'none', color: '#64748b', fontSize: '12px' }}
              onClick={() => { setShowPassword(false); setPassword(''); }}
            >
              <span>VOLTAR</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default EnterMatchPage;

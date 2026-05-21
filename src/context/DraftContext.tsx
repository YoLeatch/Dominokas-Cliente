import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DraftState, PlayerSlot, WSMessage, MatchConfig, HostRole, LogEntry } from '../types/draft';
import { HEROES } from '../utils/heroes';

const INITIAL_STATE: DraftState = {
  config: {
    playersPerTeam: 6,
    maxSpectators: 0,
    bansEnabled: true,
    duplicateHeroes: false,
    captainMode: false,
    map: 'street_test'
  },
  amberTeam: [],
  sapphireTeam: [],
  spectators: [],
  bannedHeroes: [],
  phase: 'waiting',
  currentTurnTeam: null,
  currentTurnPlayerId: null,
  timeRemaining: 30,
  matchCodes: {
    amber: '',
    sapphire: '',
    spectator: ''
  },
  hostSteamId: '',
  playitAddress: null
};

const DRAFT_SEQUENCE: Array<{ phase: 'ban' | 'pick', team: 'amber' | 'sapphire' }> = [
  { phase: 'ban', team: 'amber' },     // Turn 1
  { phase: 'ban', team: 'sapphire' },  // Turn 2
  { phase: 'pick', team: 'amber' },    // Turn 3
  { phase: 'pick', team: 'sapphire' }, // Turn 4
  { phase: 'pick', team: 'sapphire' }, // Turn 5
  { phase: 'pick', team: 'amber' },    // Turn 6
  { phase: 'pick', team: 'amber' },    // Turn 7
  { phase: 'pick', team: 'sapphire' }, // Turn 8
  { phase: 'ban', team: 'sapphire' },  // Turn 9
  { phase: 'ban', team: 'amber' },     // Turn 10
  { phase: 'pick', team: 'sapphire' }, // Turn 11
  { phase: 'pick', team: 'amber' },    // Turn 12
  { phase: 'pick', team: 'amber' },    // Turn 13
  { phase: 'pick', team: 'sapphire' }, // Turn 14
  { phase: 'pick', team: 'sapphire' }, // Turn 15
  { phase: 'pick', team: 'amber' }     // Turn 16
];

interface DraftContextType {
  draftState: DraftState;
  isConnected: boolean;
  isHost: boolean;
  isGameServerRunning: boolean;
  tunnelAddress: string | null;
  tunnelError: string | null;
  serverLogs: LogEntry[];
  user: { name: string, steam_id: string } | null;
  connectToRoom: (ip: string, host: boolean, role?: HostRole) => Promise<void>;
  sendMessage: (msg: WSMessage) => void;
  disconnect: () => void;
  startHostServer: (config: MatchConfig, role: HostRole) => Promise<string>;
  updateMatchConfig: (config: MatchConfig, hostRole?: HostRole) => void;
  setDraftState: (state: DraftState) => void;
  setIsConnected: (connected: boolean) => void;
  setIsGameServerRunning: (running: boolean) => void;
  addCommandLog: (cmd: string) => void;
  sendWorldMessage: (text: string) => void;
  clearLogs: () => void;
}

const DraftContext = createContext<DraftContextType | null>(null);

export const DraftProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [draftState, setDraftState] = useState<DraftState>(INITIAL_STATE);
  const [isConnected, setIsConnected] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [isGameServerRunning, setIsGameServerRunning] = useState(false);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [tunnelAddress, setTunnelAddress] = useState<string | null>(null);
  const [tunnelError, setTunnelError] = useState<string | null>(null);
  const [serverLogs, setServerLogs] = useState<LogEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const hostStateRef = useRef<DraftState>(INITIAL_STATE);
  const lastRequestedRoleRef = useRef<HostRole>('amber');
  const hasSentInitialJoin = useRef(false);

  const [user, setUser] = useState<{ name: string, steam_id: string } | null>(null);

  const emitLog = (text: string, type: 'info' | 'success' | 'warn' | 'error' | 'system' | 'cmd' = 'info') => {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    const newEntry: LogEntry = { time, text, type };
    
    setServerLogs(prev => [...prev, newEntry]);
    window.dispatchEvent(new CustomEvent('server-log', { detail: newEntry }));
  };

  const addCommandLog = (cmd: string) => {
    emitLog(cmd, 'cmd');
  };

  const sendWorldMessage = (text: string) => {
    if (isGameServerRunning) {
      invoke('send_server_command', { command: `dominokas_msg ${text}` }).catch(console.error);
      emitLog(`MENSAGEM MUNDIAL: ${text}`, 'info');
    } else {
      // No draft, envia via WebSocket para todos os clientes
      sendMessage({ type: 'WORLD_MESSAGE', text });
      emitLog(`MSG DRAFT: ${text}`, 'info');
    }
  };

  const clearLogs = () => {
    setServerLogs([]);
  };

  useEffect(() => {
    invoke('get_steam_user').then((u: any) => {
      if (u) setUser({ name: u.name, steam_id: u.steamId || u.steam_id });
    }).catch(() => { });

    // Listen para logs do Servidor Deadworks (Backend)
    let unlisten: (() => void) | undefined;
    
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<string>('deadlock-server-log', (event) => {
        emitLog(event.payload, event.payload.includes('ERROR') ? 'error' : 'system');
      }).then(fn => unlisten = fn);
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Persistir o draftState sempre que houver conexão ativa
  useEffect(() => {
    if (draftState && isConnected) {
      sessionStorage.setItem('dominokas_draft_state', JSON.stringify(draftState));
    }
  }, [draftState, isConnected]);

  // Loop de Heartbeat / Keep-Alive para evitar que o túnel e a conexão caiam por inatividade
  useEffect(() => {
    if (!isConnected || !socket) return;

    console.log("[DraftContext] Iniciando loop de heartbeat para manter a conexao ativa...");
    
    const intervalId = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        console.log("[DraftContext] Enviando HEARTBEAT keep-alive...");
        socket.send(JSON.stringify({ type: 'HEARTBEAT' }));
      }
    }, 20000); // Envia a cada 20 segundos

    return () => {
      console.log("[DraftContext] Parando loop de heartbeat.");
      clearInterval(intervalId);
    };
  }, [isConnected, socket]);

  // Recuperação de sessão automática em caso de recarregamento (F5/Reload)
  useEffect(() => {
    if (!user) return; // Espera obter o usuário Steam para garantir dados completos no JOIN_ROOM

    const savedIp = sessionStorage.getItem('dominokas_ws_ip');
    const savedIsHost = sessionStorage.getItem('dominokas_is_host') === 'true';
    const savedRole = sessionStorage.getItem('dominokas_role') as HostRole | null;
    const savedDraftState = sessionStorage.getItem('dominokas_draft_state');

    if (savedDraftState) {
      try {
        const parsed = JSON.parse(savedDraftState);
        setDraftState(parsed);
        hostStateRef.current = parsed;
      } catch (e) {
        console.error("[DraftContext] Erro ao carregar draftState do sessionStorage:", e);
      }
    }

    if (savedIp && savedRole) {
      console.log(`[DraftContext] Auto-reconectando ao lobby salvo: IP=${savedIp}, IsHost=${savedIsHost}, Role=${savedRole}`);
      emitLog('Restaurando sessão anterior...', 'system');
      
      // Define a última role solicitada antes de conectar
      lastRequestedRoleRef.current = savedRole;
      
      connectToRoom(savedIp, savedIsHost, savedRole).catch(err => {
        console.error("[DraftContext] Falha na auto-reconexão:", err);
        emitLog('Falha ao restaurar sessão anterior.', 'error');
      });
    }
  }, [user]);

  const generateMatchCode = (prefix: string) => {
    return prefix + "-" + Math.random().toString(36).substring(2, 7).toUpperCase();
  };

  const startHostServer = async (config: MatchConfig, role: HostRole): Promise<string> => {
    emitLog('Iniciando Host do Servidor...', 'system');
    console.log("[DraftContext] Iniciando host...");
    const actualSteamId = user?.steam_id || "0";

    // Inicia o servidor Rust primeiro
    try {
      await invoke('start_draft_server');
      emitLog('Backend Rust (TCP 27025) ativo.', 'success');
    } catch (e) {
      console.warn("[DraftContext] Servidor já estava ativo ou falhou:", e);
      emitLog('Servidor backend já em execução ou falhou.', 'warn');
    }

    let finalAddr = ''; 

    // Tenta carregar o endereço manual primeiro
    try {
      emitLog('Resolvendo endereço de túnel...', 'system');
      const manualAddr = await invoke<string>('get_playit_address');
      if (manualAddr && manualAddr.trim() !== "") {
        console.log("[DraftContext] Usando endereço Playit MANUAL das configurações:", manualAddr);
        finalAddr = manualAddr;
        setTunnelAddress(manualAddr);
        emitLog(`Usando IP Manual: ${manualAddr}`, 'info');
        
        // Inicia o processo do Playit em background mesmo assim para garantir que o túnel existe, 
        // mas não espera por ele se já temos o endereço manual.
        invoke('start_tunnel').catch(e => console.warn("[Tunnel] Erro ao iniciar Playit (manual ativo):", e));
      } else {
        // Se não houver endereço manual, tenta o automático (AGUARDANDO)
        console.log("[DraftContext] Sem endereço manual. Solicitando abertura AUTOMÁTICA de túnel Playit...");
        emitLog('Aguardando resposta do Playit CLI...', 'system');
        const addr = await invoke<string>('start_tunnel');
        console.log('[Tunnel] Playit automático ativo em:', addr);
        finalAddr = addr;
        setTunnelAddress(addr);
        setTunnelError(null);
        emitLog(`Túnel Playit ativo em: ${addr}`, 'success');
      }
    } catch (err) {
      console.error('[Tunnel] Falha no fluxo de endereço Playit:', err);
      setTunnelError(err as string);
      emitLog(`ERRO PLAYIT: ${err}`, 'error');
      throw new Error("Falha ao obter endereço Playit. O sistema depende 100% do túnel.");
    }

    if (!finalAddr) {
        throw new Error("Endereço Playit não encontrado. Verifique se o Playit está rodando.");
    }

    const freshState: DraftState = {
      ...INITIAL_STATE,
      config,
      hostSteamId: actualSteamId,
      matchCodes: {
        amber: generateMatchCode('AMBR'),
        sapphire: generateMatchCode('SAPH'),
        spectator: generateMatchCode('SPEC')
      },
      amberTeam: [],
      sapphireTeam: [],
      spectators: [],
      phase: 'waiting',
      timeRemaining: 30,
      playitAddress: finalAddr
    };

    hostStateRef.current = freshState;
    lastRequestedRoleRef.current = role;

    // Salva a role e o código de partida do Host no sessionStorage
    sessionStorage.setItem('dominokas_role', role);
    const myMatchCode = freshState.matchCodes[role];
    sessionStorage.setItem('dominokas_match_code', myMatchCode);

    // Registrar códigos no Relay Server (dominokas-list.playit.plus)
    emitLog('Registrando códigos no Relay Server...', 'system');
    const relayUrl = 'http://dominokas-list.playit.plus/register';
    const registerCode = async (code: string, ip: string) => {
      try {
        await fetch(relayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, ip })
        });
        console.log(`[Relay] Código ${code} registrado para ${ip}`);
        emitLog(`Código ${code.split('-')[0]} registrado com sucesso.`, 'success');
      } catch (e) {
        console.warn(`[Relay] Falha ao registrar código ${code}:`, e);
        emitLog(`Falha ao registrar ${code} no Relay.`, 'error');
      }
    };

    if (finalAddr) {
      registerCode(freshState.matchCodes.amber, finalAddr);
      registerCode(freshState.matchCodes.sapphire, finalAddr);
      registerCode(freshState.matchCodes.spectator, finalAddr);
    }

    return finalAddr;
  };

  const updateMatchConfig = (config: MatchConfig, hostRole?: HostRole) => {
    const currentHostId = hostStateRef.current?.hostSteamId;
    if (!currentHostId) {
      console.warn("[DraftContext] updateMatchConfig: nao e host, ignorando.");
      return;
    }

    console.log("[DraftContext] Atualizando config...", config, "novoTime:", hostRole);
    let newState = { ...hostStateRef.current, config };

    // Se o hostRole mudou, reposiciona o host entre os times
    if (hostRole) {
      const hostPlayer = [
        ...newState.amberTeam,
        ...newState.sapphireTeam,
        ...newState.spectators
      ].find(p => p.steamId === currentHostId);

      if (hostPlayer) {
        newState.amberTeam = newState.amberTeam.filter(p => p.steamId !== currentHostId);
        newState.sapphireTeam = newState.sapphireTeam.filter(p => p.steamId !== currentHostId);
        newState.spectators = newState.spectators.filter(p => p.steamId !== currentHostId);

        const updatedHost = { ...hostPlayer, isHost: true };
        if (hostRole === 'amber') newState.amberTeam = [...newState.amberTeam, updatedHost];
        else if (hostRole === 'sapphire') newState.sapphireTeam = [...newState.sapphireTeam, updatedHost];
        else newState.spectators = [...newState.spectators, updatedHost];

        lastRequestedRoleRef.current = hostRole;
      }
    }

    // Atualiza apenas a referência mestre e envia via socket.
    hostStateRef.current = newState;

    const ws = wsRef.current || socket;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'STATE_UPDATE', state: newState }));
      console.log("[DraftContext] STATE_UPDATE enviado pelo Host.");
    } else {
      console.warn("[DraftContext] WebSocket nao disponível para propagar config.");
    }
  };

  const connectToRoom = (ip: string, host: boolean, role: HostRole = 'amber'): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (wsRef.current) wsRef.current.close();

      setIsHost(host);
      
      // Salva os dados de conexão no sessionStorage
      sessionStorage.setItem('dominokas_ws_ip', ip);
      sessionStorage.setItem('dominokas_is_host', JSON.stringify(host));
      sessionStorage.setItem('dominokas_role', role);

      const wsUrl = `ws://${ip}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("[DraftContext] WebSocket Aberto em:", wsUrl);
        setIsConnected(true);
        setSocket(ws);
        wsRef.current = ws;

        if (user) {
          const actualSteamId = user.steam_id;
          const joinMsg: WSMessage = {
            type: 'JOIN_ROOM',
            requestedRole: role,
            player: {
              steamId: actualSteamId,
              name: user.name,
              hero: null,
              locked: false,
              isHost: host
            }
          };
          console.log("[DraftContext] Enviando JOIN_ROOM via Socket...");
          ws.send(JSON.stringify(joinMsg));
          hasSentInitialJoin.current = true;
          // REMOVIDO: handleIncomingMessage local. Agora esperamos o servidor devolver a mensagem.
        }
        resolve();
      };

      ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);
          handleIncomingMessage(msg, host, ws);
        } catch (e) {
          console.error("[DraftContext] Erro ao processar mensagem:", e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setSocket(null);
        wsRef.current = null;
        hasSentInitialJoin.current = false;
        console.log("[DraftContext] WebSocket Fechado.");
      };

      wsRef.current = ws;
    });
  };

  // Efeito para garantir que o Join seja enviado assim que TUDO estiver pronto
  useEffect(() => {
    if (isConnected && socket && user && !hasSentInitialJoin.current) {
      const actualSteamId = user.steam_id;
      const joinMsg: WSMessage = {
        type: 'JOIN_ROOM',
        requestedRole: lastRequestedRoleRef.current,
        player: {
          steamId: actualSteamId,
          name: user.name,
          hero: null,
          locked: false,
          isHost: isHost
        }
      };

      console.log("[DraftContext] Enviando JOIN_ROOM pendente via Effect...");
      socket.send(JSON.stringify(joinMsg));
      hasSentInitialJoin.current = true;
      // REMOVIDO: handleIncomingMessage local.
    }
  }, [isConnected, socket, user, isHost]);

  const handleIncomingMessage = (msg: WSMessage, hostMode: boolean, ws: WebSocket) => {
    let currentState = { ...hostStateRef.current };
    let stateChanged = false;

    if (msg.type === 'STATE_UPDATE') {
      // Sincroniza a referência do Host com o estado vindo do servidor (loopback)
      hostStateRef.current = msg.state;
      setDraftState(msg.state);
      const actualSteamId = user?.steam_id;
      if (msg.state.hostSteamId === actualSteamId) setIsHost(true);
      return;
    }

    if (msg.type === 'JOIN_ROOM' && hostMode) {
      stateChanged = true;
      const p = { ...msg.player };
      const roleName = (msg.requestedRole || 'spectator').toUpperCase();
      emitLog(`Jogador conectado: ${p.name} (${roleName})`, 'success');

      const newAmber = currentState.amberTeam.filter(x => x.steamId !== p.steamId);
      const newSapphire = currentState.sapphireTeam.filter(x => x.steamId !== p.steamId);
      const newSpectators = currentState.spectators.filter(x => x.steamId !== p.steamId);

      if (p.steamId === currentState.hostSteamId) p.isHost = true;

      // Se modo capitão e não há capitão neste time ainda, este vira capitão automaticamente
      if (currentState.config.captainMode) {
        if (msg.requestedRole === 'amber' && !newAmber.some(x => x.isCaptain)) {
          p.isCaptain = true;
        } else if (msg.requestedRole === 'sapphire' && !newSapphire.some(x => x.isCaptain)) {
          p.isCaptain = true;
        }
      }

      if (msg.requestedRole === 'amber') newAmber.push(p);
      else if (msg.requestedRole === 'sapphire') newSapphire.push(p);
      else newSpectators.push(p);

      currentState.amberTeam = newAmber;
      currentState.sapphireTeam = newSapphire;
      currentState.spectators = newSpectators;
    }

    else if (msg.type === 'SELECT_HERO' && hostMode) {
      if (currentState.phase !== 'pick') return; // Nao salva hero no slot de jogador durante a fase de BAN

      stateChanged = true;
      const team = msg.team === 'amber' ? currentState.amberTeam : currentState.sapphireTeam;

      if (currentState.config.captainMode) {
        // No modo capitão, apenas o capitão da vez pode selecionar
        if (msg.steamId !== currentState.currentTurnPlayerId) return;

        const targetPlayer = team.find(p => !p.locked);
        if (targetPlayer) {
          targetPlayer.hero = msg.heroId;
          emitLog(`Capitão selecionou herói: ${msg.heroId}`, 'cmd');
        }
      } else {
        // Modo normal: cada um escolhe o seu
        const player = team.find(p => p.steamId === msg.steamId);
        if (player && !player.locked) {
          player.hero = msg.heroId;
          emitLog(`${player.name} selecionou ${msg.heroId}`, 'info');
        }
      }
    }

    else if (msg.type === 'LOCK_HERO' && hostMode) {
      stateChanged = true;
      const teamSide = msg.team || currentState.currentTurnTeam;
      const team = teamSide === 'amber' ? currentState.amberTeam : currentState.sapphireTeam;

      // Validação de Ator: Permite se for o jogador da vez OU se for o Host (como fallback)
      const isTurnPlayer = msg.steamId === currentState.currentTurnPlayerId;
      const isHostFallback = msg.steamId === currentState.hostSteamId;

      if (!isTurnPlayer && !isHostFallback) {
        return;
      }

      let targetPlayer;
      if (currentState.config.captainMode) {
        // No modo capitão, o lock vai para o primeiro slot livre (incluindo Ausentes)
        targetPlayer = team.find(p => !p.locked);
        if (targetPlayer && msg.heroId) targetPlayer.hero = msg.heroId;
      } else {
        targetPlayer = team.find(p => p.steamId === msg.steamId);
        if (!targetPlayer && isHostFallback) {
           // Se o host está agindo como fallback no modo normal, pega o primeiro sem lock
           targetPlayer = team.find(p => !p.locked);
        }
        if (targetPlayer && msg.heroId) targetPlayer.hero = msg.heroId;
      }

      if (targetPlayer && targetPlayer.hero && !targetPlayer.locked) {
        targetPlayer.locked = true;
        emitLog(`${targetPlayer.name} LOCK: ${targetPlayer.hero}`, 'success');
        advanceDraftPhase(currentState);
      }
    }

    else if (msg.type === 'SET_CAPTAIN' && hostMode) {
      stateChanged = true;
      const team = msg.team === 'amber' ? currentState.amberTeam : currentState.sapphireTeam;
      const player = team.find(p => p.steamId === msg.steamId);
      
      if (player) {
        const wasCaptain = !!player.isCaptain;
        // Toggle: se ja era, remove. Se não era, vira o unico capitão do time.
        team.forEach(p => {
          if (p.steamId === msg.steamId) p.isCaptain = !wasCaptain;
          else p.isCaptain = false;
        });
        emitLog(`Status de Capitão alterado: ${player.name}`, 'warn');
        // Re-calcula o ator do turno caso o capitão tenha mudado
        advanceDraftPhase(currentState);
      }
    }

    else if (msg.type === 'BAN_HERO' && hostMode) {
      stateChanged = true;
      const heroId = msg.heroId;

      // Validação de Ator: Permite se for o jogador da vez OU se for o Host (como fallback)
      const isTurnPlayer = msg.steamId === currentState.currentTurnPlayerId;
      const isHostFallback = msg.steamId === currentState.hostSteamId;

      if (!isTurnPlayer && !isHostFallback) {
        emitLog(`Ação negada: Somente o jogador da vez ou Host pode banir.`, 'error');
        return;
      }

      if (!currentState.bannedHeroes.includes(heroId)) {
        currentState.bannedHeroes = [...currentState.bannedHeroes, heroId];
        emitLog(`HERÓI BANIDO: ${heroId}`, 'warn');
      }
      advanceDraftPhase(currentState);
    }

    else if (msg.type === 'START_DRAFT' && hostMode) {
      stateChanged = true;
      emitLog('DRAFT INICIADO.', 'system');

      // Reset state for a fresh draft
      currentState.bannedHeroes = [];
      currentState.isPaused = false;
      
      // Limpa heróis e locks dos jogadores reais
      currentState.amberTeam.forEach(p => { p.hero = null; p.locked = false; });
      currentState.sapphireTeam.forEach(p => { p.hero = null; p.locked = false; });

      // Remove jogadores SKIPPED/ABSENT de drafts anteriores para repovoar
      currentState.amberTeam = currentState.amberTeam.filter(p => !p.steamId.startsWith('SKIPPED_') && !p.steamId.startsWith('ABSENT_'));
      currentState.sapphireTeam = currentState.sapphireTeam.filter(p => !p.steamId.startsWith('SKIPPED_') && !p.steamId.startsWith('ABSENT_'));

      // Pre-povoa com slots "Ausente" até atingir o playersPerTeam
      const fillTeam = (team: PlayerSlot[], side: 'AMBER' | 'SAPPHIRE') => {
        const result = [...team];
        for (let i = result.length; i < currentState.config.playersPerTeam; i++) {
          result.push({
            steamId: `ABSENT_${side}_${i}`,
            name: "Ausente",
            hero: null,
            locked: false
          });
        }
        return result;
      };

      currentState.amberTeam = fillTeam(currentState.amberTeam, 'AMBER');
      currentState.sapphireTeam = fillTeam(currentState.sapphireTeam, 'SAPPHIRE');

      advanceDraftPhase(currentState);
    }

    else if (msg.type === 'PAUSE_DRAFT' && hostMode) {
      stateChanged = true;
      currentState.isPaused = true;
      emitLog('PAUSA ACIONADA PELO PROVEDOR.', 'warn');
      
      if (isGameServerRunning) {
        invoke('send_server_command', { command: 'dominokas_pause' }).catch(console.error);
      }
    }

    else if (msg.type === 'RESUME_DRAFT' && hostMode) {
      stateChanged = true;
      currentState.isPaused = false;
      emitLog('RETOMADA ACIONADA PELO PROVEDOR.', 'success');

      if (isGameServerRunning) {
        invoke('send_server_command', { command: 'dominokas_resume' }).catch(console.error);
      }
    }

    else if (msg.type === 'UNDO_DRAFT_ACTION' && hostMode) {
      stateChanged = true;
      emitLog('RETROCEDENDO ÚLTIMA AÇÃO...', 'warn');

      const totalBans = currentState.bannedHeroes.length;
      const allPlayers = [...currentState.amberTeam, ...currentState.sapphireTeam];
      const lockedPlayers = allPlayers.filter(p => p.locked);
      const totalPicks = lockedPlayers.length;

      // Determina se a ÚLTIMA ação foi um Ban ou um Pick baseada na DRAFT_SEQUENCE
      const totalActions = totalBans + totalPicks;
      if (totalActions > 0) {
        const lastActionIndex = totalActions - 1;
        const lastActionConfig = DRAFT_SEQUENCE[lastActionIndex];

        if (lastActionConfig.phase === 'ban') {
          // Desfaz Ban
          currentState.bannedHeroes.pop();
        } else {
          // Desfaz Pick: encontra o último player que foi bloqueado naquele time
          const team = lastActionConfig.team === 'amber' ? currentState.amberTeam : currentState.sapphireTeam;
          const lastPlayer = [...team].reverse().find(p => p.locked);
          if (lastPlayer) {
            lastPlayer.locked = false;
            lastPlayer.hero = null;
          }
        }

        // Recalcula o estado do turno atual
        advanceDraftPhase(currentState);
        
        hostStateRef.current = currentState;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'STATE_UPDATE', state: currentState }));
        }
        return;
      }
    }

    else if (msg.type === 'RESTART_DRAFT' && hostMode) {
      stateChanged = true;
      emitLog('RECOMEÇANDO DRAFT INTEIRO...', 'error');

      currentState.bannedHeroes = [];
      currentState.amberTeam.forEach(p => { p.hero = null; p.locked = false; });
      currentState.sapphireTeam.forEach(p => { p.hero = null; p.locked = false; });

      currentState.amberTeam = currentState.amberTeam.filter(p => !p.steamId.startsWith('SKIPPED_'));
      currentState.sapphireTeam = currentState.sapphireTeam.filter(p => !p.steamId.startsWith('SKIPPED_'));

      advanceDraftPhase(currentState);

      hostStateRef.current = currentState;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'STATE_UPDATE', state: currentState }));
      }
      return;
    }
    else if (msg.type === 'START_MATCH' && hostMode) {
      stateChanged = true;
      currentState.phase = 'match-in-progress';
      emitLog('PARTIDA INICIADA - REDIRECIONANDO JOGADORES...', 'success');
      invoke('save_match_state', { stateJson: JSON.stringify(currentState) }).catch(console.error);
    }
    else if (msg.type === 'END_MATCH' && hostMode) {
      stateChanged = true;
      currentState.phase = 'waiting';
      currentState.amberTeam.forEach(p => { p.hero = null; p.locked = false; });
      currentState.sapphireTeam.forEach(p => { p.hero = null; p.locked = false; });
      currentState.bannedHeroes = [];
      currentState.currentTurnTeam = null;
      currentState.currentTurnPlayerId = null;
      currentState.isPaused = false;
      emitLog('PARTIDA ENCERRADA PELO HOST - RETORNANDO AO LOBBY.', 'warn');
      
      invoke('stop_deadlock_server').catch(console.error);
      setIsGameServerRunning(false);
      invoke('save_match_state', { stateJson: JSON.stringify(currentState) }).catch(console.error);
    }
    else if (msg.type === 'WORLD_MESSAGE') {
      // Mensagem para todos
      const sender = hostMode ? "SISTEMA" : "HOST";
      console.log(`[WorldMessage] ${msg.text}`);
      // Alerta visual para o jogador
      alert(`MENSAGEM DO ${sender}:\n\n${msg.text}`);
    }

    if (stateChanged && hostMode) {
      hostStateRef.current = currentState;
      // Removido setDraftState direto: esperamos o loopback do WebSocket
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'STATE_UPDATE', state: currentState }));
      }
    }
  };

  const advanceDraftPhase = (state: DraftState) => {
    const totalBans = state.bannedHeroes.length;
    const totalPicks = [...state.amberTeam, ...state.sapphireTeam].filter(p => p.locked).length;
    let turnIndex = totalBans + totalPicks;

    while (turnIndex < DRAFT_SEQUENCE.length) {
      const nextTurn = DRAFT_SEQUENCE[turnIndex];
      const team = nextTurn.team === 'amber' ? state.amberTeam : state.sapphireTeam;

      if (nextTurn.phase === 'ban') {
        if (!state.config.bansEnabled) {
          // Pula o ban se desativado nas configs
          state.bannedHeroes.push(`SKIPPED_BAN_${turnIndex}`);
          turnIndex++;
          continue;
        } else {
          state.phase = 'ban';
          state.currentTurnTeam = nextTurn.team;

          // Define o Ator: Capitão -> Primeiro Jogador Real -> Host
          const realPlayers = team.filter(p => !p.steamId.startsWith('ABSENT_'));
          const captain = realPlayers.find(p => p.isCaptain);
          state.currentTurnPlayerId = captain ? captain.steamId : (realPlayers[0]?.steamId || state.hostSteamId);

          state.timeRemaining = 30;
          return;
        }
      } else {
        // Fase de Pick: Sempre obrigatório seguir a ordem de slots
        state.phase = 'pick';
        state.currentTurnTeam = nextTurn.team;

        // O pick sempre vai para o próximo jogador (Real ou Ausente) que não deu LOCK
        const nextPlayer = team.find(p => !p.locked);
        
        if (!nextPlayer) {
            // Caso raro onde todos os slots configurados ja deram lock
            turnIndex++;
            continue;
        }

        // Se for Modo Capitão, o Capitão clica para todos. Caso contrário, o próprio jogador.
        const realPlayers = team.filter(p => !p.steamId.startsWith('ABSENT_'));
        const captain = realPlayers.find(p => p.isCaptain);

        // Pula o Pick se o time for totalmente vazio ou se for a vez de um ausente sem um capitão para jogar por ele
        if (realPlayers.length === 0 || (!state.config.captainMode && nextPlayer.steamId.startsWith('ABSENT_'))) {
            nextPlayer.locked = true;
            nextPlayer.hero = 'skipped';
            turnIndex++;
            continue;
        }

        if (state.config.captainMode) {
            state.currentTurnPlayerId = captain ? captain.steamId : (realPlayers[0]?.steamId || state.hostSteamId);
        } else {
            // Se o slot da vez for um "Ausente", o Host assume a responsabilidade
            state.currentTurnPlayerId = nextPlayer.steamId.startsWith('ABSENT_') ? state.hostSteamId : nextPlayer.steamId;
        }

        state.timeRemaining = 30;
        return;
      }
    }

    // Se chegou aqui, acabaram os turnos
    state.phase = 'complete';
    state.currentTurnTeam = null;
    state.currentTurnPlayerId = null;
    invoke('save_match_state', { stateJson: JSON.stringify(state) }).catch(console.error);
  };

  const sendMessage = (msg: WSMessage) => {
    const activeWs = wsRef.current || socket;
    if (activeWs?.readyState === WebSocket.OPEN) {
      console.log("[DraftContext] Enviando mensagem ao servidor:", msg.type);
      activeWs.send(JSON.stringify(msg));
      // REMOVIDO: handleIncomingMessage(msg, true, activeWs); 
      // Agora o Host (como servidor) processará essa mensagem quando ela chegar via WebSocket (loopback).
    }
  };

  const disconnect = () => {
    if (wsRef.current) wsRef.current.close();
    setDraftState(INITIAL_STATE);
    setIsConnected(false);
    setIsHost(false);
    hasSentInitialJoin.current = false;
    
    // Limpa os dados persistidos no sessionStorage
    sessionStorage.removeItem('dominokas_ws_ip');
    sessionStorage.removeItem('dominokas_is_host');
    sessionStorage.removeItem('dominokas_role');
    sessionStorage.removeItem('dominokas_match_code');
    sessionStorage.removeItem('dominokas_draft_state');
  };

  useEffect(() => {
    if (!isHost || !isConnected || draftState.phase === 'waiting' || draftState.phase === 'complete' || draftState.phase === 'match-in-progress') return;

    const interval = setInterval(() => {
      let state = { ...hostStateRef.current };
      
      if (state.timeRemaining > 0 && !state.isPaused) {
        state.timeRemaining -= 1;
        hostStateRef.current = state;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'STATE_UPDATE', state }));
        }
      } else if (state.timeRemaining === 0 && !state.isPaused) {
        // TIMEOUT ALCANÇADO: Ação Automática pelo Host
        
        // 1. Identificar heróis disponíveis
        const allHeroesIds = [
          'bull', 'bebop', 'astro', 'haze', 'inferno', 'drifter', 'kelvin', 'lash', 
          'doorman', 'mirage', 'digger', 'chrono', 'engineer', 'bookworm', 'shiv', 
          'archer', 'viscous', 'warden', 'wraith', 'yamato', 'familiar', 'fencer', 
          'frank', 'gigawatt', 'hornet', 'kali', 'magician', 'nano', 'necro', 'priest'
        ];
        
        const banned = state.bannedHeroes || [];
        const picked = [...state.amberTeam, ...state.sapphireTeam]
          .filter(p => p.hero)
          .map(p => p.hero as string);
          
        const unavailable = [...banned, ...picked];
        const available = allHeroesIds.filter(h => !unavailable.includes(h));
        
        if (available.length > 0) {
          const randomHero = available[Math.floor(Math.random() * available.length)];
          
          if (state.phase === 'ban') {
            console.log(`[TIMEOUT] Banindo automaticamente: ${randomHero}`);
            sendMessage({ type: 'BAN_HERO', heroId: randomHero, steamId: state.currentTurnPlayerId || state.hostSteamId });
          } 
          else if (state.phase === 'pick') {
            const teamSide = state.currentTurnTeam as 'amber' | 'sapphire';
            const team = teamSide === 'amber' ? state.amberTeam : state.sapphireTeam;
            
            // Acha o próximo jogador que deve pickar
            let targetPlayer = team.find(p => !p.locked);
            
            if (targetPlayer) {
              console.log(`[TIMEOUT] Pickando automaticamente para ${targetPlayer.name}: ${randomHero}`);
              sendMessage({ 
                type: 'LOCK_HERO', 
                heroId: randomHero, 
                team: teamSide, 
                steamId: targetPlayer.steamId 
              });
            }
          }
        }
        
        // Bloqueia temporariamente para evitar flood
        state.timeRemaining = -1;
        hostStateRef.current = state;
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isHost, isConnected, draftState.phase]);

  return (
    <DraftContext.Provider value={{ draftState, isConnected, isHost, isGameServerRunning, tunnelAddress, tunnelError, serverLogs, user, connectToRoom, sendMessage, disconnect, startHostServer, updateMatchConfig, setDraftState, setIsConnected, setIsGameServerRunning, addCommandLog, sendWorldMessage, clearLogs }}>
      {children}
    </DraftContext.Provider>
  );
};

export const useDraft = () => {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error('useDraft must be used within DraftProvider');
  return ctx;
};

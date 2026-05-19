# Planejamento: Sistema de Draft + Provedor com Login Steam
> Dominokas Client — Roadmap técnico detalhado  
> Versão 2.0 — 04/05/2026 (com autenticação Steam nativa)

---

## Arquitetura Geral

```
┌─────────────────────────────────────────────────────────┐
│                  LAUNCHER (Tauri/React)                  │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐  │
│  │  Provider   │   │  DraftScreen │   │  PlayerLobby │  │
│  │  Dashboard  │   │  (ban/pick)  │   │  (join code) │  │
│  └──────┬──────┘   └──────┬───────┘   └──────┬───────┘  │
└─────────┼─────────────────┼──────────────────┼──────────┘
          │                 │                  │
┌─────────▼─────────────────▼──────────────────▼──────────┐
│                 BACKEND RUST (src-tauri)                  │
│  ┌───────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │  steam.rs │  │provider  │  │ draft.rs │  │playit   │  │
│  │(SteamID)  │  │  .rs     │  │(WebSocket│  │  .rs    │  │
│  └───────────┘  └──────────┘  │ + estado)│  └─────────┘  │
│                               └──────────┘               │
└───────────────────────────┬──────────────────────────────┘
                            │  match_state.json
┌───────────────────────────▼──────────────────────────────┐
│              PLUGIN DEADWORKS (.NET DLL)                  │
│   Lê match_state.json → força times, heróis, espectadores │
└──────────────────────────────────────────────────────────┘
```

---

## Login Steam — Abordagem e Justificativa

### Por que `steamworks-rs` e não OpenID

O Steam já está instalado e logado na máquina de qualquer pessoa que vai jogar Deadlock. Usar o SDK nativo via `steamworks-rs` permite ler o SteamID do usuário **instantaneamente**, sem abrir browser, sem redirect, sem tela de login extra.

A alternativa (OpenID via browser) cria uma UX fragmentada desnecessária para um app desktop onde o Steam é garantido.

### Como funciona na prática

```
1. Launcher abre
2. Rust inicializa o Steamworks Client (requer Steam rodando)
3. Chama client.user().steam_id() → obtém SteamID64 imediatamente
4. Busca nome e avatar via Steam Web API (opcional, para exibir na UI)
5. Verifica se é Provedor autorizado
6. Renderiza a tela correta
```

Não há "tela de login" — o processo é transparente para o usuário.

---

## Fase 1 — Autenticação Steam Nativa

### Dependência

```toml
# Cargo.toml
[dependencies]
steamworks = "0.11"
```

> O `steamworks-rs` carrega `steam_api64.dll` dinamicamente. Essa DLL já está
> presente em qualquer máquina com Steam instalado (`C:\Program Files (x86)\Steam\`).
> No build de distribuição, copiar a DLL para junto do `.exe` como os jogos fazem.

### Arquivo: `src-tauri/src/steam.rs`

```rust
use steamworks::{Client, SteamId};

pub struct SteamSession {
    pub steam_id: SteamId,
    pub display_name: String,
    pub steam_id_64: u64,
}

/// Inicializa o Steamworks e lê o usuário logado.
/// Retorna erro se o Steam não estiver aberto.
pub fn init_steam_session() -> Result<SteamSession, String> {
    // app_id 0 = modo "overlay" sem AppID específico
    // Para produção, usar o AppID do Deadlock: 1422450
    let (client, single) = Client::init_app(1422450)
        .map_err(|e| format!("Steam não está aberto: {}", e))?;

    let user = client.user();
    let steam_id = user.steam_id();
    let display_name = client.friends().name();

    Ok(SteamSession {
        steam_id,
        display_name,
        steam_id_64: steam_id.raw(),
    })
}

/// Verifica se o SteamID atual pertence a um Provedor autorizado.
/// Os IDs autorizados ficam em `provider_ids.json` na pasta de config do app.
pub fn is_authorized_provider(session: &SteamSession, config_dir: &Path) -> bool {
    let ids_path = config_dir.join("provider_ids.json");
    
    if let Ok(content) = std::fs::read_to_string(&ids_path) {
        if let Ok(ids) = serde_json::from_str::<Vec<u64>>(&content) {
            return ids.contains(&session.steam_id_64);
        }
    }
    false
}
```

### Comando Tauri exposto ao frontend

```rust
// src-tauri/src/lib.rs

#[tauri::command]
fn get_steam_user() -> Result<SteamUserInfo, String> {
    let session = steam::init_steam_session()?;
    let config_dir = get_config_dir();
    
    Ok(SteamUserInfo {
        steam_id: session.steam_id_64.to_string(),
        display_name: session.display_name,
        is_provider: steam::is_authorized_provider(&session, &config_dir),
        avatar_url: fetch_avatar_url(session.steam_id_64), // via Steam Web API
    })
}
```

### Hook React: `src/hooks/useSteamUser.ts`

```typescript
interface SteamUser {
  steamId: string;
  displayName: string;
  isProvider: boolean;
  avatarUrl: string;
}

export function useSteamUser() {
  const [user, setUser] = useState<SteamUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<SteamUser>('get_steam_user')
      .then(setUser)
      .catch(err => setError(err as string))
      .finally(() => setLoading(false));
  }, []);

  return { user, loading, error };
}
```

### Tela de inicialização (`src/App.tsx`)

```tsx
function App() {
  const { user, loading, error } = useSteamUser();

  if (loading) return <SplashScreen message="Conectando ao Steam..." />;
  
  if (error) return (
    <ErrorScreen 
      message="O Steam precisa estar aberto para usar o Deadworks Launcher."
      detail={error}
    />
  );

  // Roteamento baseado no papel do usuário
  if (user?.isProvider) return <ProviderDashboard user={user} />;
  return <PlayerLobby user={user} />;
}
```

---

## Fase 2 — Avatar e Perfil Steam (opcional, melhora UX)

Para exibir o avatar e o nome do jogador na tela de Draft, usar a Steam Web API:

```rust
// src-tauri/src/steam.rs

pub async fn fetch_player_summary(steam_id: u64, api_key: &str) 
    -> Result<PlayerSummary, reqwest::Error> 
{
    let url = format!(
        "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/\
         ?key={}&steamids={}",
        api_key, steam_id
    );
    
    let resp: SteamApiResponse = reqwest::get(&url).await?.json().await?;
    Ok(resp.response.players[0].clone())
}

// Retorna: personaname (display name), avatarfull (URL do avatar)
```

> **Steam Web API Key:** gratuita em https://steamcommunity.com/dev/apikey
> Salvar em `%APPDATA%/deadworks-launcher/config.json`

---

## Fase 3 — Dashboard do Provedor

Visível apenas quando `user.isProvider == true`.

### `src/components/ProviderDashboard.tsx`

```
┌─────────────────────────────────────────────────────┐
│  [Avatar] Olá, PlayerName          ● Steam conectado│
├─────────────────────────────────────────────────────┤
│  ⚙️  CONFIGURAR PARTIDA                              │
│                                                     │
│  Jogadores por time:   [ 4 ] [ 5 ] [●6]             │
│  Espectadores:         [●0] [ 1 ] [ 2 ] [ 3 ]       │
│  Mapa:                 [ dl_midtown ▼ ]             │
│  Draft com banimentos: [ Sim ●] [ Não ]             │
│  Heróis duplicados:    [ Sim ] [ Não ●]             │
│                                                     │
│  [ 🚀 CRIAR PARTIDA ]                               │
├─────────────────────────────────────────────────────┤
│  Status do túnel: ○ Inativo                         │
└─────────────────────────────────────────────────────┘
```

Ao clicar "Criar Partida":

```
1. Inicia playit-agent.exe em background (playit.rs)
2. Aguarda túnel ativo → obtém endereço público (ex: abc123.playit.gg:27015)
3. Gera dois códigos vinculados — um para o Time Âmbar, um para o Time Safira
   ex: WOLF-7842 (Âmbar) e IRON-3301 (Safira)
4. Inicia deadworks.exe com as flags configuradas
5. Abre mini servidor HTTP (porta 27016) para validação de códigos
6. Abre servidor WebSocket (porta 27017) para o draft em tempo real
7. Exibe os dois códigos e aguarda jogadores
```

### Exibição do código

```
┌─────────────────────────────────────────────────────┐
│  ✅ Partida criada com sucesso!                      │
│                                                     │
│  ┌─ 🟡 Time Âmbar ──────────────────────────────┐  │
│  │  Código:  WOLF-7842          [📋 Copiar]      │  │
│  └───────────────────────────────────────────────┘  │
│  ┌─ 🔵 Time Safira ──────────────────────────────┐  │
│  │  Código:  IRON-3301          [📋 Copiar]      │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Mande cada código para o time correspondente.      │
│                                                     │
│  Aguardando...  ████░░░░░░░░  3 / 12 conectados    │
│                                                     │
│  ┌─ Time Âmbar ──────────────────────────────────┐  │
│  │  ✅ [Avatar] PlayerA    🟡 [Avatar] PlayerB   │  │
│  │  ⌛ Aguardando...       ⌛ Aguardando...       │  │
│  └───────────────────────────────────────────────┘  │
│  ┌─ Time Safira ─────────────────────────────────┐  │
│  │  ✅ [Avatar] PlayerC    ⌛ Aguardando...       │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  [ ▶ INICIAR DRAFT ]  (disponível quando sala cheia)│
└─────────────────────────────────────────────────────┘
```

---

## Fase 4 — Tela do Jogador (Join por Código)

### `src/components/PlayerLobby.tsx`

```
┌─────────────────────────────────────────────────────┐
│  [Avatar] Olá, PlayerName          ● Steam conectado│
├─────────────────────────────────────────────────────┤
│                                                     │
│         DOMINOKAS CLIENT                            │
│                                                     │
│  Insira o código da partida:                        │
│                                                     │
│  ┌─────────────────────────┐                        │
│  │  WOLF - 7842            │  [ ENTRAR ]           │
│  └─────────────────────────┘                        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Fluxo de validação

```rust
// src-tauri/src/connect.rs

#[tauri::command]
pub async fn join_by_code(code: String, player_steam_id: String) 
    -> Result<MatchConfig, String> 
{
    // Consulta a mini API do Provedor via Playit
    // O endereço do Provedor é descoberto via um serviço de relay simples
    // (ex: backend leve em Cloudflare Workers ou um endpoint fixo seu)
    let url = format!("https://relay.deadworks.net/api/match?code={}", code);
    
    let config: MatchConfig = reqwest::get(&url)
        .await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    
    // Verifica se o jogador está autorizado nessa partida
    // (todos são permitidos até a sala encher)
    Ok(config)
}
```

> **Nota:** Um endpoint fixo leve (`relay.deadworks.net`) serve como ponto de encontro
> entre o Provedor e os jogadores. O Provedor registra o código + endereço Playit;
> os jogadores consultam. É apenas troca de texto JSON — custo mínimo de infraestrutura.

---

## Fase 5 — Sistema de Draft em Tempo Real

### Estado compartilhado via WebSocket

O Launcher do Provedor abre um servidor WebSocket exposto pelo Playit.gg.
Cada jogador conecta ao WebSocket ao entrar na sala.

```rust
// src-tauri/src/draft.rs

#[derive(Serialize, Deserialize, Clone)]
pub struct DraftState {
    pub phase: DraftPhase,
    pub current_turn_steam_id: String,
    pub time_remaining: u8,            // segundos (ex: 30)
    pub team_amber: Vec<PlayerSlot>,
    pub team_sapphire: Vec<PlayerSlot>,
    pub spectators: Vec<SpectatorSlot>,
    pub banned_heroes: Vec<String>,
    pub picked_heroes: Vec<String>,
    pub turn_order: Vec<TurnEntry>,    // sequência pré-calculada
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PlayerSlot {
    pub steam_id: String,
    pub display_name: String,
    pub avatar_url: String,
    pub chosen_hero: Option<String>,
    pub is_locked: bool,              // confirmou a escolha
}

#[derive(Serialize, Deserialize, Clone)]
pub enum DraftPhase {
    WaitingPlayers,   // sala não está cheia
    BanPhase,         // fase de banimentos
    PickPhase,        // fase de escolhas
    Complete,         // todos escolheram
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TurnEntry {
    pub team: Team,   // Amber ou Sapphire
    pub action: TurnAction, // Ban ou Pick
}
```

### Mensagens WebSocket

```typescript
// Tipos de mensagens trocadas entre Launcher do Provedor e jogadores

// Jogador → Provedor
type ClientMessage =
  | { type: "SELECT_HERO"; heroName: string }
  | { type: "CONFIRM_PICK" }
  | { type: "CONFIRM_BAN" }
  | { type: "PING" }

// Provedor → Todos (broadcast)
type ServerMessage =
  | { type: "DRAFT_STATE_UPDATE"; state: DraftState }
  | { type: "TURN_CHANGED"; steamId: string; timeRemaining: number }
  | { type: "DRAFT_COMPLETE"; matchState: MatchState }
  | { type: "PLAYER_JOINED"; player: PlayerSlot }
  | { type: "TIMER_TICK"; timeRemaining: number }
```

### Interface de Draft

```
┌──────────────────────────────────────────────────────────────────┐
│  DRAFT — WOLF-7842                              ⏱ 00:23         │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ╔═══ TIME ÂMBAR ═══════════════════════════════════════════╗   │
│  ║  [Abrams]   [?????]   [?????]   [?????]   [?????]  [?]  ║   │
│  ║  PlayerA    PlayerB   PlayerC   PlayerD   PlayerE  ...  ║   │
│  ╚═════════════════════════════════════════════════════════╝   │
│                                                                  │
│  ┌─ BANIDOS ──────────────────────────────────────────────────┐  │
│  │  [Infernus ✗]  [Wraith ✗]  [  ?  ]  [  ?  ]  [  ?  ]    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ ESCOLHA SEU HERÓI ─────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  [Abrams] [Bebop] [Calico] [Dynamo] [Grey Talon] [Haze]   │ │
│  │  [Holliday] [Ivy] [Kelvin] [Lady Geist] [Lash] [McGinnis] │ │
│  │  [Mirage] [Mo & Krill] [Paradox] [Pocket] [Seven] [Shiv]  │ │
│  │  [Vindicta] [Viscous] [Warden] [Yamato]                   │ │
│  │                                                             │ │
│  │  Selecionado: [Kelvin]              [ ✅ CONFIRMAR ]       │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ╔═══ TIME SAFIRA ══════════════════════════════════════════╗   │
│  ║  [?????]   [?????]   [?????]   [?????]   [?????]  [?]  ║   │
│  ╚════════════════════════════════════════════════════════╝   │
│                                                                  │
│  → Vez de: PlayerA (TIME ÂMBAR) — escolhendo herói             │
└──────────────────────────────────────────────────────────────────┘
```

### Ordem de Ban/Pick

```
Modo com ban (6v6, 12 jogadores):
  BAN:  Â S S Â Â S S Â    (8 bans alternados)
  PICK: Â S S Â Â S S Â Â S S Â  (12 picks em serpentina)

Modo sem ban:
  PICK: Â S S Â Â S S Â Â S S Â

Timer por turno: 30 segundos (configurável pelo Provedor)
Timeout: herói aleatório dos disponíveis é escolhido automaticamente
```

---

## Fase 6 — Handoff para o Deadlock

Quando o draft terminar:

### 1. Serialização do `match_state.json`

```json
{
  "match_code": "WOLF-7842",
  "playit_address": "abc123.playit.gg:27015",
  "created_at": "2026-05-04T15:30:00Z",
  "config": {
    "players_per_team": 6,
    "spectators": 2,
    "map": "dl_midtown",
    "allow_duplicates": false
  },
  "team_amber": [
    {
      "steam_id": "76561198000000001",
      "display_name": "PlayerA",
      "chosen_hero": "Abrams"
    },
    {
      "steam_id": "76561198000000002", 
      "display_name": "PlayerB",
      "chosen_hero": "Kelvin"
    }
  ],
  "team_sapphire": [
    {
      "steam_id": "76561198000000007",
      "display_name": "PlayerG",
      "chosen_hero": "Haze"
    }
  ],
  "spectators": [
    { "steam_id": "76561198000000013" }
  ],
  "banned_heroes": ["Infernus", "Wraith"]
}
```

### 2. Conexão automática de todos os jogadores

```rust
// src-tauri/src/connect.rs

#[tauri::command]
pub fn launch_and_connect(playit_address: String) {
    // O Steam abre o Deadlock e tenta conectar ao endereço via Playit
    let steam_url = format!("steam://connect/{}", playit_address);
    open::that(&steam_url).expect("Não foi possível abrir o Steam");
}
```

O Launcher exibe uma tela de transição enquanto o Deadlock carrega:

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│          ⚡ Iniciando partida...                    │
│                                                     │
│  Conectando a: abc123.playit.gg:27015               │
│                                                     │
│  Time Âmbar:    Abrams  Kelvin  ...                 │
│  Time Safira:   Haze    Dynamo  ...                 │
│                                                     │
│  O Deadlock abrirá automaticamente.                 │
│  Você jogará com: Kelvin                            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Fase 7 — Plugin Deadworks (C# .NET)

O plugin roda dentro do servidor e aplica o draft automaticamente.

### `DraftPlugin/DraftPlugin.cs`

```csharp
using System.Text.Json;
using DeadworksManaged.Api;

public class DraftPlugin : DeadworksPluginBase
{
    private MatchState? _matchState;

    public override void OnStartupServer()
    {
        var path = Path.Combine(Server.GameDir, "cfg", "match_state.json");
        
        if (!File.Exists(path))
        {
            Console.WriteLine("[DraftPlugin] match_state.json não encontrado. Modo livre.");
            return;
        }

        _matchState = JsonSerializer.Deserialize<MatchState>(
            File.ReadAllText(path),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
        );

        ApplyServerConfig();
        Console.WriteLine($"[DraftPlugin] Partida {_matchState?.MatchCode} carregada.");
    }

    private void ApplyServerConfig()
    {
        if (_matchState?.Config == null) return;

        // Heróis duplicados
        ConVar.Find("citadel_allow_duplicate_heroes")
              ?.SetInt(_matchState.Config.AllowDuplicates ? 1 : 0);
        
        // Configurações padrão para partida personalizada
        ConVar.Find("citadel_trooper_spawn_enabled")?.SetInt(1);
        ConVar.Find("citadel_npc_spawn_enabled")?.SetInt(1);
    }

    public override HookResult OnClientFullConnect(ClientFullConnectEvent ev)
    {
        if (_matchState == null) return HookResult.Handled;

        var controller = Players.FromSlot(ev.Slot);
        if (controller == null) return HookResult.Handled;

        var steamId = controller.SteamId.ToString();

        // Procura o jogador nos times
        var amberPlayer = _matchState.TeamAmber
            .FirstOrDefault(p => p.SteamId == steamId);
        var sapphirePlayer = _matchState.TeamSapphire
            .FirstOrDefault(p => p.SteamId == steamId);
        var isSpectator = _matchState.Spectators
            .Any(s => s.SteamId == steamId);

        if (amberPlayer != null)
        {
            controller.ChangeTeam(2); // Time Âmbar
            ScheduleHeroAssignment(controller, amberPlayer.ChosenHero);
        }
        else if (sapphirePlayer != null)
        {
            controller.ChangeTeam(3); // Time Safira
            ScheduleHeroAssignment(controller, sapphirePlayer.ChosenHero);
        }
        else if (isSpectator)
        {
            // Espectador — não altera time, apenas permite entrada
            controller.PrintToConsole("[DraftPlugin] Você está como espectador.");
        }
        else
        {
            // Não está na lista — kick
            controller.PrintToConsole("[DraftPlugin] Você não está nessa partida.");
            // Implementar kick quando disponível na API
        }

        return HookResult.Handled;
    }

    private void ScheduleHeroAssignment(
        CCitadelPlayerController controller, 
        string? heroName)
    {
        if (heroName == null) return;

        // Delay de 0.5s para garantir que o pawn está inicializado
        Timers.Create(0.5f, () =>
        {
            if (Enum.TryParse<Heroes>(heroName, out var hero))
            {
                // Precaching precisa ter sido feito no OnPrecacheResources
                controller.SelectHero(hero);
            }
        });
    }

    // Pré-carrega todos os heróis possíveis para evitar erros em runtime
    public override void OnPrecacheResources()
    {
        foreach (Heroes hero in Enum.GetValues<Heroes>())
        {
            Precache.AddHero(hero);
        }
    }

    // Bloqueia troca de herói — o draft já definiu tudo
    public override HookResult OnClientConCommand(ClientConCommandEvent ev)
    {
        if (_matchState != null && ev.CommandName == "citadel_hero_pick")
        {
            ev.Controller?.PrintToConsole(
                "[DraftPlugin] Herói bloqueado. Foi definido no Draft."
            );
            return HookResult.Stop;
        }
        return HookResult.Handled;
    }
}

// Estruturas que espelham o match_state.json
public record MatchState(
    string MatchCode,
    string PlayitAddress,
    MatchConfig Config,
    List<PlayerEntry> TeamAmber,
    List<PlayerEntry> TeamSapphire,
    List<SpectatorEntry> Spectators,
    List<string> BannedHeroes
);

public record MatchConfig(
    int PlayersPerTeam,
    int Spectators,
    string Map,
    bool AllowDuplicates
);

public record PlayerEntry(string SteamId, string DisplayName, string? ChosenHero);
public record SpectatorEntry(string SteamId);
```

---

## Fase 8 — Integração Playit.gg

### `src-tauri/src/playit.rs`

```rust
use std::process::{Child, Command};
use std::path::PathBuf;

pub struct PlayitAgent {
    process: Option<Child>,
    pub tunnel_address: Option<String>,
}

impl PlayitAgent {
    /// Garante que o agente está instalado, baixa se necessário
    pub async fn ensure_installed(app_dir: &PathBuf) -> Result<PathBuf, String> {
        let agent_path = app_dir.join("playit-agent.exe");
        
        if !agent_path.exists() {
            println!("[Playit] Baixando agente...");
            download_playit_agent(&agent_path).await
                .map_err(|e| format!("Falha ao baixar Playit: {}", e))?;
        }
        
        Ok(agent_path)
    }

    /// Inicia o agente e aguarda o túnel TCP/UDP ficar ativo
    pub async fn start(
        &mut self, 
        app_dir: &PathBuf,
        game_port: u16
    ) -> Result<String, String> {
        let agent_path = Self::ensure_installed(app_dir).await?;
        let secret = load_playit_secret(app_dir)?;

        let child = Command::new(&agent_path)
            .args(["run", "--secret", &secret])
            .spawn()
            .map_err(|e| format!("Falha ao iniciar Playit: {}", e))?;

        self.process = Some(child);

        // Aguarda até 30 segundos para o túnel ficar ativo
        let address = self.wait_for_tunnel(game_port, 30).await?;
        self.tunnel_address = Some(address.clone());

        println!("[Playit] Túnel ativo: {}", address);
        Ok(address)
    }

    /// Polling na API local do agente até o túnel estar pronto
    async fn wait_for_tunnel(&self, port: u16, timeout_secs: u64) -> Result<String, String> {
        let deadline = std::time::Instant::now() 
            + std::time::Duration::from_secs(timeout_secs);
        
        loop {
            if std::time::Instant::now() > deadline {
                return Err("Timeout: túnel Playit não ficou ativo em 30s".to_string());
            }
            
            // A API local do agente expõe o status em http://localhost:5000/api/v1/tunnels
            if let Ok(addr) = query_local_playit_api(port).await {
                return Ok(addr);
            }
            
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.process.take() {
            let _ = child.kill();
            println!("[Playit] Agente encerrado.");
        }
    }
}

impl Drop for PlayitAgent {
    fn drop(&mut self) {
        self.stop();
    }
}
```

### Primeira configuração do Provedor (Playit Secret)

Na primeira execução como Provedor:

```
1. Launcher detecta que não há playit_secret.txt
2. Abre o browser em https://playit.gg/account/agents/new
3. Usuário gera o secret e cola no Launcher
4. Launcher salva em %APPDATA%/deadworks-launcher/playit_secret.txt
5. Nas próximas vezes: automático
```

---

## Fase 9 — Redesign Visual

### Identidade visual proposta

**Tema:** Cyber-tático escuro — como um painel de operações militares futuristas  
**Cores:** 
  - Background: `#0a0c10` (quase preto)
  - Primária Âmbar: `#e8a020` (cor do time Amber do Deadlock)
  - Primária Safira: `#3a8fd4` (cor do time Sapphire)
  - Texto: `#c8d4e0`
  - Destaque: `#ffffff`

**Fontes:**
  - Títulos/Código: `Rajdhani` ou `Barlow Condensed` (geométrica pesada)
  - Interface: `JetBrains Mono` (monospace clean — reforça o estilo técnico)

**Elementos:**
  - Bordas com glow sutil nas cores dos times
  - Fundo com textura de ruído leve
  - Avatares Steam com borda colorida pelo time
  - Animações de entrada dos heróis no draft

### Estrutura de rotas

```
App
├── /splash          → SplashScreen (inicializando Steam)
├── /error           → ErrorScreen (Steam fechado, etc.)
│
├── /provider        → ProviderDashboard (isProvider == true)
├── /provider/lobby  → ProviderLobby (aguardando jogadores)
│
├── /player          → PlayerLobby (isProvider == false)
├── /draft/:code     → DraftScreen (ambos veem a mesma tela)
└── /launching       → LaunchScreen (conectando ao Deadlock)
```

---

## Dependências Completas

### Rust (`Cargo.toml`)

```toml
[dependencies]
# Já existentes no projeto
tauri = { version = "2", features = ["shell-open"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Novas
steamworks = "0.11"           # Login Steam nativo + SteamID
tokio-tungstenite = "0.21"    # Servidor WebSocket para o draft
reqwest = { version = "0.11", features = ["json"] }  # HTTP (API Steam, Playit)
rand = "0.8"                  # Geração do código da partida
open = "5"                    # Já existe no projeto (steam:// links)
```

### React (`package.json`)

```json
{
  "reconnecting-websocket": "^4.4.0",
  "zustand": "^4.5.0"
}
```

> `zustand` para gerenciar o estado global do draft no frontend (substitui
> prop drilling excessivo entre DraftScreen → HeroCard → TeamPanel etc.)

### C# (`DraftPlugin.csproj`)

```xml
<!-- Apenas o SDK do Deadworks — sem dependências extras -->
<PackageReference Include="DeadworksManaged.Api" Version="*" />
```

---

## Ordem de Implementação

### Sprint 1 — Autenticação e Base (1-2 semanas)
- [ ] `steam.rs` — init Steamworks, leitura de SteamID e nome
- [ ] `provider.rs` — verificação de Provedor autorizado
- [ ] `App.tsx` — splash screen + roteamento por papel
- [ ] `playit.rs` — start/stop do agente, polling de status

### Sprint 2 — Dashboard do Provedor (1-2 semanas)
- [ ] `ProviderDashboard.tsx` — configuração da partida
- [ ] Geração de código da partida em Rust
- [ ] Mini API HTTP (validação de código pelos jogadores)
- [ ] `PlayerLobby.tsx` — entrada por código

### Sprint 3 — Sistema de Draft (2-3 semanas)
- [ ] `draft.rs` — estado completo + servidor WebSocket
- [ ] `DraftScreen.tsx` — interface ban/pick
- [ ] `HeroCard.tsx`, `TeamPanel.tsx`, `DraftTimer.tsx`
- [ ] Hook WebSocket com reconexão automática
- [ ] Lógica de timeout (herói aleatório se o tempo acabar)

### Sprint 4 — Handoff e Plugin (1-2 semanas)
- [ ] Serialização `match_state.json`
- [ ] `LaunchScreen.tsx` + conexão automática via `steam://connect/`
- [ ] `DraftPlugin.cs` — herói/time forçados pelo SteamID
- [ ] Testes ponta a ponta: Provedor → Draft → Deadlock iniciando

### Sprint 5 — Polimento (1 semana)
- [ ] Redesign visual completo
- [ ] Avatares Steam na tela de draft
- [ ] Animações de entrada/saída de heróis
- [ ] Tratamento de erros (Steam fechado, Playit offline, etc.)

---

## Pontos de Atenção

**`steamworks-rs` e AppID:** Inicializar com AppID `1422450` (Deadlock) requer que o jogo esteja na biblioteca do usuário. Se quiser funcionar independente de ownership, inicializar com AppID `0` (modo desenvolvimento) — mas perde alguns recursos do SDK.

**Playit Secret:** É gerado uma vez e reutilizado. Se o Provedor reinstalar o app, precisará gerar um novo. Documentar isso claramente na UI.

**SteamID no Plugin:** O campo de SteamID no `CCitadelPlayerController` precisa ser confirmado na API do Deadworks — verificar se é acessível via `controller.SteamId` ou se precisa de `SchemaAccessor`.

**Múltiplos Provedores simultâneos:** Fora do escopo desta versão. O relay de códigos precisaria de um banco de dados para suportar isso.

---

## Referências

- [steamworks-rs docs.rs](https://docs.rs/steamworks) — SteamID, nome do usuário
- [Deadworks Players API](https://docs.deadworks.net/api-reference/players) — `SelectHero`, `ChangeTeam`
- [Deadworks Team & Hero Guide](https://docs.deadworks.net/guides/team-and-hero-management)
- [Deadworks Server Hosting](https://docs.deadworks.net/guides/server-hosting)
- [Playit.gg — Your Computer](https://playit.gg)
- [tauri-plugin-oauth](https://github.com/FabianLars/tauri-plugin-oauth) — referência para fluxo OAuth em Tauri (não usado, mas útil se migrar para OpenID)
- [Steam Web API — GetPlayerSummaries](https://developer.valvesoftware.com/wiki/Steam_Web_API#GetPlayerSummaries_.28v0002.29)

---

*Planejamento v2.0 — 04/05/2026 — Dominokas Client*

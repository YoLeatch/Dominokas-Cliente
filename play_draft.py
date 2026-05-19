import asyncio
import websockets
import json
import requests
import random
import sys

# Lista de heróis extraída do projeto
HERO_IDS = [
    'bull', 'bebop', 'astro', 'haze', 'inferno', 'drifter', 'kelvin', 'lash', 
    'doorman', 'mirage', 'digger', 'chrono', 'engineer', 'bookworm', 'shiv', 
    'archer', 'viscous', 'warden', 'wraith', 'yamato', 'familiar', 'fencer', 
    'frank', 'gigawatt', 'hornet', 'kali', 'magician', 'nano', 'necro', 'priest'
]

def lookup_code(code):
    url = f"http://dominokas-list.playit.plus/lookup/{code}"
    print(f"[*] Consultando Relay Server para o código: {code}...")
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            return response.json().get("ip")
    except Exception as e:
        print(f"[!] Erro ao consultar Relay: {e}")
    return None

class DraftBot:
    def __init__(self, code):
        self.code = code
        self.steam_id = "PYTHON_BOT_99"
        self.name = "Dominokas-Bot 🤖"
        self.team = "sapphire"
        self.state = None

    async def start(self, ip):
        uri = f"ws://{ip}"
        print(f"[*] Bot conectando em {uri}...")
        
        async with websockets.connect(uri) as websocket:
            # 1. Envia JOIN_ROOM
            join_msg = {
                "type": "JOIN_ROOM",
                "requestedRole": self.team,
                "player": {
                    "steamId": self.steam_id,
                    "name": self.name,
                    "hero": None,
                    "locked": False,
                    "isHost": False
                }
            }
            await websocket.send(json.dumps(join_msg))
            print(f"[OK] Bot entrou na sala como {self.team.upper()}.")

            # 2. Loop de escuta de estado
            async for message in websocket:
                msg = json.loads(message)
                
                if msg.get("type") == "STATE_UPDATE":
                    self.state = msg.get("state")
                    await self.handle_turn(websocket)
                
                elif msg.get("type") == "WORLD_MESSAGE":
                    print(f"[CHAT] {msg.get('text')}")

    async def handle_turn(self, ws):
        phase = self.state.get("phase")
        current_team = self.state.get("currentTurnTeam")
        
        if phase == 'complete':
            print("[DRAFT] Finalizado! Bot saindo...")
            sys.exit(0)

        if current_team != self.team:
            return # Não é minha vez

        # Lista heróis já usados (bans + picks)
        banned = self.state.get("bannedHeroes", [])
        picked = []
        for p in self.state.get("amberTeam", []) + self.state.get("sapphireTeam", []):
            if p.get("hero"): picked.append(p.get("hero"))
        
        unavailable = set(banned + picked)
        available = [h for h in HERO_IDS if h not in unavailable]

        if not available: return

        chosen = random.choice(available)

        if phase == 'ban':
            print(f"[BOT] Minha vez de BANIR! Banindo: {chosen}")
            await ws.send(json.dumps({
                "type": "BAN_HERO",
                "heroId": chosen,
                "team": self.team,
                "steamId": self.steam_id
            }))
        
        elif phase == 'pick':
            # Verifica se EU sou o próximo a pickar no meu time
            my_slot = next((p for p in self.state.get("sapphireTeam", []) if p.get("steamId") == self.steam_id), None)
            
            if my_slot and not my_slot.get("locked"):
                print(f"[BOT] Minha vez de ESCOLHER! Selecionando: {chosen}")
                await ws.send(json.dumps({
                    "type": "LOCK_HERO",
                    "heroId": chosen,
                    "team": self.team,
                    "steamId": self.steam_id
                }))

async def main():
    code = "SAPH-7M4B6" # Código padrão se não for passado
    if len(sys.argv) > 1:
        code = sys.argv[1]
    
    ip = lookup_code(code)
    if not ip:
        print("[!] Código inválido ou offline.")
        return

    bot = DraftBot(code)
    try:
        await bot.start(ip)
    except KeyboardInterrupt:
        print("\n[!] Bot encerrado manualmente.")
    except Exception as e:
        print(f"[!] Erro no Bot: {e}")

if __name__ == "__main__":
    asyncio.run(main())

import asyncio
import websockets
import json
import requests
import sys

def lookup_code(code):
    url = f"http://dominokas-list.playit.plus/lookup/{code}"
    print(f"[*] Consultando Relay Server para o código: {code}...")
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            return data.get("ip")
        else:
            print(f"[!] Erro no Relay: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"[!] Falha ao consultar Relay: {e}")
        return None

async def test_websocket(ip, code):
    uri = f"ws://{ip}"
    print(f"[*] Tentando conectar ao WebSocket: {uri}...")
    
    try:
        # Tenta conectar com timeout de 10 segundos
        async with websockets.connect(uri, open_timeout=10) as websocket:
            print("[OK] Conexão estabelecida com sucesso!")
            
            # Envia uma mensagem de teste (Join Room simulado)
            payload = {
                "type": "JOIN_ROOM",
                "requestedRole": "sapphire",
                "player": {
                    "steamId": "0",
                    "name": "Python-Debugger",
                    "hero": None,
                    "locked": False,
                    "isHost": False
                }
            }
            
            print("[*] Enviando payload de teste...")
            await websocket.send(json.dumps(payload))
            
            # Aguarda uma resposta por 5 segundos
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                print(f"[OK] Resposta recebida do servidor: {response[:200]}...")
                print("\n>>> RESULTADO: O TÚNEL E O SERVIDOR ESTÃO OPERACIONAIS! <<<")
            except asyncio.TimeoutError:
                print("[!] Servidor conectado, mas não enviou resposta ao JOIN_ROOM (comum se o draft não iniciou).")
                print("\n>>> RESULTADO: CONEXÃO BÁSICA OK! <<<")
                
    except Exception as e:
        print(f"[!] Erro na conexão WebSocket: {e}")
        print("\n>>> RESULTADO: FALHA NA CONEXÃO. <<<")

def main():
    code = "SAPH-7M4B6"
    if len(sys.argv) > 1:
        code = sys.argv[1].upper()
        
    ip = lookup_code(code)
    
    if not ip:
        print(f"[!] Não foi possível encontrar o IP para o código {code}.")
        return

    print(f"[OK] IP resolvido: {ip}")
    asyncio.run(test_websocket(ip, code))

if __name__ == "__main__":
    main()

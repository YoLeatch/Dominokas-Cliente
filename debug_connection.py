import asyncio
import websockets
import json
import sys

async def test_connection(uri):
    print(f"--- Iniciando Teste de Conexao Dominokas ---")
    print(f"Alvo: {uri}")
    
    try:
        # Forma correta de conectar com timeout no websockets moderno
        websocket = await asyncio.wait_for(websockets.connect(uri), timeout=5)
        
        try:
            print("[OK] SUCESSO: Conexao estabelecida com o servidor!")
            
            # Tenta enviar um ping de teste
            test_msg = {"type": "PING", "message": "Teste de diagnostico"}
            await websocket.send(json.dumps(test_msg))
            print("[OK] SUCESSO: Mensagem enviada para o servidor!")
            
            print("\nResultado: O seu tunel Playit esta FUNCIONANDO para trafego TCP.")
            print("Se o seu Launcher nao entra, o problema e o seu roteador bloqueando voce mesmo (NAT Loopback).")
            
        finally:
            await websocket.close()
            
    except asyncio.TimeoutError:
        print("\n[ERRO] FALHA: A conexao excedeu o tempo limite (Timeout).")
        print("O Playit nao conseguiu chegar no seu PC. Verifique se o Playit esta rodando e se a porta e 27025.")
    except Exception as e:
        print(f"\n[ERRO] FALHA: Erro de conexao.")
        print(f"Detalhes: {e}")
        print("\nCertifique-se de que o Launcher esta na tela de Lobby ou Match Config.")

if __name__ == "__main__":
    target_ip = "198.22.204.24:1191"
    if len(sys.argv) > 1:
        target_ip = sys.argv[1]
    asyncio.run(test_connection(f"ws://{target_ip}"))

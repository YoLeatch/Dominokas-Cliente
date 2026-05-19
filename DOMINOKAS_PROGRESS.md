# Dominokas Project - Status & Knowledge Base

Este documento consolida todo o conhecimento técnico, mudanças de arquitetura e funcionalidades implementadas no projeto **Dominokas** (anteriormente Deadworks).

## 1. Identidade e Rebranding
O projeto passou por um processo completo de rebranding para se tornar **Dominokas**.
- **Nome Técnico**: `dominokas-client` (Rust) e `dominokas-frontend` (React).
- **Protocolo de Deep Link**: Alterado de `deadworks://` para `dominokas://`.
- **Versionamento**: O projeto foi resetado para a versão estável **0.1.0**.
- **Pastas no Jogo**: Addons e cache são agora gerenciados em `citadel/dominokas_addons` e `citadel/dominokas_cache`.

## 2. Segurança e Interface (UI/UX)
Para garantir uma experiência de "aplicativo nativo" e proteger a integridade do launcher:
- **Clique Direito**: Desabilitado globalmente para impedir o menu de contexto padrão.
- **Bloqueio de Inspeção**: Atalhos como `F12`, `Ctrl+Shift+I` e `Ctrl+Shift+J` foram bloqueados.
- **Prevenção de Recarregamento**: `F5` e `Ctrl+R` foram desabilitados para evitar perda de estado durante o draft.
- **Botões de Ação**: O botão "INICIALIZAR PARTIDA" possui estilização assimétrica personalizada e só aparece para o Host.

## 3. Infraestrutura de Partidas (Draft System)
O sistema de draft foi robustecido para evitar duplicatas e garantir autoridade do Host:
- **Identificação por SteamID**: O Host é identificado pelo seu SteamID real (`hostSteamId`), tornando a autoridade da sala imune a reloads de página.
- **Persistência de Sessão**: O `sessionStorage` é usado para manter o IP da sala e o papel do jogador (Amber/Sapphire/Spectator) caso o usuário feche ou recarregue o cliente.
- **Limpeza de Duplicatas**: Ao entrar em uma sala, o sistema remove automaticamente qualquer rastro anterior do mesmo SteamID em outros times, evitando o bug de "jogador fantasma".

## 4. Persistência e Backend (Rust)
A integração entre o Frontend (React) e o Backend (Tauri/Rust) foi aprimorada:
- **Configurações Persistentes**: O diretório do jogo selecionado pelo usuário é salvo em um arquivo físico `settings.json` via `tauri-plugin-store`.
- **Auto-carregamento**: Ao iniciar, o Launcher lê automaticamente o diretório configurado, eliminando a necessidade de reconfiguração manual.
- **Patch de Gameinfo**: O backend Rust aplica automaticamente o `addonroot` no arquivo `gameinfo.gi` do Deadlock para permitir o carregamento de conteúdos customizados.

## 5. Guia de Desenvolvimento
- **Frontend**: React + Vite + Tailwind CSS.
- **Backend**: Rust + Tauri v2.
- **Comunicação**: WebSocket para estados de partida e Tauri Invokes para operações de sistema (IO/Registry).
- **Estilos**: Centralizados em `src/styles/DraftShared.css`.

---
*Última atualização: 08 de Maio de 2026*

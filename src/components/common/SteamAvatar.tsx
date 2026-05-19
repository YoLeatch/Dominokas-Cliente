import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  steamId: string;
  className?: string;
  style?: React.CSSProperties;
}

// Cache local simples para evitar múltiplas chamadas à API da Steam para o mesmo usuário na mesma sessão
const avatarCache: Record<string, string> = {};

export const SteamAvatar: React.FC<Props> = ({ steamId, className, style }) => {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(avatarCache[steamId] || null);

  useEffect(() => {
    if (!steamId || avatarCache[steamId]) {
      if (avatarCache[steamId]) setAvatarUrl(avatarCache[steamId]);
      return;
    }

    const fetchAvatar = async () => {
      try {
        const url: string = await invoke('get_steam_avatar', { steamId });
        if (url) {
          avatarCache[steamId] = url;
          setAvatarUrl(url);
        }
      } catch (err) {
        console.error('Erro ao carregar avatar da Steam', err);
      }
    };

    fetchAvatar();
  }, [steamId]);

  if (!avatarUrl) {
    return <div className={`steam-avatar-placeholder ${className || ''}`} style={{ ...style, backgroundColor: '#1a2235' }} />;
  }

  return (
    <img 
      src={avatarUrl} 
      alt={`Avatar`} 
      className={`steam-avatar-img ${className || ''}`} 
      style={{ ...style, objectFit: 'cover' }} 
    />
  );
};

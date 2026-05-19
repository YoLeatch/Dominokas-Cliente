import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface SteamUser {
  steam_id: string;
  name: string;
}

export const useSteamUser = () => {
  const [user, setUser] = useState<SteamUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        setLoading(true);
        const steamUser: SteamUser = await invoke('get_steam_user');
        setUser(steamUser);
        setError(null);
      } catch (err) {
        console.error('Erro ao buscar usuário Steam:', err);
        setError(String(err));
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, []);

  return { user, loading, error };
};

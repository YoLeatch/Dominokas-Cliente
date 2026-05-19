import React, { useState, useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import '../../styles/UpdateModal.css';

export const UpdateModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState('0.1.0');
  const [updateInfo, setUpdateInfo] = useState<{
    newVersion: string;
    notes?: string;
  } | null>(null);
  
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0); // 0 to 100
  const [bytesDownloaded, setBytesDownloaded] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [statusText, setStatusText] = useState('Baixando atualização...');
  const [updateHandler, setUpdateHandler] = useState<any>(null);

  // Carrega a versão atual do app via Tauri API
  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(console.error);
  }, []);

  // Função para executar a verificação
  const performCheck = async (isManual = false) => {
    try {
      console.log('[Updater] Buscando atualizações...');
      const update = await check();
      
      if (update) {
        console.log(`[Updater] Nova atualização encontrada: ${update.version}`);
        setUpdateHandler(update);
        setUpdateInfo({
          newVersion: update.version,
          notes: update.body || 'Nenhuma nota de versão fornecida.'
        });
        setIsOpen(true);
      } else {
        console.log('[Updater] Nenhuma atualização disponível.');
        if (isManual) {
          window.dispatchEvent(new CustomEvent('manual-update-status', { detail: 'up-to-date' }));
        }
      }
    } catch (err) {
      console.error('[Updater] Erro ao verificar atualizações:', err);
      if (isManual) {
        window.dispatchEvent(new CustomEvent('manual-update-status', { detail: `error: ${err}` }));
      }
    }
  };

  useEffect(() => {
    // Check automático ao montar (com delay leve para não interferir na animação de boot)
    const timeout = setTimeout(() => {
      performCheck(false);
    }, 1500);

    // Escutar por checagem manual de configurações
    const handleManualCheck = () => {
      performCheck(true);
    };

    window.addEventListener('trigger-manual-update-check', handleManualCheck);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('trigger-manual-update-check', handleManualCheck);
    };
  }, []);

  const handleUpdate = async () => {
    if (!updateHandler) return;

    try {
      setDownloading(true);
      setProgress(0);
      setBytesDownloaded(0);
      setTotalBytes(0);
      setStatusText('Iniciando download...');

      let downloaded = 0;
      let total = 0;

      await updateHandler.downloadAndInstall((event: any) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength || 0;
            setTotalBytes(total);
            setStatusText('Baixando...');
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            setBytesDownloaded(downloaded);
            if (total > 0) {
              const percent = Math.round((downloaded / total) * 100);
              setProgress(percent);
            }
            break;
          case 'Finished':
            setProgress(100);
            setStatusText('Extraindo e instalando...');
            break;
        }
      });

      setStatusText('Reiniciando aplicativo...');
      // Reinicia o app automaticamente para aplicar a atualização
      setTimeout(async () => {
        await relaunch();
      }, 1000);

    } catch (err) {
      console.error('[Updater] Falha ao atualizar:', err);
      alert('Falha ao baixar/instalar atualização: ' + err);
      setDownloading(false);
    }
  };

  const handleClose = () => {
    if (downloading) return; // Não permite fechar no meio do download
    setIsOpen(false);
  };

  const formatMB = (bytes: number) => {
    if (bytes <= 0) return '0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!isOpen || !updateInfo) return null;

  return (
    <div className="update-modal-overlay">
      <div className="update-modal-card">
        <div className="update-modal-header">
          <span className="update-icon-glow">🚀</span>
          <div className="update-modal-title">Nova atualização <span>disponível!</span></div>
          <div className="update-version-row">
            <span className="update-version-tag">v{currentVersion}</span>
            <span className="update-version-arrow">➔</span>
            <span className="update-version-tag new">v{updateInfo.newVersion}</span>
          </div>
        </div>

        {!downloading ? (
          <>
            <div className="update-changelog-container">
              <span className="update-changelog-label">O que há de novo:</span>
              <div className="update-changelog-box">
                {updateInfo.notes}
              </div>
            </div>

            <div className="update-button-group">
              <button className="update-btn-primary" onClick={handleUpdate}>
                ATUALIZAR AGORA
              </button>
              <button className="update-btn-secondary" onClick={handleClose}>
                DEPOIS
              </button>
            </div>
          </>
        ) : (
          <div className="update-progress-container">
            <div className="update-progress-info">
              <span className="update-progress-status">{statusText}</span>
              <span className="update-progress-percentage">{progress}%</span>
            </div>
            <div className="update-progress-bar">
              <div className="update-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            {totalBytes > 0 && (
              <div className="update-progress-bytes">
                {formatMB(bytesDownloaded)} / {formatMB(totalBytes)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default UpdateModal;

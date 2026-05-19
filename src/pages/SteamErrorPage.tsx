import React from 'react';
import { HeaderLogo } from '../components/common/HeaderLogo';
import '../styles/SteamError.css';

interface Props {
  errorMessage?: string | null;
}

const SteamErrorPage: React.FC<Props> = ({ errorMessage }) => {
  return (
    <div className="screen" style={{ gap: '3vh' }}>
      <HeaderLogo />
      <div className="error-card">
        <span className="error-icon">🚫</span>
        <span className="error-title">Steam não encontrado</span>
        <span className="error-message">
          O Steam precisa estar aberto para usar o Dominokas Launcher.
        </span>
        <div className="error-detail">
          <span className="error-detail-text">
            Erro: {errorMessage || 'SteamAPI_Init failed — Steam client not running'}
          </span>
        </div>
        <div className="divider" />
        <div className="help-section">
          <span className="help-title">Como resolver:</span>
          <div className="help-step">
            <div className="step-number">1</div>
            <span className="step-text">Abra o Steam</span>
          </div>
          <div className="help-step">
            <div className="step-number">2</div>
            <span className="step-text">Faça login na sua conta</span>
          </div>
          <div className="help-step">
            <div className="step-number">3</div>
            <span className="step-text">Clique em "Tentar novamente"</span>
          </div>
        </div>
        <button className="btn-retry" onClick={() => window.location.reload()}>
          <span>TENTAR NOVAMENTE</span>
        </button>
      </div>
    </div>
  );
};

export default SteamErrorPage;

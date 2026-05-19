import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { X, Minus, Square } from 'lucide-react';
import './TitleBar.css';

const appWindow = getCurrentWindow();

export const TitleBar: React.FC = () => {
  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-logo" data-tauri-drag-region>
        <img src="/icon.png" alt="logo" className="titlebar-icon" />
        <span>DOMINOKAS CLIENT</span>
      </div>
      
      <div className="titlebar-controls">
        <button className="titlebar-button" onClick={handleMinimize}>
          <Minus size={14} />
        </button>
        <button className="titlebar-button" onClick={handleMaximize}>
          <Square size={12} />
        </button>
        <button className="titlebar-button close" onClick={handleClose}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

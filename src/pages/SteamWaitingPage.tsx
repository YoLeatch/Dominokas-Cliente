// import Icon from '../assets/icon/Icon.png';
import '../styles/SteamWaiting.css';

const SteamWaitingPage: React.FC = () => {
  return (
    <div className="screen steam-waiting-screen">
      <div className="logo-wrap">
        <div style={{ width: '100px', height: '100px', background: 'rgba(255,255,255,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px', marginBottom: '20px' }}>D</div>
      </div>
      <span className="match-label">Conectando ao Steam...</span>
    </div>
  );
};

export default SteamWaitingPage;

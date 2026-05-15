import './RadarVisual.css';

export default function RadarVisual() {
  return (
    <div className="radar-visual">
      <div className="radar-visual__container">
        {/* Outer ring */}
        <div className="radar-visual__ring radar-visual__ring--outer" />
        {/* Middle ring */}
        <div className="radar-visual__ring radar-visual__ring--middle" />
        {/* Inner ring */}
        <div className="radar-visual__ring radar-visual__ring--inner" />
        {/* Sweep line */}
        <div className="radar-visual__sweep" />
        {/* Center dot */}
        <div className="radar-visual__center" />
        {/* Blips */}
        <div className="radar-visual__blip" style={{ top: '22%', left: '65%', animationDelay: '0s' }} />
        <div className="radar-visual__blip" style={{ top: '38%', left: '28%', animationDelay: '0.5s' }} />
        <div className="radar-visual__blip" style={{ top: '60%', left: '72%', animationDelay: '1s' }} />
        <div className="radar-visual__blip" style={{ top: '75%', left: '40%', animationDelay: '1.5s' }} />
        <div className="radar-visual__blip radar-visual__blip--strong" style={{ top: '30%', left: '45%', animationDelay: '0.3s' }} />
      </div>
      <div className="radar-visual__label">
        <span className="radar-visual__label-status">● ESCANEANDO</span>
        <span className="radar-visual__label-text">11 fuentes activas</span>
      </div>
    </div>
  );
}

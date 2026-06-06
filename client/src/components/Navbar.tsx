import React, { useState } from 'react';

const Navbar = () => {
  const [activeTab, setActiveTab] = useState('map');
  return (
    <nav className='navbar'>
      <div className='tab-container'>
        <button className={`tab ${activeTab === 'map' ? 'active' : ''}`} onClick={() => setActiveTab('map')}>Mapa</button>
        <button className={`tab ${activeTab === 'convocatorias' ? 'active' : ''}`} onClick={() => setActiveTab('convocatorias')}>Convocatorias</button>
        <button className={`tab ${activeTab === 'inteligencia' ? 'active' : ''}`} onClick={() => setActiveTab('inteligencia')}>Inteligencia</button>
      </div>
    </nav>
  );
};
export default Navbar;
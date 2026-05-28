import React from 'react';

const Navbar = () => {
  return (
    <nav className='navbar'>
      <div className='tab-container'>
        <button className='tab' onClick={() => setActiveTab('map')}>Mapa</button>
        <button className='tab' onClick={() => setActiveTab('convocatorias')}>Convocatorias</button>
        <button className='tab' onClick={() => setActiveTab('inteligencia')}>Inteligencia</button>
      </div>
    </nav>
  );
};
export default Navbar;
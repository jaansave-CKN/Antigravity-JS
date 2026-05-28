import React from 'react';

import Header from './Header';
import Sidebar from './Sidebar';

const DashboardLayout = ({ children }) => {
  return (
    <div className='dashboard-layout'>
      <Header />
      <Sidebar />
      <main className='dashboard-content'>
        <div style='width: 60%'>
          {children.map((child, index) => (
            <div key={index} style='flex: 1;'>
              {child}
            </div>
          ))}
        </div>
        <div style='width: 40%'>
          {/* Placeholder for TablePanel or stats panels */}
          <div>Data Panels Will Go Here</div>
        </div>
      </main>
    </div>
  );
};
export default DashboardLayout;
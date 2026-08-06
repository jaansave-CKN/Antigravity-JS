import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Layout() {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0b1326' }}>
      <Sidebar />
      <main style={{ flex: 1, overflowY: 'auto', background: '#0b1326' }}>
        <Outlet />
      </main>
    </div>
  );
}

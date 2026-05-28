import { getRows } from './db.js';
(async () => {
  try {
    const users = await getRows('SELECT email, tipoUsuario, nombre FROM usuarios');
    console.log(JSON.stringify(users, null, 2));
  } catch (e) {
    console.error(e);
  }
})();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Asegura la conexión con Render
});

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insertar Accionistas
    const shareholders = [
      { name: 'Asfáltica S.A.S.', percentage: 50, role: null },
      { name: 'Jairo Antonio Salinas Velasco', percentage: 5, role: 'DISEÑADOR' },
      { name: 'Miguel Angel Rey', percentage: 45, role: null }
    ];
    for (const s of shareholders) {
      await client.query(
        'INSERT INTO shareholders (name, percentage, role) VALUES ($1, $2, $3)',
        [s.name, s.percentage, s.role]
      );
    }

    // Insertar Proyectos
    const projects = [
      { name: 'Baterías Sanitarias Modulares Rurales' },
      { name: 'Aulas Modulares' }
    ];
    const projectIds = [];
    for (const p of projects) {
      const res = await client.query(
        'INSERT INTO projects (name) VALUES ($1) RETURNING id',
        [p.name]
      );
      projectIds.push(res.rows[0].id);
    }

    // Insertar Especificaciones
    const specification = 'Diseño con vuelo estructural (cero columnas en pasillos), uso exclusivo de concreto híbrido aligerado con fibra GFRC/GRC';
    for (const projectId of projectIds) {
      await client.query(
        'INSERT INTO project_specifications (project_id, specification) VALUES ($1, $2)',
        [projectId, specification]
      );
    }

    // Insertar Alerta del Sistema
    await client.query(
      'INSERT INTO system_alerts (message) VALUES ($1)',
      ['Prohibido el uso de materiales reciclados bajo cualquier motivo']
    );

    await client.query('COMMIT');
    console.log('Seeding completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error seeding database:', err);
  } finally {
    client.release();
  }
}

seed();

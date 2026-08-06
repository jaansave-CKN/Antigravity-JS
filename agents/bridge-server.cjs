const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const net = require('net');

const PUERTO = 3001;

function verificarPuerto(puerto) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close();
            resolve(true);
        });
        server.listen(puerto);
    });
}

async function iniciarServidor() {
    const libre = await verificarPuerto(PUERTO);
    
    if (!libre) {
        console.warn(`⚠️ Puerto ${PUERTO} en uso. Cerrando proceso anterior...`);
        const { execSync } = require('child_process');
        try {
            execSync(`taskkill /F /IM node.exe /FI "WINDOWTITLE eq *${PUERTO}*"`, { stdio: 'ignore' });
        } catch (e) {}
        await new Promise(r => setTimeout(r, 1000));
    }
    
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    app.get('/', (req, res) => {
        res.json({
            status: 'ANTIGRAVITY OS ACTIVO',
            version: '1.0',
            agente: '000_ORQUESTADOR',
            endpoints: {
                orquestar: 'POST /orquestar',
                estado: 'GET /estado',
                salud: 'GET /salud'
            }
        });
    });

    app.get('/estado', (req, res) => {
        res.json({ estado: 'OPERATIVO', agente: '000', timestamp: new Date().toISOString() });
    });

    app.get('/salud', (req, res) => {
        res.json({ healthy: true, uptime: process.uptime() });
    });

    app.post('/orquestar', (req, res) => {
        console.log('\n========================================');
        console.log('🔥 SOLICITUD RECIBIDA - ANTIGRAVITY OS');
        console.log('========================================');
        
        const { sector, ubicacion, problema, presupuesto, enfoque, formato } = req.body;
        
        const parametros = {
            sector: sector || 'General',
            ubicacion: ubicacion || 'N/A',
            problema: problema || 'Solicitud automática',
            presupuesto: presupuesto || '0',
            enfoque: enfoque || 'social',
            formato: formato || 'mga'
        };

        console.log('📋 Datos de Entrada:');
        console.log('   Sector:', parametros.sector);
        console.log('   Ubicación:', parametros.ubicacion);
        console.log('   Problema:', parametros.problema);
        console.log('   Presupuesto:', parametros.presupuesto);
        console.log('   Enfoque:', parametros.enfoque);
        console.log('   Formato:', parametros.formato);
        console.log('----------------------------------------');

        const comando = `node agents/000_Orquestador.cjs "${parametros.sector}" "${parametros.ubicacion}" "${parametros.problema}" "${parametros.presupuesto}" "${parametros.enfoque}" "${parametros.formato}"`;

        console.log('🚀 Ejecutando:', comando);

        exec(comando, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
            if (err) {
                console.error('❌ Error:', err.message);
                return res.status(500).json({ 
                    error: err.message,
                    status: 'ERROR_EN_ORQUESTACION'
                });
            }
            
            if (stderr) {
                console.warn('⚠️ Stderr:', stderr);
            }

            console.log('\n========================================');
            console.log('✅ RESPUESTA CERTIFICADA POR INTERVENTORÍA');
            console.log('========================================');
            console.log(stdout);
            console.log('========================================\n');

            res.json({ 
                status: 'SISTEMA_ORQUESTADO',
                certificado: '000_ORQUESTADOR + 057_INTERVENTOR',
                output: stdout,
                timestamp: new Date().toISOString()
            });
        });
    });

    app.listen(PUERTO, () => {
        console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   🔥 ANTIGRAVITY OS - PUERTO ${PUERTO} ACTIVO 🔥       ║
║                                                   ║
║   Endpoints:                                      ║
║   • POST /orquestar  - Ejecutar cadena de mando   ║
║   • GET  /estado     - Estado del sistema         ║
║   • GET  /salud      - Verificación de salud      ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
        `);
    });
}

iniciarServidor().catch(console.error);
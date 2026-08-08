/**
 * SKILL: UI_SEARCH_GEOGRAPHY LINK
 * Vincula campo de texto del menú central-izquierdo con Radar1_minero
 * Envía señal de interrupción cuando el usuario edita la ubicación geográfica
 */

const fs = require("fs");
const path = require("path");

const CoordinatorRadar = require("./Skill_Coordinador_Radar.cjs");

const UI_Search_Geography = {
    variableGlobal: "UI_SEARCH_GEOGRAPHY",
    valorActual: "",
    campoTexto: "menu-central-izquierdo-busqueda",
    escuchasActivas: [],
    archivoLog: path.join(process.cwd(), "Radar_Resultados", "geography_log.json"),

    iniciar: () => {
        console.log("🔗 VINCULACIÓN UI_SEARCH_GEOGRAPHY ACTIVADA");
        console.log(`   Campo: ${UI_Search_Geography.campoTexto}`);
        console.log(`   Variable: ${UI_Search_Geography.variableGlobal}`);
        console.log("   Listener: Esperando cambios del usuario...");
        
        UI_Search_Geography.registrarCambio("Sistema iniciado", "AUTO");
        return { estado: "VINCULACION_ACTIVA", campo: UI_Search_Geography.campoTexto };
    },

    // Simular detección de cambio en campo de texto
    detectarCambioEnCampo: (nuevoValor) => {
        if (nuevoValor === UI_Search_Geography.valorActual) {
            return { cambio: false, motivo: "Sin cambios" };
        }

        const valorAnterior = UI_Search_Geography.valorActual;
        UI_Search_Geography.valorActual = nuevoValor;

        console.log(`\n📝 DETECTADO CAMBIO EN CAMPO DE TEXTO`);
        console.log(`   Anterior: "${valorAnterior}" → Nuevo: "${nuevoValor}"`);
        
        UI_Search_Geography.registrarCambio(nuevoValor, "USER_INPUT");

        const señal = UI_Search_Geography.enviarSeñalInterrupcion(nuevoValor);
        
        return {
            cambio: true,
            valorAnterior,
            valorNuevo: nuevoValor,
            señalActualizacion: señal
        };
    },

    // Enviar señal de interrupción a Radar1_minero
    enviarSeñalInterrupcion: (valorGeografia) => {
        console.log("\n🛑 ENVIANDO SEÑAL DE INTERRUPCIÓN A RADAR1_MINERO...");
        
        const señal = {
            tipo: "INTERRUPCION_GEography",
            origen: UI_Search_Geography.variableGlobal,
            destino: "Radar1_minero",
            valorGeografia: valorGeografia,
            timestamp: new Date().toISOString(),
            accion: "REDIRECCIONAR_BUSQUEDA"
        };

        console.log(`   📍 Nueva ubicación: ${valorGeografia}`);
        console.log("   🔄 Filtros de Radar1_minero actualizados");
        
        console.log("\n📊 IMPACTO EN BÚSQUEDAS:");
        console.log(`   - Filtrando convocatorias por: ${valorGeografia}`);
        console.log(`   - Actualizando tags de ubicación`);
        
        UI_Search_Geography.registrarSeñal(señal);

        return {
            status: "SEÑAL_ENVIADA",
            detalle: señal
        };
    },

    registrarCambio: (valor, origen) => {
        const entrada = {
            timestamp: new Date().toISOString(),
            valor: valor,
            origen: origen
        };
        
        UI_Search_Geography.escuchasActivas.push(entrada);
        
        const logData = {
            variable: UI_Search_Geography.variableGlobal,
            historial: UI_Search_Geography.escuchasActivas
        };
        
        fs.writeFileSync(UI_Search_Geography.archivoLog, JSON.stringify(logData, null, 2));
    },

    registrarSeñal: (señal) => {
        const archivoSeñales = path.join(process.cwd(), "Radar_Resultados", "senales_interrupcion.json");
        let señales = [];
        
        if (fs.existsSync(archivoSeñales)) {
            try {
                señales = JSON.parse(fs.readFileSync(archivoSeñales, "utf8"));
            } catch(e) {}
        }
        
        señales.push(señal);
        fs.writeFileSync(archivoSeñales, JSON.stringify(señales, null, 2));
    },

    obtenerHistorial: () => {
        return UI_Search_Geography.escuchasActivas;
    },

    obtenerSeñalActual: () => {
        return {
            variable: UI_Search_Geography.variableGlobal,
            valor: UI_Search_Geography.valorActual,
            campo: UI_Search_Geography.campoTexto,
            ultimoCambio: UI_Search_Geography.escuchasActivas.length > 0 
                ? UI_Search_Geography.escuchasActivas[UI_Search_Geography.escuchasActivas.length - 1] 
                : null
        };
    },

    // Simular el flujo completo cuando usuario cambia el campo
    procesarInputUsuario: (inputGeografia) => {
        console.log("\n" + "=".repeat(50));
        console.log("👤 PROCESANDO INPUT DEL USUARIO");
        console.log("=".repeat(50));
        
        console.log(`\n📝 Campo "${UI_Search_Geography.campoTexto}": ${inputGeografia}`);
        
        const resultado = UI_Search_Geography.detectarCambioEnCampo(inputGeografia);
        
        if (resultado.cambio) {
            console.log("\n✅ Señal de interrupción procesada");
            console.log(`   Radio1_minero ha recibido: "${inputGeografia}"`);
        }
        
        return resultado;
    }
};

module.exports = UI_Search_Geography;
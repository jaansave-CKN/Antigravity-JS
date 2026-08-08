/**
 * SKILL: NOTAS_PERSONALES
 * Cruza anotaciones del usuario con datos de anexos
 * Convierte instrucciones directas en Reglas de Negocio para agentes
 */

const fs = require("fs");
const path = require("path");

const InstruccionesClave = {
    PRIORIZAR: {
        sinonimos: ["priorizar", "prioridad", "importante", "urgente", "primero", "enfocarse", "enfocar"],
        accion: "PRIORIZAR",
        comportamiento: "Aumentar peso/ranking de resultados relacionados"
    },
    IGNORAR: {
        sinonimos: ["ignorar", "descartar", "omitir", "no incluir", "excluir", "quitar", "eliminar"],
        accion: "IGNORAR",
        comportamiento: "Filtrar/excluir resultados que contengan esta palabra"
    },
    AJUSTAR_COSTO: {
        sinonimos: ["ajustar costo", "revisar presupuesto", "incrementar", "reducir", "calcular", "presupuesto"],
        accion: "AJUSTAR_COSTO",
        comportamiento: "Recalcular análisis financiero con nuevo parámetro"
    },
    REVISAR: {
        sinonimos: ["revisar", "verificar", "check", "analizar", "evaluar", "inspeccionar"],
        accion: "REVISAR",
        comportamiento: "Marcar para revisión manual antes de continuar"
    },
    NOTIFICAR: {
        sinonimos: ["notificar", "avisar", "alertar", "informar", "reportar"],
        accion: "NOTIFICAR",
        comportamiento: "Enviar notificación al usuario cuando se procese"
    },
    ESPERAR: {
        sinonimos: ["esperar", "pausar", "detener", "halt", "no procesar"],
        accion: "ESPERAR",
        comportamiento: "No ejecutar hasta nueva orden del usuario"
    },
    EXPANDIR: {
        sinonimos: ["expandir", "ampliar", "buscar más", "más resultados", "profundizar"],
        accion: "EXPANDIR",
        comportamiento: "Aumentar alcance de búsqueda o análisis"
    }
};

const NotasPersonales = {
    nombre: "Módulo de Notas Personales",
    notas: [],
    reglasNegocio: [],
    historialCruces: [],
    anexosCargados: [],

    cargarAnexos: (anexos) => {
        if (!Array.isArray(anexos)) anexos = [anexos];
        NotasPersonales.anexosCargados = anexos;
        console.log(`📎 ANEXOS CARGADOS: ${anexos.length} archivo(s)`);
        return { cargados: anexos.length, anexos: anexos.map(a => a.nombre || a) };
    },

    agregarNota: (nota) => {
        const entrada = {
            id: `NOTA-${Date.now()}`,
            texto: nota.texto || nota,
            timestamp: new Date().toISOString(),
            anexosRelacionados: [],
            reglasGeneradas: [],
            procesada: false
        };
        
        NotasPersonales.notas.push(entrada);
        
        // Cruzar con anexos si hay
        if (NotasPersonales.anexosCargados.length > 0) {
            entrada.anexosRelacionados = NotasPersonales.buscarEnAnexos(entrada.texto);
        }
        
        // Extraer reglas de negocio
        const reglas = NotasPersonales.extraerReglas(entrada.texto);
        entrada.reglasGeneradas = reglas;
        entrada.procesada = reglas.length > 0;
        
        // Agregar a reglas globales
        reglas.forEach(r => {
            if (!NotasPersonales.reglasNegocio.find(ex => ex.id === r.id)) {
                NotasPersonales.reglasNegocio.push(r);
            }
        });
        
        console.log(`\n📝 NOTA AGREGADA: ${entrada.id}`);
        console.log(`   Texto: "${entrada.texto.substring(0, 60)}..."`);
        if (entrada.anexosRelacionados.length > 0) {
            console.log(`   📎 Cruce con anexos: ${entrada.anexosRelacionados.join(", ")}`);
        }
        if (reglas.length > 0) {
            console.log(`   ⚙️ Reglas generadas: ${reglas.length}`);
            reglas.forEach(r => console.log(`      - ${r.tipo}: ${r.palabraClave}`));
        }
        
        return entrada;
    },

    buscarEnAnexos: (texto) => {
        const palabras = texto.toLowerCase().split(/\s+/);
        const cruces = [];
        
        NotasPersonales.anexosCargados.forEach(anexo => {
            const nombreAnexo = (anexo.nombre || "").toLowerCase();
            const contenidoAnexo = (anexo.contenido || "").toLowerCase();
            
            palabras.forEach(palabra => {
                if (palabra.length > 3 && (nombreAnexo.includes(palabra) || contenidoAnexo.includes(palabra))) {
                    if (!cruces.includes(anexo.nombre || "anexo")) {
                        cruces.push(anexo.nombre || "anexo");
                    }
                }
            });
        });
        
        return cruces;
    },

    extraerReglas: (texto) => {
        const reglas = [];
        const textoLower = texto.toLowerCase();
        
        for (const [tipo, config] of Object.entries(InstruccionesClave)) {
            for (const sinonimo of config.sinonimos) {
                if (textoLower.includes(sinonimo)) {
                    const regla = {
                        id: `REGLA-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                        tipo: config.accion,
                        palabraClave: sinonimo,
                        comportamiento: config.comportamiento,
                        origen: "nota_personal",
                        timestamp: new Date().toISOString(),
                        activa: true
                    };
                    
                    // Extraer objeto de la regla si existe
                    const match = texto.match(new RegExp(`${sinonimo}\\s+([^,.]+)`, "i"));
                    if (match) {
                        regla.objeto = match[1].trim();
                    }
                    
                    reglas.push(regla);
                    break; // Solo una regla por tipo
                }
            }
        }
        
        return reglas;
    },

    obtenerReglasActivas: () => {
        return NotasPersonales.reglasNegocio.filter(r => r.activa);
    },

    aplicarReglas: (datos, contexto) => {
        let resultados = [...datos];
        const aplicadas = [];
        
        const reglasActivas = NotasPersonales.obtenerReglasActivas();
        
        for (const regla of reglasActivas) {
            const beforeCount = resultados.length;
            
            switch (regla.tipo) {
                case "PRIORIZAR":
                    // Mover elementos con la palabra clave al inicio
                    if (regla.objeto) {
                        resultados.sort((a, b) => {
                            const aText = JSON.stringify(a).toLowerCase();
                            const bText = JSON.stringify(b).toLowerCase();
                            const aMatch = aText.includes(regla.objeto.toLowerCase());
                            const bMatch = bText.includes(regla.objeto.toLowerCase());
                            return bMatch - aMatch;
                        });
                    }
                    break;
                    
                case "IGNORAR":
                    // Filtrar elementos que contengan la palabra clave
                    if (regla.objeto) {
                        resultados = resultados.filter(item => {
                            const text = JSON.stringify(item).toLowerCase();
                            return !text.includes(regla.objeto.toLowerCase());
                        });
                    }
                    break;
                    
                case "AJUSTAR_COSTO":
                    // Marcar para recalcular costos
                    resultados = resultados.map(item => ({
                        ...item,
                        _ajustarCosto: true,
                        _notaCosto: `Regla aplicada: ${regla.palabraClave}`
                    }));
                    break;
                    
                case "REVISAR":
                    // Marcar para revisión
                    resultados = resultados.map(item => ({
                        ...item,
                        _revisar: true
                    }));
                    break;
                    
                case "NOTIFICAR":
                    // Agregar flag de notificación
                    resultados = resultados.map(item => ({
                        ...item,
                        _notificar: true
                    }));
                    break;
                    
                case "ESPERAR":
                    // No procesar
                    return {
                        action: "ESPERAR",
                        reason: regla.palabraClave,
                        originalData: datos
                    };
                    
                case "EXPANDIR":
                    // Agregar flag para expandir
                    resultados = resultados.map(item => ({
                        ...item,
                        _expandir: true
                    }));
                    break;
            }
            
            if (resultados.length !== beforeCount) {
                applied.push({ regla: regla.tipo, cambios: beforeCount - resultados.length });
            }
        }
        
        return {
            action: "PROCESAR",
            resultados: resultados,
            reglasAplicadas: aplicadas,
           count: resultados.length
        };
    },

    listarNotas: () => {
        return NotasPersonales.notas.map(n => ({
            id: n.id,
            texto: n.texto.substring(0, 80) + "...",
            reglas: n.reglasGeneradas.length,
            procesada: n.procesada
        }));
    },

    listarReglas: () => {
        return NotasPersonales.reglasNegocio.map(r => ({
            tipo: r.tipo,
            palabraClave: r.palabraClave,
            comportamiento: r.comportamiento,
            activa: r.activa,
            objeto: r.objeto || "N/A"
        }));
    },

    activarRegla: (id) => {
        const regla = NotasPersonales.reglasNegocio.find(r => r.id === id);
        if (regla) {
            regla.activa = true;
            return { ok: true, regla: regla.tipo };
        }
        return { ok: false, error: "Regla no encontrada" };
    },

    desactivarRegla: (id) => {
        const regla = NotasPersonales.reglasNegocio.find(r => r.id === id);
        if (regla) {
            regla.activa = false;
            return { ok: true, regla: regla.tipo };
        }
        return { ok: false, error: "Regla no encontrada" };
    },

    estado: () => {
        return {
            notasTotal: NotasPersonales.notas.length,
            reglasActivas: NotasPersonales.reglasNegocio.filter(r => r.activa).length,
            reglasTotales: NotasPersonales.reglasNegocio.length,
            anexosCargados: NotasPersonales.anexosCargados.length
        };
    }
};

module.exports = NotasPersonales;
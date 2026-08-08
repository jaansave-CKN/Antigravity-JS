/**
 * SKILL: PESO_DOCUMENTOS
 * Actualiza peso (weight) de documentos según reordenamiento de filas en web
 * Documento en posición #1 tiene prioridad absoluta sobre criterios del Minero
 */

const fs = require("fs");
const path = require("path");

const PesoDocumentos = {
    nombre: "Peso de Documentos",
    dbPath: path.join(process.cwd(), "Radar_Resultados", "documentos_weights.json"),
    documentos: [],
    
    cargarBaseDatos: () => {
        if (fs.existsSync(PesoDocumentos.dbPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(PesoDocumentos.dbPath, "utf8"));
                PesoDocumentos.documentos = data.documentos || [];
            } catch(e) {
                PesoDocumentos.documentos = [];
            }
        }
    },
    
    guardarBaseDatos: () => {
        const data = {
            ultimoUpdate: new Date().toISOString(),
            documentos: PesoDocumentos.documentos
        };
        
        const dir = path.dirname(PesoDocumentos.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(PesoDocumentos.dbPath, JSON.stringify(data, null, 2));
    },
    
    // Reordenar documentos - actualizar weights
    actualizarOrden: (filasOrdenadas) => {
        console.log(`\n📊 ACTUALIZANDO PESO DE DOCUMENTOS`);
        console.log(`   Filas reordenadas: ${filasOrdenadas.length}`);
        
        // Calcular weights: posición 0 = weight máximo (prioridad absoluta)
        const maxWeight = 100;
        
        filasOrdenadas.forEach((item, index) => {
            const posicion = index + 1;
            const weight = posicion === 1 ? maxWeight : Math.max(1, maxWeight - (posicion * 5));
            
            // Buscar documento existente o crear nuevo
            const docIndex = PesoDocumentos.documentos.findIndex(d => d.id === item.id);
            
            const documento = {
                id: item.id,
                titulo: item.titulo || item.nombre || "Sin título",
                posicion: posicion,
                weight: weight,
                prioridadAbsoluta: posicion === 1,
                timestamp: new Date().toISOString(),
                actualizadoPor: "reordenamiento_web"
            };
            
            if (docIndex >= 0) {
                PesoDocumentos.documentos[docIndex] = documento;
            } else {
                PesoDocumentos.documentos.push(documento);
            }
            
            if (posicion === 1) {
                console.log(`   🚀 POSICIÓN #1 (Prioridad Absoluta): ${documento.titulo}`);
                console.log(`      Weight: ${weight} - Override criterios del Minero`);
            } else {
                console.log(`   ${posicion}. ${documento.titulo} -> Weight: ${weight}`);
            }
        });
        
        PesoDocumentos.guardarBaseDatos();
        
        return {
            success: true,
            documentosActualizados: PesoDocumentos.documentos.length,
            prioridadAbsoluta: PesoDocumentos.documentos.find(d => d.prioridadAbsoluta)
        };
    },
    
    // Obtener documento con prioridad absoluta
    obtenerPrioridadAbsoluta: () => {
        return PesoDocumentos.documentos.find(d => d.prioridadAbsoluta) || null;
    },
    
    // Obtener documentos ordenados por peso
    obtenerDocumentosPorPeso: () => {
        return [...PesoDocumentos.documentos].sort((a, b) => b.weight - a.weight);
    },
    
    // Verificar si un documento tiene prioridad sobre criterios del Minero
    tienePrioridadSobreMinero: (documentoId) => {
        const doc = PesoDocumentos.documentos.find(d => d.id === documentoId);
        if (!doc) return false;
        
        return doc.prioridadAbsoluta || doc.weight >= 90;
    },
    
    // Obtener todos los documentos con sus weights
    obtenerTodos: () => {
        return PesoDocumentos.documentos.map(d => ({
            id: d.id,
            titulo: d.titulo,
            posicion: d.posicion,
            weight: d.weight,
            prioridadAbsoluta: d.prioridadAbsoluta
        }));
    },
    
    // Aplicar override a criterios del Minero
    aplicarOverrideMinero: (criteriosMinero) => {
        const prioridadAbsoluta = PesoDocumentos.obtenerPrioridadAbsoluta();
        
        if (!prioridadAbsoluta) {
            return criteriosMinero;
        }
        
        console.log(`\n⚡ APLICANDO OVERRIDE A CRITERIOS DEL MINERO`);
        console.log(`   Prioridad Absoluta: ${prioridadAbsoluta.titulo}`);
        
        // Agregar criterio obligatorio con máximo peso
        const criteriosOverride = {
            ...criteriosMinero,
            _overridePrioridadAbsoluta: {
                documentoId: prioridadAbsoluta.id,
                titulo: prioridadAbsoluta.titulo,
                peso: prioridadAbsoluta.weight,
                forzar: true,
                mensaje: "Este documento tiene prioridad absoluta sobre cualquier criterio"
            }
        };
        
        return criteriosOverride;
    },
    
    // Resetear weights
    resetearWeights: () => {
        PesoDocumentos.documentos = [];
        PesoDocumentos.guardarBaseDatos();
        console.log(`\n🔄 WEIGHTS RESETEADOS`);
        return { success: true };
    }
};

module.exports = PesoDocumentos;
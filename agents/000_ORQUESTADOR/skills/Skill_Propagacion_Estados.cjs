/**
 * SKILL: PROPAGACION_ESTADOS
 * Propaga estado isActive del Padre (Nivel 1) a todos los hijos vinculados
 * Si Padre isActive: true → hijos se activan automáticamente
 * Si Padre isActive: false → grupo completo ignorado en escaneo
 */

const fs = require("fs");
const path = require("path");

const PropagacionEstados = {
    nombre: "Propagación de Estados",
    dbPath: path.join(process.cwd(), "Radar_Resultados", "arbol_contexto.json"),
    tree: {
        raiz: null,
        nodos: {}
    },
    
    cargarBaseDatos: () => {
        if (fs.existsSync(PropagacionEstados.dbPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(PropagacionEstados.dbPath, "utf8"));
                PropagacionEstados.tree = data;
            } catch(e) {
                PropagacionEstados.tree = { raiz: null, nodos: {} };
            }
        }
    },
    
    guardarBaseDatos: () => {
        const dir = path.dirname(PropagacionEstados.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(PropagacionEstados.dbPath, JSON.stringify(PropagacionEstados.tree, null, 2));
    },
    
    // Construir árbol de contexto
    construirArbol: (nodos) => {
        console.log(`\n🌳 CONSTRUYENDO ÁRBOL DE CONTEXTO`);
        
        let entidadPadreActual = null;
        
        nodos.forEach(nodo => {
            // FALLBACK: Clonar entidad del padre más cercano
            if (!nodo.entidad && entidadPadreActual) {
                console.log(`   ⚠️ FALLBACK: ${nodo.id} hereda entidad de padre: "${entidadPadreActual}"`);
                nodo.entidad = "[AUTO-HEREDADO] " + entidadPadreActual;
            } else if (nodo.entidad) {
                entidadPadreActual = nodo.entidad;
            }
            
            // FALLBACK: Estado interno activo si el padre está activo
            let isActive = nodo.isActive || false;
            if (nodo.nivel > 1) {
                const padre = nodos.find(p => p.id === nodo.padreId || p.id === nodo.nivel?.toString().split('.')[0]);
                if (padre && padre.isActive && !nodo.isActive) {
                    console.log(`   ⚠️ FALLBACK: ${nodo.id} hereda isActive de padre: true`);
                    isActive = true;
                }
            }
            
            PropagacionEstados.tree.nodos[nodo.id] = {
                id: nodo.id,
                titulo: nodo.titulo || nodo.nombre,
                nivel: nodo.nivel,
                isActive: isActive,
                entidad: nodo.entidad || "Sin entidad",
                status: nodo.status || "auto-calculado",
                padreId: nodo.padreId || null,
                hijos: nodo.hijos || [],
                fallbackAplicado: !nodo.entidad || !nodo.status
            };
            
            // Identificar raíz (nivel 1)
            if (nodo.nivel === 1 && !nodo.padreId) {
                PropagacionEstados.tree.raiz = nodo.id;
                if (nodo.entidad) entidadPadreActual = nodo.entidad;
            }
        });
        
        PropagacionEstados.guardarBaseDatos();
        
        console.log(`   Nodos registrados: ${Object.keys(PropagacionEstados.tree.nodos).length}`);
        console.log(`   Raíz (Nivel 1): ${PropagacionEstados.tree.raiz}`);
        
        return PropagacionEstados.tree;
    },
    
    // Propagar estado del padre a hijos
    propagarEstado: (nodoId, nuevoEstado) => {
        const nodo = PropagacionEstados.tree.nodos[nodoId];
        if (!nodo) return { error: "Nodo no encontrado" };
        
        console.log(`\n🔄 PROPAGANDO ESTADO: ${nodoId} → isActive: ${nuevoEstado}`);
        
        const propagados = [];
        
        // Si es padre (nivel 1), propagar a todos los hijos
        if (nodo.nivel === 1) {
            PropagacionEstados.propagarAHijos(nodoId, nuevoEstado, propagados);
            console.log(`   📥 Hijos afectados: ${propagados.length}`);
        }
        
        nodo.isActive = nuevoEstado;
        PropagacionEstados.guardarBaseDatos();
        
        return {
            nodoActualizado: nodoId,
            nuevoEstado: nuevoEstado,
            hijosPropagados: propagados.length,
            nodos: propagados
        };
    },
    
    // Recursivamente propagar a hijos
    propagarAHijos: (nodoId, estado, lista) => {
        const nodo = PropagacionEstados.tree.nodos[nodoId];
        if (!nodo) return;
        
        // Procesar hijos directos
        if (nodo.hijos && nodo.hijos.length > 0) {
            nodo.hijos.forEach(hijoId => {
                const hijo = PropagacionEstados.tree.nodos[hijoId];
                if (hijo) {
                    const estadoAnterior = hijo.isActive;
                    hijo.isActive = estado;
                    
                    lista.push({
                        id: hijoId,
                        titulo: hijo.titulo,
                        nivel: hijo.nivel,
                        antes: estadoAnterior,
                        ahora: estado
                    });
                    
                    // Continuar propagando a hijos del hijo
                    PropagacionEstados.propagarAHijos(hijoId, estado, lista);
                }
            });
        }
    },
    
    // Procesar árbol recibido
    procesarArbol: (arbol) => {
        console.log(`\n🌲 PROCESANDO ÁRBOL DE CONTEXTO RECIBIDO`);
        
        const nodos = Array.isArray(arbol) ? arbol : [arbol];
        
        // Construir árbol
        PropagacionEstados.construirArbol(nodos);
        
        // Verificar estado del padre (raíz)
        if (PropagacionEstados.tree.raiz) {
            const padre = PropagacionEstados.tree.nodos[PropagacionEstados.tree.raiz];
            
            if (padre.isActive) {
                console.log(`   ✅ Padre (Nivel 1) está ACTIVO`);
                console.log(`   🚀 Propagando estado a todos los hijos...`);
                
                const resultado = PropagacionEstados.propagarEstado(padre.id, true);
                
                return {
                    accion: "ACTIVAR_GRUPO",
                    padre: padre,
                    hijosActivados: resultado.hijosPropagados,
                    escaneo: "PERMITIDO"
                };
            } else {
                console.log(`   ⛔ Padre (Nivel 1) está INACTIVO`);
                console.log(`   🛇 Grupo completo IGNORADO en escaneo`);
                
                return {
                    accion: "IGNORAR_GRUPO",
                    padre: padre,
                    hijos: Object.keys(PropagacionEstados.tree.nodos).length - 1,
                    escaneo: "BLOQUEADO"
                };
            }
        }
        
        return { error: "Sin raíz definida" };
    },
    
    // Obtener nodos activos para escaneo
    obtenerNodosActivos: () => {
        const activos = [];
        
        Object.values(PropagacionEstados.tree.nodos).forEach(nodo => {
            if (nodo.isActive) {
                activos.push({
                    id: nodo.id,
                    titulo: nodo.titulo,
                    nivel: nodo.nivel
                });
            }
        });
        
        return activos;
    },
    
    // Estado del sistema
    estado: () => {
        const raiz = PropagacionEstados.tree.raiz ? PropagacionEstados.tree.nodos[PropagacionEstados.tree.raiz] : null;
        
        return {
            raizId: PropagacionEstados.tree.raiz,
            raizActiva: raiz ? raiz.isActive : false,
            totalNodos: Object.keys(PropagacionEstados.tree.nodos).length,
            nodosActivos: PropagacionEstados.obtenerNodosActivos().length,
            escaneoPermitido: raiz ? raiz.isActive : false
        };
    }
};

module.exports = PropagacionEstados;